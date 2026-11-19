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
import { RoleAssignment, User } from '../auth/auth.models';
import { assertCohortAccess } from '../auth/scope';
import { Course } from '../courses/course.models';
import { CourseEnrollment, CourseOffering } from './offering.models';
import { syncCourseEnrollments } from './offering.service';

const router = Router();
router.use(authenticate, requireRole('super_admin', 'college_admin', 'department_admin'));

async function semesterOf(cohortId: string, semesterId: string) {
  const semester = await Semester.findOne({ _id: semesterId, cohortId });
  if (!semester) throw AppError.badRequest('Semester not found for this cohort');
  return semester;
}

const listQuery = z.object({ cohortId: objectId, semesterId: objectId });

router.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const q = req.validated!.query as z.infer<typeof listQuery>;
    await assertCohortAccess(req.auth!, q.cohortId, 'offering:read');
    await semesterOf(q.cohortId, q.semesterId);

    const offerings = await CourseOffering.find({ cohortId: q.cohortId, semesterId: q.semesterId }).lean();
    const [courses, teachers, counts] = await Promise.all([
      Course.find({ _id: { $in: offerings.map((o) => o.courseId) } }).lean(),
      User.find({ _id: { $in: offerings.flatMap((o) => o.teacherIds) } }).select('name email').lean(),
      CourseEnrollment.aggregate<{ _id: unknown; n: number }>([{ $match: { semesterId: offerings[0]?.semesterId, status: 'active' } }, { $group: { _id: '$offeringId', n: { $sum: 1 } } }]),
    ]);
    const course = new Map(courses.map((c) => [String(c._id), c]));
    const teacher = new Map(teachers.map((t) => [String(t._id), t]));
    const count = new Map(counts.map((c) => [String(c._id), c.n]));

    const items = offerings
      .map((o) => {
        const c = course.get(String(o.courseId));
        return {
          id: String(o._id),
          status: o.status,
          course: c ? { id: String(c._id), code: c.code, name: c.name, credit: c.credit, type: c.type } : null,
          teachers: o.teacherIds.map((id) => ({ id: String(id), name: teacher.get(String(id))?.name ?? '?' })),
          students: count.get(String(o._id)) ?? 0,
        };
      })
      .sort((a, b) => (a.course?.code ?? '').localeCompare(b.course?.code ?? ''));
    sendSuccess(res, items);
  }),
);

const scopeBody = z.object({ cohortId: objectId, semesterId: objectId }).strict();

/** Creates an offering for every published course of this semester that has none yet. */
router.post(
  '/generate',
  validate({ body: scopeBody }),
  asyncHandler(async (req, res) => {
    const b = req.validated!.body as z.infer<typeof scopeBody>;
    const cohort = await assertCohortAccess(req.auth!, b.cohortId, 'offering:manage');
    const semester = await semesterOf(b.cohortId, b.semesterId);

    const [courses, have] = await Promise.all([
      Course.find({ programId: cohort.programId, semesterNumber: semester.number, status: 'published' }).lean(),
      CourseOffering.find({ semesterId: semester._id }).select('courseId').lean(),
    ]);
    const done = new Set(have.map((h) => String(h.courseId)));
    const fresh = courses.filter((c) => !done.has(String(c._id)));
    if (fresh.length) {
      await CourseOffering.insertMany(
        fresh.map((c) => ({ institutionId: cohort.institutionId, collegeId: cohort.collegeId, departmentId: cohort.departmentId, programId: cohort.programId, cohortId: cohort._id, semesterId: semester._id, courseId: c._id })),
        { ordered: false },
      );
    }
    const enrolled = await syncCourseEnrollments(String(semester._id));
    await audit({ actorId: req.auth!.userId, action: 'offering.generate', entityType: 'Semester', entityId: semester._id, meta: { created: fresh.length, enrolled }, req });
    sendSuccess(res, { courses: courses.length, created: fresh.length, enrolled });
  }),
);

/** Adds anyone missing from the compulsory courses (for example after sections changed). */
router.post(
  '/sync',
  validate({ body: scopeBody }),
  asyncHandler(async (req, res) => {
    const b = req.validated!.body as z.infer<typeof scopeBody>;
    await assertCohortAccess(req.auth!, b.cohortId, 'offering:manage');
    await semesterOf(b.cohortId, b.semesterId);
    sendSuccess(res, { enrolled: await syncCourseEnrollments(b.semesterId) });
  }),
);

const patchBody = z.object({ teacherIds: z.array(objectId).max(10).optional(), status: z.enum(['active', 'closed']).optional() }).strict();

router.patch(
  '/:id',
  validate({ params: z.object({ id: objectId }), body: patchBody }),
  asyncHandler(async (req, res) => {
    const offering = await CourseOffering.findById((req.validated!.params as { id: string }).id);
    if (!offering) throw AppError.notFound();
    await assertCohortAccess(req.auth!, offering.cohortId, 'offering:manage');
    const b = req.validated!.body as z.infer<typeof patchBody>;

    if (b.teacherIds) {
      const ids = [...new Set(b.teacherIds)];
      // Only active teachers of this very department can be assigned.
      const ok = await RoleAssignment.find({ userId: { $in: ids }, role: 'teacher', status: 'active', 'scope.departmentId': offering.departmentId }).distinct('userId');
      if (ok.length !== ids.length) throw AppError.badRequest('Every person must be an active teacher of this department');
      offering.set('teacherIds', ids);
    }
    if (b.status) offering.status = b.status;
    await offering.save();
    await audit({ actorId: req.auth!.userId, action: 'offering.update', entityType: 'CourseOffering', entityId: offering._id, meta: b, req });
    sendSuccess(res, { id: String(offering._id), status: offering.status, teacherIds: offering.teacherIds.map(String) });
  }),
);

export default router;
