/* eslint-disable @typescript-eslint/no-explicit-any */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../common/asyncHandler';
import { AppError } from '../../common/errors';
import { sendSuccess } from '../../common/response';
import { env } from '../../config/env';
import { generateJson } from '../../ai/gemini';
import { AiUsageLog } from '../../ai/ai.models';
import { authenticate, requireRole } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { Semester } from '../academic/academic.models';
import { objectId } from '../academic/academic.schemas';
import { audit } from '../audit/audit.model';
import { assertCohortAccess } from '../auth/scope';
import { Course } from '../courses/course.models';
import { CourseEnrollment, CourseOffering } from '../offerings/offering.models';
import { aiLimiter, upload } from '../routines/routine.routes';
import { parseAiJson, sniffMime, type OfferingOption } from '../routines/routine.import';
import { StudentProfile } from '../students/student.models';
import { buildExamPrompt, buildExamProposal, examProblem, findExamConflicts } from './exam.logic';
import { ExamEvent } from './exam.models';
import { courseCodeOfOffering, notifyOfferingStudents } from '../notifications/notification.service';

export const adminRouter = Router();
adminRouter.use(authenticate, requireRole('super_admin', 'college_admin', 'department_admin'));

const scopeSchema = z.object({ cohortId: objectId, semesterId: objectId });
type Scope = z.infer<typeof scopeSchema>;

async function semesterOf(s: Scope) {
  const semester = await Semester.findOne({ _id: s.semesterId, cohortId: s.cohortId });
  if (!semester) throw AppError.badRequest('Semester not found for this cohort');
  return semester;
}

/** The courses of this batch this semester, with teachers not needed here. */
async function offeringOptions(s: Scope): Promise<OfferingOption[]> {
  const offerings = await CourseOffering.find({ cohortId: s.cohortId, semesterId: s.semesterId, status: 'active' }).lean();
  const courses = await Course.find({ _id: { $in: offerings.map((o) => o.courseId) } }).select('code name').lean();
  return offerings.map((o) => {
    const c = courses.find((x) => String(x._id) === String(o.courseId));
    return { id: String(o._id), code: c?.code ?? '', name: c?.name ?? '', teachers: [] };
  });
}

adminRouter.get(
  '/',
  validate({ query: scopeSchema }),
  asyncHandler(async (req, res) => {
    const q = req.validated!.query as Scope;
    await assertCohortAccess(req.auth!, q.cohortId, 'exam:read');
    await semesterOf(q);
    const [events, options] = await Promise.all([ExamEvent.find(q).sort({ date: 1, startTime: 1 }).lean(), offeringOptions(q)]);
    const opt = new Map(options.map((o) => [o.id, o]));
    sendSuccess(
      res,
      events.map((e) => ({ id: String(e._id), offeringId: String(e.offeringId), course: opt.get(String(e.offeringId)) ? { code: opt.get(String(e.offeringId))!.code, name: opt.get(String(e.offeringId))!.name } : null, title: e.title, date: e.date, startTime: e.startTime, endTime: e.endTime, room: e.room, status: e.status })),
    );
  }),
);

const eventSchema = z.object({
  offeringId: objectId,
  title: z.string().trim().max(60).default('Exam'),
  date: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  room: z.string().trim().max(40).default(''),
  instructions: z.string().trim().max(1000).default(''),
});

/** Adds exams as DRAFTS. Students see nothing until they are published. */
adminRouter.post(
  '/bulk',
  validate({ body: scopeSchema.extend({ events: z.array(eventSchema).min(1).max(100) }).strict() }),
  asyncHandler(async (req, res) => {
    const b = req.validated!.body as Scope & { events: z.infer<typeof eventSchema>[] };
    const cohort = await assertCohortAccess(req.auth!, b.cohortId, 'exam:manage');
    await semesterOf(b);
    const ids = new Set((await CourseOffering.find({ cohortId: b.cohortId, semesterId: b.semesterId }).select('_id').lean()).map((o) => String(o._id)));
    b.events.forEach((e, i) => {
      const problem = examProblem(e);
      if (problem) throw AppError.badRequest(`Exam ${i + 1}: ${problem}`);
      if (!ids.has(e.offeringId)) throw AppError.badRequest(`Exam ${i + 1}: that course is not offered to this batch this semester`);
    });
    await ExamEvent.insertMany(b.events.map((e) => ({ ...e, institutionId: cohort.institutionId, collegeId: cohort.collegeId, departmentId: cohort.departmentId, cohortId: b.cohortId, semesterId: b.semesterId })));
    await audit({ actorId: req.auth!.userId, action: 'exam.add', entityType: 'Cohort', entityId: b.cohortId, meta: { count: b.events.length }, req });
    sendSuccess(res, { added: b.events.length }, undefined, 201);
  }),
);

const patchSchema = eventSchema.partial().omit({ offeringId: true }).extend({ status: z.enum(['draft', 'cancelled']).optional() }).strict();

adminRouter.patch(
  '/:id',
  validate({ params: z.object({ id: objectId }), body: patchSchema }),
  asyncHandler(async (req, res) => {
    const ev = await ExamEvent.findById((req.validated!.params as { id: string }).id);
    if (!ev) throw AppError.notFound();
    await assertCohortAccess(req.auth!, ev.cohortId, 'exam:manage');
    const b = req.validated!.body as Record<string, any>;
    const next = { date: b['date'] ?? ev.date, startTime: b['startTime'] ?? ev.startTime, endTime: b['endTime'] ?? ev.endTime };
    const problem = examProblem(next);
    if (problem) throw AppError.badRequest(problem);
    const changed = ['date', 'startTime', 'endTime', 'room'].some((k) => b[k] !== undefined && b[k] !== (ev as any)[k]);
    // A published exam stays published when edited or cancelled, so students see the change at once.
    ev.set({ ...b, ...(b['status'] === 'draft' && ev.status === 'published' ? { status: 'published' } : {}) });
    await ev.save();
    if (ev.publishedAt && (b['status'] === 'cancelled' || changed)) {
      const cancelled = b['status'] === 'cancelled';
      await notifyOfferingStudents(ev.offeringId, { type: 'exam', title: `${cancelled ? 'Exam cancelled' : 'Exam changed'}: ${await courseCodeOfOffering(ev.offeringId)} ${ev.title}`, body: cancelled ? `${ev.date} ${ev.startTime}-${ev.endTime}` : `Now ${ev.date} ${ev.startTime}-${ev.endTime}${ev.room ? ` · Room ${ev.room}` : ''}`, priority: 'urgent', refKind: 'exam', refId: ev._id, dedupeKey: `exam:${String(ev._id)}:${cancelled ? 'cancelled' : `changed:${Date.now()}`}` });
    }
    await audit({ actorId: req.auth!.userId, action: b['status'] === 'cancelled' ? 'exam.cancel' : 'exam.update', entityType: 'ExamEvent', entityId: ev._id, meta: b, req });
    sendSuccess(res, { id: String(ev._id), status: ev.status });
  }),
);

adminRouter.post(
  '/publish',
  validate({ body: scopeSchema.strict() }),
  asyncHandler(async (req, res) => {
    const b = req.validated!.body as Scope;
    const cohort = await assertCohortAccess(req.auth!, b.cohortId, 'exam:manage');
    await semesterOf(b);
    const drafts = await ExamEvent.find({ ...b, status: 'draft' });
    if (drafts.length === 0) throw AppError.badRequest('There are no draft exams to publish.');

    const live = await ExamEvent.find({ ...b, status: 'published' }).lean();
    const elsewhere = await ExamEvent.find({ institutionId: cohort.institutionId, status: 'published', cohortId: { $ne: b.cohortId } }).lean();
    const label = (e: any) => `another batch’s ${e.title}`;
    const conflicts = findExamConflicts([...live, ...drafts.map((d) => d.toObject())], elsewhere.map((e) => ({ date: e.date, startTime: e.startTime, endTime: e.endTime, room: e.room, label: label(e) })));
    if (conflicts.length) throw AppError.conflict(`${conflicts.length} clash(es) must be fixed before publishing`, conflicts);

    await ExamEvent.updateMany({ _id: { $in: drafts.map((d) => d._id) } }, { $set: { status: 'published', publishedAt: new Date(), publishedBy: req.auth!.userId } });
    for (const d of drafts) {
      await notifyOfferingStudents(d.offeringId, { type: 'exam', title: `New exam: ${await courseCodeOfOffering(d.offeringId)} ${d.title}`, body: `${d.date} ${d.startTime}-${d.endTime}${d.room ? ` · Room ${d.room}` : ''}`, priority: 'important', refKind: 'exam', refId: d._id, dedupeKey: `exam:${String(d._id)}:published` });
    }
    await audit({ actorId: req.auth!.userId, action: 'exam.publish', entityType: 'Cohort', entityId: b.cohortId, meta: { count: drafts.length }, req });
    sendSuccess(res, { published: drafts.length });
  }),
);

/** Reads an exam schedule file with AI and returns PROPOSED rows only. Nothing is saved. */
adminRouter.post(
  '/import',
  aiLimiter,
  (req, res, next) => upload.single('file')(req, res, (err: any) => (err ? next(AppError.badRequest(err.code === 'LIMIT_FILE_SIZE' ? 'The file is too large (8 MB at most)' : 'Upload failed')) : next())),
  asyncHandler(async (req, res) => {
    const scope = scopeSchema.parse(req.body);
    await assertCohortAccess(req.auth!, scope.cohortId, 'exam:manage');
    await semesterOf(scope);
    if (!req.file) throw AppError.badRequest('Choose a PDF or an image first');
    const mime = sniffMime(req.file.buffer);
    if (!mime) throw AppError.badRequest('Only PDF, PNG, JPG or WEBP files are accepted');

    const options = await offeringOptions(scope);
    const started = Date.now();
    let status: 'ok' | 'error' = 'error';
    try {
      const answer = await generateJson(buildExamPrompt(options), { mime, data: req.file.buffer });
      let parsed;
      try {
        parsed = parseAiJson(answer);
      } catch {
        throw new AppError(502, 'AI_BAD_ANSWER', 'The AI answered in a way we could not use. Try again, or use a clearer file.');
      }
      status = 'ok';
      const rows = buildExamProposal(parsed.entries, options, 'Exam');
      await audit({ actorId: req.auth!.userId, action: 'exam.import.read', entityType: 'Cohort', entityId: scope.cohortId, meta: { fileName: req.file.originalname.slice(0, 120), rows: rows.length }, req });
      sendSuccess(res, { fileName: req.file.originalname, notes: parsed.notes, rows });
    } finally {
      AiUsageLog.create({ userId: req.auth!.userId, task: 'exam_import', provider: 'gemini', model: env.GEMINI_MODEL, status, inputBytes: req.file.size, latencyMs: Date.now() - started }).catch(() => undefined);
    }
  }),
);

// ---------------------------------------------------------------- the student's own exams

export const studentRouter = Router();
studentRouter.use(authenticate);

studentRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    const profile = await StudentProfile.findOne({ userId: req.auth!.userId }).lean();
    if (!profile?.currentSemesterId) return sendSuccess(res, { exams: [] });
    const mine = await CourseEnrollment.find({ userId: req.auth!.userId, semesterId: profile.currentSemesterId, status: 'active' }).select('offeringId').lean();
    // Only exams that were published at some point; a cancelled one is shown as cancelled.
    const events = await ExamEvent.find({ semesterId: profile.currentSemesterId, offeringId: { $in: mine.map((m) => m.offeringId) }, status: { $in: ['published', 'cancelled'] }, publishedAt: { $ne: null } }).sort({ date: 1, startTime: 1 }).lean();
    const offerings = await CourseOffering.find({ _id: { $in: events.map((e) => e.offeringId) } }).lean();
    const courses = await Course.find({ _id: { $in: offerings.map((o) => o.courseId) } }).select('code name').lean();
    const course = new Map(offerings.map((o) => [String(o._id), courses.find((c) => String(c._id) === String(o.courseId))]));
    sendSuccess(res, {
      exams: events.map((e) => ({ id: String(e._id), title: e.title, date: e.date, startTime: e.startTime, endTime: e.endTime, room: e.room, instructions: e.instructions, cancelled: e.status === 'cancelled', course: { code: course.get(String(e.offeringId))?.code ?? '', name: course.get(String(e.offeringId))?.name ?? '' } })),
    });
  }),
);
