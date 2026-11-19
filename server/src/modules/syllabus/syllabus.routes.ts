/* eslint-disable @typescript-eslint/no-explicit-any */
import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { asyncHandler } from '../../common/asyncHandler';
import { AppError } from '../../common/errors';
import { sendSuccess } from '../../common/response';
import { env } from '../../config/env';
import { generateJson } from '../../ai/gemini';
import { AiUsageLog } from '../../ai/ai.models';
import { authenticate, requireRole } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { objectId } from '../academic/academic.schemas';
import { audit } from '../audit/audit.model';
import { User } from '../auth/auth.models';
import { can, type Resource } from '../auth/policy';
import { Course } from '../courses/course.models';
import { CourseEnrollment, CourseOffering } from '../offerings/offering.models';
import { sniffMime } from '../routines/routine.import';
import { aiLimiter, upload } from '../routines/routine.routes';
import { StudentProfile } from '../students/student.models';
import { buildSyllabusPrompt, cleanSyllabus, diffSyllabus, parseSyllabusJson } from './syllabus.logic';
import { Syllabus } from './syllabus.models';

export const adminRouter = Router();
adminRouter.use(authenticate, requireRole('super_admin', 'college_admin', 'department_admin'));

const where = (c: any): Resource => ({ kind: 'program', institutionId: String(c.institutionId), collegeId: String(c.collegeId), departmentId: String(c.departmentId) });

/** A course outside the caller's area does not exist for them (404). Changing needs the update right (403). */
async function courseFor(req: any, courseId: string, write: boolean) {
  const course = await Course.findById(courseId);
  if (!course || !can(req.auth.roles, 'course:read', where(course))) throw AppError.notFound('Course not found');
  if (write && !can(req.auth.roles, 'course:update', where(course))) throw AppError.forbidden('You can view this but not change it');
  return course;
}
const body = (v: any) => ({ objectives: [...v.objectives], topics: v.topics.map((t: any) => ({ title: t.title, subtopics: [...t.subtopics] })) });

adminRouter.get(
  '/',
  validate({ query: z.object({ courseId: objectId }) }),
  asyncHandler(async (req, res) => {
    const courseId = (req.validated!.query as { courseId: string }).courseId;
    await courseFor(req, courseId, false);
    const versions = await Syllabus.find({ courseId }).sort({ versionNo: -1 }).lean();
    const draft = versions.find((v) => v.status === 'draft');
    const live = versions.find((v) => v.status === 'published');
    sendSuccess(res, {
      draft: draft ? body(draft) : null,
      published: live ? { id: String(live._id), versionNo: live.versionNo, publishedAt: live.publishedAt, changelog: live.changelog, ...body(live) } : null,
      history: versions.filter((v) => v.status !== 'draft').map((v) => ({ id: String(v._id), versionNo: v.versionNo, status: v.status, publishedAt: v.publishedAt, changelog: v.changelog })),
    });
  }),
);

const draftSchema = z
  .object({
    courseId: objectId,
    objectives: z.array(z.string().max(300)).max(60),
    topics: z.array(z.object({ title: z.string().max(200), subtopics: z.array(z.string().max(300)).max(100) })).max(200),
  })
  .strict();

async function saveDraft(course: any, data: { objectives?: unknown; topics?: unknown }) {
  const clean = cleanSyllabus(data);
  await Syllabus.findOneAndUpdate(
    { courseId: course._id, status: 'draft' },
    { $set: clean, $setOnInsert: { institutionId: course.institutionId, collegeId: course.collegeId, departmentId: course.departmentId, programId: course.programId } },
    { upsert: true },
  );
  return clean;
}

adminRouter.put(
  '/draft',
  validate({ body: draftSchema }),
  asyncHandler(async (req, res) => {
    const b = req.validated!.body as z.infer<typeof draftSchema>;
    const course = await courseFor(req, b.courseId, true);
    const clean = await saveDraft(course, b);
    sendSuccess(res, { topics: clean.topics.length, objectives: clean.objectives.length });
  }),
);

adminRouter.post(
  '/publish',
  validate({ body: z.object({ courseId: objectId }).strict() }),
  asyncHandler(async (req, res) => {
    const course = await courseFor(req, (req.validated!.body as { courseId: string }).courseId, true);
    const draft = await Syllabus.findOne({ courseId: course._id, status: 'draft' });
    if (!draft || draft.topics.length === 0) throw AppError.badRequest('Add at least one topic and save before publishing.');
    const prev = await Syllabus.findOne({ courseId: course._id, status: 'published' });
    const last = await Syllabus.findOne({ courseId: course._id }).sort({ versionNo: -1 }).select('versionNo').lean();

    const db = await mongoose.startSession();
    try {
      await db.withTransaction(async () => {
        if (prev) { prev.status = 'superseded'; await prev.save({ session: db }); }
        draft.status = 'published';
        draft.versionNo = (last?.versionNo ?? 0) + 1;
        draft.changelog = diffSyllabus(prev ? body(prev) : null, body(draft));
        draft.publishedBy = new mongoose.Types.ObjectId(req.auth!.userId);
        draft.publishedAt = new Date();
        await draft.save({ session: db });
      });
    } finally {
      await db.endSession();
    }
    await audit({ actorId: req.auth!.userId, action: 'syllabus.publish', entityType: 'Syllabus', entityId: draft._id, meta: { versionNo: draft.versionNo, changelog: draft.changelog }, req });
    sendSuccess(res, { versionNo: draft.versionNo, changelog: draft.changelog });
  }),
);

adminRouter.post(
  '/restore',
  validate({ body: z.object({ versionId: objectId }).strict() }),
  asyncHandler(async (req, res) => {
    const v = await Syllabus.findById((req.validated!.body as { versionId: string }).versionId);
    if (!v) throw AppError.notFound();
    const course = await courseFor(req, String(v.courseId), true);
    await saveDraft(course, body(v));
    await audit({ actorId: req.auth!.userId, action: 'syllabus.restore', entityType: 'Syllabus', entityId: v._id, meta: { versionNo: v.versionNo }, req });
    sendSuccess(res, { restored: v.versionNo });
  }),
);

/** Reads a syllabus file with AI and returns a PROPOSAL only. Nothing is saved or published. */
adminRouter.post(
  '/import',
  aiLimiter,
  (req, res, next) => upload.single('file')(req, res, (err: any) => (err ? next(AppError.badRequest(err.code === 'LIMIT_FILE_SIZE' ? 'The file is too large (8 MB at most)' : 'Upload failed')) : next())),
  asyncHandler(async (req, res) => {
    const { courseId } = z.object({ courseId: objectId }).parse(req.body);
    const course = await courseFor(req, courseId, true);
    if (!req.file) throw AppError.badRequest('Choose a PDF or an image first');
    const mime = sniffMime(req.file.buffer);
    if (!mime) throw AppError.badRequest('Only PDF, PNG, JPG or WEBP files are accepted');

    const started = Date.now();
    let status: 'ok' | 'error' = 'error';
    try {
      const answer = await generateJson(buildSyllabusPrompt(course), { mime, data: req.file.buffer });
      let parsed;
      try {
        parsed = parseSyllabusJson(answer);
      } catch {
        throw new AppError(502, 'AI_BAD_ANSWER', 'The AI answered in a way we could not use. Try again, or use a clearer file.');
      }
      status = 'ok';
      await audit({ actorId: req.auth!.userId, action: 'syllabus.import.read', entityType: 'Course', entityId: course._id, meta: { fileName: req.file.originalname.slice(0, 120), topics: parsed.body.topics.length }, req });
      sendSuccess(res, { fileName: req.file.originalname, notes: parsed.notes, ...parsed.body });
    } finally {
      AiUsageLog.create({ userId: req.auth!.userId, task: 'syllabus_import', provider: 'gemini', model: env.GEMINI_MODEL, status, inputBytes: req.file.size, latencyMs: Date.now() - started }).catch(() => undefined);
    }
  }),
);

// ---------------------------------------------------------------- the student's own courses

export const studentRouter = Router();
studentRouter.use(authenticate);

studentRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    const profile = await StudentProfile.findOne({ userId: req.auth!.userId }).lean();
    if (!profile?.currentSemesterId) return sendSuccess(res, { courses: [] });
    const mine = await CourseEnrollment.find({ userId: req.auth!.userId, semesterId: profile.currentSemesterId, status: 'active' }).select('offeringId').lean();
    const offerings = await CourseOffering.find({ _id: { $in: mine.map((m) => m.offeringId) }, status: 'active' }).lean();
    const [courses, teachers, syllabi] = await Promise.all([
      Course.find({ _id: { $in: offerings.map((o) => o.courseId) }, status: 'published' }).lean(),
      User.find({ _id: { $in: offerings.flatMap((o) => o.teacherIds) } }).select('name').lean(),
      Syllabus.find({ courseId: { $in: offerings.map((o) => o.courseId) }, status: 'published' }).lean(),
    ]);
    sendSuccess(res, {
      courses: courses
        .map((c) => {
          const o = offerings.find((x) => String(x.courseId) === String(c._id))!;
          const s = syllabi.find((x) => String(x.courseId) === String(c._id));
          return {
            course: { id: String(c._id), code: c.code, name: c.name, credit: c.credit, type: c.type },
            teachers: o.teacherIds.map((t) => teachers.find((u) => String(u._id) === String(t))?.name ?? '').filter(Boolean),
            syllabus: s ? { versionNo: s.versionNo, objectives: s.objectives, topics: s.topics.map((t) => ({ title: t.title, subtopics: [...t.subtopics] })) } : null,
          };
        })
        .sort((a, b) => a.course.code.localeCompare(b.course.code)),
    });
  }),
);
