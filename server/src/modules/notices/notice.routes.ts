/* eslint-disable @typescript-eslint/no-explicit-any */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../common/asyncHandler';
import { AppError } from '../../common/errors';
import { sendSuccess } from '../../common/response';
import { authenticate, requireRole } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { Cohort, College, Department, Section, Semester } from '../academic/academic.models';
import { objectId } from '../academic/academic.schemas';
import { audit } from '../audit/audit.model';
import { User } from '../auth/auth.models';
import { can } from '../auth/policy';
import { areaFilter, assertCohortAccess, assertDepartmentAccess } from '../auth/scope';
import { CourseEnrollment, CourseOffering } from '../offerings/offering.models';
import { StudentProfile } from '../students/student.models';
import { isVisibleToStudent, studentNoticeFilter, type NoticeTarget, type StudentCtx } from './notice.logic';
import { Notice, NoticeRead } from './notice.models';
import { notifyNotice, withdrawNoticeNotifications } from '../notifications/notification.service';

// ---------------------------------------------------------------- publishing (teachers and admins)

export const staffRouter = Router();
staffRouter.use(authenticate, requireRole('super_admin', 'college_admin', 'department_admin', 'teacher'));

const targetSchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('college'), collegeId: objectId }),
  z.object({ scope: z.literal('department'), departmentId: objectId }),
  z.object({ scope: z.literal('cohort'), cohortId: objectId, semesterId: objectId.optional(), sectionIds: z.array(objectId).max(20).default([]) }),
  z.object({ scope: z.literal('course'), offeringId: objectId }),
]);
const fields = z.object({
  title: z.string().trim().min(3).max(150),
  body: z.string().trim().min(1).max(5000),
  priority: z.enum(['normal', 'important', 'urgent']),
  pinned: z.boolean(),
  expiresAt: z.coerce.date().nullable(),
});
const createSchema = fields.partial({ priority: true, pinned: true, expiresAt: true }).extend({ target: targetSchema }).strict();
const isAdmin = (auth: any) => auth.roles.some((g: any) => ['super_admin', 'college_admin', 'department_admin'].includes(g.role));

/**
 * Works out where a notice goes and whether THIS person may send it there. Ids come from the database.
 * Teachers: their own courses, or a batch and semester where they teach. Admins: anything in their area.
 */
async function authorise(req: any, t: z.infer<typeof targetSchema>) {
  const auth = req.auth;
  const teacherOnly = !isAdmin(auth);
  const deny = () => AppError.forbidden('You cannot send a notice to this audience');

  if (t.scope === 'college') {
    const c = await College.findById(t.collegeId).lean();
    if (!c) throw AppError.badRequest('College not found');
    if (teacherOnly || !can(auth.roles, 'notice:college', { kind: 'college', institutionId: String(c.institutionId), collegeId: String(c._id) })) throw deny();
    return { institutionId: c.institutionId, collegeId: c._id, departmentId: null, target: { scope: 'college', collegeId: c._id } };
  }
  if (t.scope === 'department') {
    const d = await Department.findById(t.departmentId).lean();
    if (!d) throw AppError.badRequest('Department not found');
    if (teacherOnly) throw deny();
    await assertDepartmentAccess(auth, d._id, 'notice:manage');
    return { institutionId: d.institutionId, collegeId: d.collegeId, departmentId: d._id, target: { scope: 'department', departmentId: d._id } };
  }
  if (t.scope === 'course') {
    const o = await CourseOffering.findById(t.offeringId).lean();
    if (!o) throw AppError.badRequest('Course not found');
    if (teacherOnly) { if (!o.teacherIds.map(String).includes(auth.userId)) throw deny(); } else await assertCohortAccess(auth, o.cohortId, 'notice:manage');
    return { institutionId: o.institutionId, collegeId: o.collegeId, departmentId: o.departmentId, target: { scope: 'course', offeringId: o._id, cohortId: o.cohortId, semesterId: o.semesterId } };
  }
  // cohort (optionally one semester and some sections)
  if (teacherOnly) {
    if (!t.semesterId) throw AppError.badRequest('Choose the semester');
    if (!(await CourseOffering.exists({ teacherIds: auth.userId, cohortId: t.cohortId, semesterId: t.semesterId }))) throw deny();
  }
  const cohort = teacherOnly ? await Cohort.findById(t.cohortId) : await assertCohortAccess(auth, t.cohortId, 'notice:manage');
  if (!cohort) throw AppError.badRequest('Batch not found');
  if (t.semesterId && !(await Semester.exists({ _id: t.semesterId, cohortId: cohort._id }))) throw AppError.badRequest('That semester does not belong to this batch');
  if (t.sectionIds.length && (await Section.countDocuments({ _id: { $in: t.sectionIds }, cohortId: cohort._id, ...(t.semesterId ? { semesterId: t.semesterId } : {}) })) !== new Set(t.sectionIds).size) throw AppError.badRequest('Some sections do not belong to this batch and semester');
  return { institutionId: cohort.institutionId, collegeId: cohort.collegeId, departmentId: cohort.departmentId, target: { scope: 'cohort', cohortId: cohort._id, semesterId: t.semesterId ?? null, sectionIds: t.sectionIds } };
}

const idOrNull = (v: unknown): string | null => (v ? String(v) : null);
/** The stored target with every id as a plain string, ready for the pure visibility rules. */
function plainTarget(n: any): NoticeTarget {
  const t = n.target ?? {};
  return { scope: t.scope, collegeId: idOrNull(t.collegeId), departmentId: idOrNull(t.departmentId), cohortId: idOrNull(t.cohortId), semesterId: idOrNull(t.semesterId), offeringId: idOrNull(t.offeringId), sectionIds: (t.sectionIds ?? []).map(String) };
}

/** The sender, or an admin whose area covers the notice, may edit or withdraw it. */
function canManage(auth: any, n: any): boolean {
  if (String(n.publisherId) === auth.userId) return true;
  if (plainTarget(n).scope === 'college') return can(auth.roles, 'notice:college', { kind: 'college', institutionId: String(n.institutionId), collegeId: String(n.collegeId) });
  return can(auth.roles, 'notice:manage', { kind: 'department', institutionId: String(n.institutionId), collegeId: String(n.collegeId), departmentId: String(n.departmentId) });
}

staffRouter.post(
  '/',
  validate({ body: createSchema }),
  asyncHandler(async (req, res) => {
    const b = req.validated!.body as z.infer<typeof createSchema>;
    const where = await authorise(req, b.target);
    const top = ['super_admin', 'college_admin', 'department_admin', 'teacher'].find((r) => req.auth!.roles.some((g) => g.role === r))!;
    const notice = await Notice.create({ ...where, publisherId: req.auth!.userId, publisherRole: top, title: b.title, body: b.body, priority: b.priority ?? 'normal', pinned: b.pinned ?? false, expiresAt: b.expiresAt ?? null });
    await notifyNotice(notice, plainTarget(notice));
    await audit({ actorId: req.auth!.userId, action: 'notice.publish', entityType: 'Notice', entityId: notice._id, meta: { scope: b.target.scope, priority: notice.priority }, req });
    sendSuccess(res, { id: String(notice._id) }, undefined, 201);
  }),
);

staffRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const area = isAdmin(req.auth) ? areaFilter(req.auth!) : null;
    const filter = area ? { $or: [{ publisherId: req.auth!.userId }, ...(Object.keys(area).length ? [area] : [{}])] } : { publisherId: req.auth!.userId };
    const notices = await Notice.find(filter).sort({ createdAt: -1 }).limit(100).lean();
    const reads = await NoticeRead.aggregate<{ _id: unknown; n: number }>([{ $match: { noticeId: { $in: notices.map((n) => n._id) } } }, { $group: { _id: '$noticeId', n: { $sum: 1 } } }]);
    const names = await User.find({ _id: { $in: notices.map((n) => n.publisherId) } }).select('name').lean();
    sendSuccess(res, notices.map((n) => ({
      id: String(n._id), title: n.title, body: n.body, priority: n.priority, pinned: n.pinned, status: n.status, scope: plainTarget(n).scope,
      createdAt: n.createdAt, expiresAt: n.expiresAt, edited: n.editHistory.length > 0, mine: String(n.publisherId) === req.auth!.userId,
      publisher: names.find((u) => String(u._id) === String(n.publisherId))?.name ?? '', readCount: reads.find((r) => String(r._id) === String(n._id))?.n ?? 0,
      withdrawal: n.status === 'withdrawn' ? { at: n.withdrawal?.at, reason: n.withdrawal?.reason } : null,
    })));
  }),
);

staffRouter.patch(
  '/:id',
  validate({ params: z.object({ id: objectId }), body: fields.partial().strict() }),
  asyncHandler(async (req, res) => {
    const n = await Notice.findById((req.validated!.params as { id: string }).id);
    if (!n || !canManage(req.auth, n)) throw AppError.notFound();
    if (n.status === 'withdrawn') throw AppError.conflict('A withdrawn notice cannot be edited');
    const b = req.validated!.body as Partial<z.infer<typeof fields>>;
    if ((b.title !== undefined && b.title !== n.title) || (b.body !== undefined && b.body !== n.body)) {
      n.editHistory.push({ at: new Date(), by: req.auth!.userId as any, title: n.title, body: n.body });
      if (n.editHistory.length > 20) n.editHistory.splice(0, n.editHistory.length - 20);
    }
    n.set(b);
    await n.save();
    await audit({ actorId: req.auth!.userId, action: 'notice.edit', entityType: 'Notice', entityId: n._id, req });
    sendSuccess(res, { id: String(n._id) });
  }),
);

/** "Delete for everyone": it leaves every feed at once. The text and who withdrew it are kept for the record. */
staffRouter.post(
  '/:id/withdraw',
  validate({ params: z.object({ id: objectId }), body: z.object({ reason: z.string().trim().min(3).max(300) }).strict() }),
  asyncHandler(async (req, res) => {
    const n = await Notice.findById((req.validated!.params as { id: string }).id);
    if (!n || !canManage(req.auth, n)) throw AppError.notFound();
    if (n.status === 'withdrawn') throw AppError.conflict('This notice is already withdrawn');
    n.status = 'withdrawn';
    n.set('withdrawal', { by: req.auth!.userId, at: new Date(), reason: (req.validated!.body as { reason: string }).reason });
    await n.save();
    await withdrawNoticeNotifications(n._id);
    await audit({ actorId: req.auth!.userId, action: 'notice.withdraw', entityType: 'Notice', entityId: n._id, meta: { reason: n.withdrawal?.reason }, req });
    sendSuccess(res, { id: String(n._id), status: 'withdrawn' });
  }),
);

// ---------------------------------------------------------------- reading (students)

export const studentRouter = Router();
studentRouter.use(authenticate);

async function studentCtx(userId: string): Promise<StudentCtx | null> {
  const p = await StudentProfile.findOne({ userId }).lean();
  if (!p) return null;
  const mine = p.currentSemesterId ? await CourseEnrollment.find({ userId, semesterId: p.currentSemesterId, status: 'active' }).select('offeringId').lean() : [];
  return { collegeId: String(p.collegeId), departmentId: String(p.departmentId), cohortId: String(p.cohortId), semesterId: p.currentSemesterId ? String(p.currentSemesterId) : null, sectionId: p.sectionId ? String(p.sectionId) : null, offeringIds: new Set(mine.map((m) => String(m.offeringId))) };
}

studentRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const ctx = await studentCtx(req.auth!.userId);
    if (!ctx) return sendSuccess(res, { notices: [], unread: 0 });
    const notices = await Notice.find(studentNoticeFilter(ctx)).sort({ pinned: -1, publishAt: -1 }).limit(50).lean();
    const [reads, names] = await Promise.all([
      NoticeRead.find({ userId: req.auth!.userId, noticeId: { $in: notices.map((n) => n._id) } }).select('noticeId').lean(),
      User.find({ _id: { $in: notices.map((n) => n.publisherId) } }).select('name').lean(),
    ]);
    const read = new Set(reads.map((r) => String(r.noticeId)));
    const items = notices.map((n) => ({
      id: String(n._id), title: n.title, body: n.body, priority: n.priority, pinned: n.pinned, publishedAt: n.publishAt, edited: n.editHistory.length > 0,
      publisher: { name: names.find((u) => String(u._id) === String(n.publisherId))?.name ?? '', role: n.publisherRole }, read: read.has(String(n._id)),
    }));
    sendSuccess(res, { notices: items, unread: items.filter((i) => !i.read).length });
  }),
);

studentRouter.post(
  '/:id/read',
  validate({ params: z.object({ id: objectId }) }),
  asyncHandler(async (req, res) => {
    const n = await Notice.findById((req.validated!.params as { id: string }).id).lean();
    const ctx = await studentCtx(req.auth!.userId);
    // A notice that is not for this student does not exist for them.
    if (!n || !ctx || !isVisibleToStudent({ target: plainTarget(n), status: n.status, publishAt: n.publishAt, expiresAt: n.expiresAt }, ctx)) throw AppError.notFound();
    await NoticeRead.updateOne({ noticeId: n._id, userId: req.auth!.userId }, { $setOnInsert: { readAt: new Date() } }, { upsert: true });
    sendSuccess(res, { read: true });
  }),
);
