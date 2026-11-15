import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../common/asyncHandler';
import { AppError } from '../../common/errors';
import { sendSuccess } from '../../common/response';
import { authenticate, requireRole } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { Semester } from '../academic/academic.models';
import { objectId } from '../academic/academic.schemas';
import { audit } from '../audit/audit.model';
import { User } from '../auth/auth.models';
import { can } from '../auth/policy';
import { assertCohortAccess } from '../auth/scope';
import { StudentProfile } from '../students/student.models';
import { AssignmentHistory, SemesterEnrollment } from './enrollment.models';
import { overview, promoteCohort, reassignStudent, runAssignment } from './enrollment.service';

const router = Router();
router.use(authenticate, requireRole('super_admin', 'college_admin', 'department_admin'));

/** The semester asked for must belong to the cohort. Default is the cohort's current semester. */
async function semesterOf(cohort: { _id: unknown; currentSemesterNo: number }, semesterId?: string) {
  const semester = semesterId
    ? await Semester.findOne({ _id: semesterId, cohortId: cohort._id })
    : await Semester.findOne({ cohortId: cohort._id, number: cohort.currentSemesterNo });
  if (!semester) throw AppError.badRequest('Semester not found for this cohort');
  return semester;
}

const overviewQuery = z.object({ cohortId: objectId, semesterId: objectId.optional() });

router.get(
  '/overview',
  validate({ query: overviewQuery }),
  asyncHandler(async (req, res) => {
    const q = req.validated!.query as z.infer<typeof overviewQuery>;
    const cohort = await assertCohortAccess(req.auth!, q.cohortId, 'enrollment:read');
    sendSuccess(res, await overview(cohort, await semesterOf(cohort, q.semesterId)));
  }),
);

const studentsQuery = z.object({
  cohortId: objectId,
  semesterId: objectId.optional(),
  sectionId: objectId.optional(),
  partId: objectId.optional(),
  unassigned: z.enum(['true']).optional(),
  q: z.string().trim().max(60).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

router.get(
  '/students',
  validate({ query: studentsQuery }),
  asyncHandler(async (req, res) => {
    const q = req.validated!.query as z.infer<typeof studentsQuery>;
    const cohort = await assertCohortAccess(req.auth!, q.cohortId, 'enrollment:read');
    const semester = await semesterOf(cohort, q.semesterId);

    const filter: Record<string, unknown> = { cohortId: cohort._id, semesterId: semester._id };
    if (q.sectionId) filter['sectionId'] = q.sectionId;
    if (q.partId) filter['partId'] = q.partId;
    if (q.unassigned) filter['partId'] = null;
    if (q.q) {
      if (/^\d+$/.test(q.q)) filter['classRoll'] = Number(q.q);
      else {
        const rx = new RegExp(q.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        filter['userId'] = { $in: await User.find({ $or: [{ name: rx }, { registrationNo: rx }] }).limit(200).distinct('_id') };
      }
    }

    const [items, total] = await Promise.all([
      SemesterEnrollment.find(filter).sort({ classRoll: 1 }).skip((q.page - 1) * q.limit).limit(q.limit).populate('userId', 'name registrationNo').lean(),
      SemesterEnrollment.countDocuments(filter),
    ]);
    sendSuccess(
      res,
      items.map((e) => {
        const u = e.userId as unknown as { name?: string; registrationNo?: string } | null;
        return {
          profileId: String(e.profileId),
          name: u?.name ?? '',
          registrationNo: u?.registrationNo ?? '',
          classRoll: e.classRoll,
          sectionId: e.sectionId ? String(e.sectionId) : null,
          partId: e.partId ? String(e.partId) : null,
          assignedBy: e.assignedBy,
          status: e.status,
        };
      }),
      { page: q.page, limit: q.limit, total },
    );
  }),
);

const assignBody = z
  .object({
    cohortId: objectId,
    semesterId: objectId.optional(),
    mode: z.enum(['unassigned', 'all']).default('unassigned'),
    dryRun: z.boolean().default(false),
  })
  .strict();

router.post(
  '/assign',
  validate({ body: assignBody }),
  asyncHandler(async (req, res) => {
    const b = req.validated!.body as z.infer<typeof assignBody>;
    const cohort = await assertCohortAccess(req.auth!, b.cohortId, 'enrollment:manage');
    const semester = await semesterOf(cohort, b.semesterId);
    const result = await runAssignment({ cohort, semester, mode: b.mode, dryRun: b.dryRun, actorId: req.auth!.userId });
    if (!b.dryRun && result.assigned) {
      await audit({ actorId: req.auth!.userId, action: 'enrollment.assign', entityType: 'Cohort', entityId: cohort._id, meta: { mode: b.mode, assigned: result.assigned, semesterId: String(semester._id) }, req });
    }
    sendSuccess(res, result);
  }),
);

/** A student outside the caller's area does not exist for them (404). */
async function loadProfile(req: Parameters<Parameters<typeof asyncHandler>[0]>[0], id: string) {
  const profile = await StudentProfile.findById(id);
  const resource = profile && {
    kind: 'cohort' as const,
    institutionId: String(profile.institutionId),
    collegeId: String(profile.collegeId),
    departmentId: String(profile.departmentId),
  };
  if (!profile || !resource || !can(req.auth!.roles, 'enrollment:read', resource)) throw AppError.notFound('Student not found');
  return { profile, resource };
}

const profileParams = z.object({ profileId: objectId });

router.post(
  '/students/:profileId/reassign',
  validate({ params: profileParams, body: z.object({ partId: objectId, reason: z.string().trim().min(3).max(300) }).strict() }),
  asyncHandler(async (req, res) => {
    const { profile, resource } = await loadProfile(req, (req.validated!.params as { profileId: string }).profileId);
    if (!can(req.auth!.roles, 'enrollment:manage', resource)) throw AppError.forbidden('This is outside your area');
    const { partId, reason } = req.validated!.body as { partId: string; reason: string };

    const result = await reassignStudent(String(profile._id), partId, reason, req.auth!.userId);
    await audit({ actorId: req.auth!.userId, action: 'enrollment.reassign', entityType: 'StudentProfile', entityId: profile._id, meta: { partId, reason, outsideRange: result.outsideRange }, req });
    sendSuccess(res, result);
  }),
);

router.get(
  '/students/:profileId/history',
  validate({ params: profileParams }),
  asyncHandler(async (req, res) => {
    const { profile } = await loadProfile(req, (req.validated!.params as { profileId: string }).profileId);
    const [history, enrollments] = await Promise.all([
      AssignmentHistory.find({ profileId: profile._id }).sort({ at: -1 }).limit(100).lean(),
      SemesterEnrollment.find({ profileId: profile._id }).sort({ createdAt: 1 }).lean(),
    ]);
    sendSuccess(res, {
      semesters: enrollments.map((e) => ({ semesterId: String(e.semesterId), classRoll: e.classRoll, sectionId: e.sectionId ? String(e.sectionId) : null, partId: e.partId ? String(e.partId) : null, assignedBy: e.assignedBy, status: e.status })),
      history: history.map((h) => ({ at: h.at, method: h.method, reason: h.reason, from: h.from, to: h.to, semesterId: String(h.semesterId) })),
    });
  }),
);

router.post(
  '/cohorts/:cohortId/promote',
  validate({ params: z.object({ cohortId: objectId }), body: z.object({ toSemesterNo: z.number().int().min(2).max(16) }).strict() }),
  asyncHandler(async (req, res) => {
    const cohortId = (req.validated!.params as { cohortId: string }).cohortId;
    await assertCohortAccess(req.auth!, cohortId, 'enrollment:manage');
    const { toSemesterNo } = req.validated!.body as { toSemesterNo: number };
    const result = await promoteCohort(cohortId, toSemesterNo, req.auth!.userId);
    await audit({ actorId: req.auth!.userId, action: 'enrollment.promote', entityType: 'Cohort', entityId: cohortId, meta: result, req });
    sendSuccess(res, result);
  }),
);

export default router;
