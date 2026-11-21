/* eslint-disable @typescript-eslint/no-explicit-any */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import mongoose from 'mongoose';
import { z } from 'zod';
import { asyncHandler } from '../../common/asyncHandler';
import { AppError } from '../../common/errors';
import { sendSuccess } from '../../common/response';
import { authenticate, requireRole } from '../../middleware/authenticate';
import { env } from '../../config/env';
import { generateJson } from '../../ai/gemini';
import { AiUsageLog } from '../../ai/ai.models';
import { validate } from '../../middleware/validate';
import { Section } from '../academic/academic.models';
import { objectId } from '../academic/academic.schemas';
import { audit } from '../audit/audit.model';
import { User } from '../auth/auth.models';
import { assertCohortAccess } from '../auth/scope';
import { Course } from '../courses/course.models';
import { CourseOffering } from '../offerings/offering.models';
import { StudentProfile } from '../students/student.models';
import { diffEntries, findConflicts, slotProblem, type Slot } from './routine.logic';
import { RoutineVersion } from './routine.models';
import { notifySection } from '../notifications/notification.service';
import { buildPrompt, buildProposal, parseAiJson, sniffMime, type OfferingOption } from './routine.import';

export const adminRouter = Router();
adminRouter.use(authenticate, requireRole('super_admin', 'college_admin', 'department_admin'));

const scopeSchema = z.object({ cohortId: objectId, semesterId: objectId, sectionId: objectId });
type Scope = z.infer<typeof scopeSchema>;

async function sectionOf(q: Scope) {
  const section = await Section.findOne({ _id: q.sectionId, semesterId: q.semesterId, cohortId: q.cohortId });
  if (!section) throw AppError.badRequest('Section not found for this cohort and semester');
  return section;
}
const plain = (v: any): Slot => ({ day: v.day, startTime: v.startTime, endTime: v.endTime, offeringId: String(v.offeringId), teacherId: v.teacherId ? String(v.teacherId) : null, room: v.room ?? '' });

adminRouter.get(
  '/',
  validate({ query: scopeSchema }),
  asyncHandler(async (req, res) => {
    const q = req.validated!.query as Scope;
    await assertCohortAccess(req.auth!, q.cohortId, 'routine:read');
    await sectionOf(q);
    const versions = await RoutineVersion.find({ semesterId: q.semesterId, sectionId: q.sectionId }).sort({ versionNo: -1 }).lean();
    const draft = versions.find((v) => v.status === 'draft');
    const published = versions.find((v) => v.status === 'published');
    sendSuccess(res, {
      draft: draft ? { entries: draft.entries.map(plain) } : null,
      published: published ? { id: String(published._id), versionNo: published.versionNo, publishedAt: published.publishedAt, changelog: published.changelog, entries: published.entries.map(plain) } : null,
      history: versions.filter((v) => v.status !== 'draft').map((v) => ({ id: String(v._id), versionNo: v.versionNo, status: v.status, publishedAt: v.publishedAt, changelog: v.changelog })),
    });
  }),
);

const entrySchema = z.object({
  day: z.number().int().min(0).max(6),
  startTime: z.string(),
  endTime: z.string(),
  offeringId: objectId,
  teacherId: objectId.nullable().optional(),
  room: z.string().trim().max(40).default(''),
});
type EntryIn = z.infer<typeof entrySchema>;

/** Saves the working copy. Clashes are reported but do not stop saving; they stop publishing. */
async function saveDraft(cohort: any, scope: Scope, entries: EntryIn[]) {
  await sectionOf(scope);
  entries.forEach((e, i) => {
    const problem = slotProblem(e);
    if (problem) throw AppError.badRequest(`Class ${i + 1}: ${problem}`);
  });
  const offerings = await CourseOffering.find({ _id: { $in: entries.map((e) => e.offeringId) }, semesterId: scope.semesterId, cohortId: scope.cohortId }).lean();
  const byId = new Map(offerings.map((o) => [String(o._id), o]));
  entries.forEach((e, i) => {
    const o = byId.get(e.offeringId);
    if (!o) throw AppError.badRequest(`Class ${i + 1}: that course is not offered to this batch this semester`);
    if (e.teacherId && !o.teacherIds.map(String).includes(e.teacherId)) throw AppError.badRequest(`Class ${i + 1}: that person does not teach this course`);
  });
  await RoutineVersion.findOneAndUpdate(
    { semesterId: scope.semesterId, sectionId: scope.sectionId, status: 'draft' },
    { $set: { entries }, $setOnInsert: { institutionId: cohort.institutionId, collegeId: cohort.collegeId, departmentId: cohort.departmentId, cohortId: scope.cohortId } },
    { upsert: true },
  );
}

const draftBody = scopeSchema.extend({ entries: z.array(entrySchema).max(100) }).strict();

adminRouter.put(
  '/draft',
  validate({ body: draftBody }),
  asyncHandler(async (req, res) => {
    const { entries, ...scope } = req.validated!.body as Scope & { entries: EntryIn[] };
    const cohort = await assertCohortAccess(req.auth!, scope.cohortId, 'routine:manage');
    await saveDraft(cohort, scope, entries);
    sendSuccess(res, { saved: entries.length, conflicts: findConflicts(entries.map(plain), []) });
  }),
);

/** Teachers and rooms already booked by the other sections' published routines of this institution. */
async function otherBookings(cohort: any, sectionId: string) {
  const [versions, sections] = await Promise.all([
    RoutineVersion.find({ institutionId: cohort.institutionId, status: 'published', sectionId: { $ne: sectionId } }).lean(),
    Section.find({}).select('name').lean(),
  ]);
  const name = new Map(sections.map((s) => [String(s._id), s.name]));
  return versions.flatMap((v) => v.entries.map((e) => ({ ...plain(e), label: `section ${name.get(String(v.sectionId)) ?? '?'}` })));
}

adminRouter.post(
  '/publish',
  validate({ body: scopeSchema.extend({ effectiveDate: z.coerce.date().optional() }).strict() }),
  asyncHandler(async (req, res) => {
    const b = req.validated!.body as Scope & { effectiveDate?: Date };
    const cohort = await assertCohortAccess(req.auth!, b.cohortId, 'routine:manage');
    await sectionOf(b);
    const draft = await RoutineVersion.findOne({ semesterId: b.semesterId, sectionId: b.sectionId, status: 'draft' });
    if (!draft || draft.entries.length === 0) throw AppError.badRequest('There is no routine to publish. Add at least one class and save first.');

    const entries = draft.entries.map(plain);
    const conflicts = findConflicts(entries, await otherBookings(cohort, b.sectionId));
    if (conflicts.length) throw AppError.conflict(`${conflicts.length} clash(es) must be fixed before publishing`, conflicts);

    const prev = await RoutineVersion.findOne({ semesterId: b.semesterId, sectionId: b.sectionId, status: 'published' });
    const last = await RoutineVersion.findOne({ semesterId: b.semesterId, sectionId: b.sectionId }).sort({ versionNo: -1 }).select('versionNo').lean();
    const db = await mongoose.startSession();
    try {
      await db.withTransaction(async () => {
        if (prev) { prev.status = 'superseded'; await prev.save({ session: db }); }
        draft.status = 'published';
        draft.versionNo = (last?.versionNo ?? 0) + 1;
        draft.changelog = diffEntries(prev ? prev.entries.map(plain) : null, entries);
        draft.effectiveDate = b.effectiveDate ?? null;
        draft.publishedBy = new mongoose.Types.ObjectId(req.auth!.userId);
        draft.publishedAt = new Date();
        await draft.save({ session: db });
      });
    } finally {
      await db.endSession();
    }
    await notifySection(b.sectionId, b.semesterId, { type: 'routine', title: 'Class routine updated', body: draft.changelog.join('. '), refKind: 'routine', refId: draft._id, dedupeKey: `routine:${String(draft._id)}` });
    await audit({ actorId: req.auth!.userId, action: 'routine.publish', entityType: 'RoutineVersion', entityId: draft._id, meta: { versionNo: draft.versionNo, changelog: draft.changelog }, req });
    sendSuccess(res, { versionNo: draft.versionNo, changelog: draft.changelog });
  }),
);

/** Puts an older version back as the working copy. Publish it to make it live again. */
adminRouter.post(
  '/restore',
  validate({ body: z.object({ versionId: objectId }).strict() }),
  asyncHandler(async (req, res) => {
    const version = await RoutineVersion.findById((req.validated!.body as { versionId: string }).versionId);
    if (!version) throw AppError.notFound();
    const cohort = await assertCohortAccess(req.auth!, version.cohortId, 'routine:manage');
    await saveDraft(cohort, { cohortId: String(version.cohortId), semesterId: String(version.semesterId), sectionId: String(version.sectionId) }, version.entries.map((e) => ({ ...plain(e), room: e.room ?? '' })) as EntryIn[]);
    await audit({ actorId: req.auth!.userId, action: 'routine.restore', entityType: 'RoutineVersion', entityId: version._id, meta: { versionNo: version.versionNo }, req });
    sendSuccess(res, { restored: version.versionNo });
  }),
);

// ---------------------------------------------------------------- read a routine from a PDF or photo

export const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
export const aiLimiter = rateLimit({
  windowMs: 3_600_000,
  limit: 15,
  keyGenerator: (req) => (req as any).auth?.userId ?? 'anonymous',
  skip: () => env.NODE_ENV === 'test',
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  validate: false,
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'You have read many routines this hour. Please wait a little.' } },
});

/**
 * Reads a routine file with AI and returns PROPOSED rows only. Nothing is saved and nothing is published:
 * an admin reviews the rows, saves them as a draft and publishes in the usual way.
 */
adminRouter.post(
  '/import',
  aiLimiter,
  (req, res, next) => upload.single('file')(req, res, (err: any) => (err ? next(AppError.badRequest(err.code === 'LIMIT_FILE_SIZE' ? 'The file is too large (8 MB at most)' : 'Upload failed')) : next())),
  asyncHandler(async (req, res) => {
    const scope = scopeSchema.parse(req.body);
    await assertCohortAccess(req.auth!, scope.cohortId, 'routine:manage');
    const section = await sectionOf(scope);
    if (!req.file) throw AppError.badRequest('Choose a PDF or an image first');
    const mime = sniffMime(req.file.buffer);
    if (!mime) throw AppError.badRequest('Only PDF, PNG, JPG or WEBP files are accepted');

    const offerings = await CourseOffering.find({ cohortId: scope.cohortId, semesterId: scope.semesterId, status: 'active' }).lean();
    const [courses, teachers] = await Promise.all([
      Course.find({ _id: { $in: offerings.map((o) => o.courseId) } }).select('code name').lean(),
      User.find({ _id: { $in: offerings.flatMap((o) => o.teacherIds) } }).select('name').lean(),
    ]);
    const options: OfferingOption[] = offerings.map((o) => {
      const c = courses.find((x) => String(x._id) === String(o.courseId));
      return { id: String(o._id), code: c?.code ?? '', name: c?.name ?? '', teachers: o.teacherIds.map((t) => ({ id: String(t), name: teachers.find((u) => String(u._id) === String(t))?.name ?? '' })) };
    });

    const started = Date.now();
    let status: 'ok' | 'error' = 'error';
    try {
      const answer = await generateJson(buildPrompt(options, section.name), { mime, data: req.file.buffer });
      let parsed;
      try {
        parsed = parseAiJson(answer);
      } catch {
        throw new AppError(502, 'AI_BAD_ANSWER', 'The AI answered in a way we could not use. Try again, or use a clearer file.');
      }
      status = 'ok';
      const rows = buildProposal(parsed.entries, options, section.name);
      await audit({ actorId: req.auth!.userId, action: 'routine.import.read', entityType: 'Section', entityId: section._id, meta: { fileName: req.file.originalname.slice(0, 120), rows: rows.length }, req });
      sendSuccess(res, { fileName: req.file.originalname, notes: parsed.notes, rows });
    } finally {
      AiUsageLog.create({ userId: req.auth!.userId, task: 'routine_import', provider: 'gemini', model: env.GEMINI_MODEL, status, inputBytes: req.file.size, latencyMs: Date.now() - started }).catch(() => undefined);
    }
  }),
);

// ---------------------------------------------------------------- the student's own routine

export const studentRouter = Router();
studentRouter.use(authenticate);

studentRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    const profile = await StudentProfile.findOne({ userId: req.auth!.userId }).lean();
    if (!profile?.currentSemesterId || !profile.sectionId) return sendSuccess(res, { routine: null, reason: profile ? 'no_section' : 'not_a_student' });
    const version = await RoutineVersion.findOne({ semesterId: profile.currentSemesterId, sectionId: profile.sectionId, status: 'published' }).lean();
    if (!version) return sendSuccess(res, { routine: null, reason: 'not_published' });

    const offerings = await CourseOffering.find({ _id: { $in: version.entries.map((e) => e.offeringId) } }).lean();
    const [courses, teachers] = await Promise.all([
      Course.find({ _id: { $in: offerings.map((o) => o.courseId) } }).select('code name').lean(),
      User.find({ _id: { $in: version.entries.map((e) => e.teacherId).filter(Boolean) } }).select('name').lean(),
    ]);
    const course = new Map(offerings.map((o) => [String(o._id), courses.find((c) => String(c._id) === String(o.courseId))]));
    const teacher = new Map(teachers.map((t) => [String(t._id), t.name]));
    sendSuccess(res, {
      routine: {
        versionNo: version.versionNo,
        publishedAt: version.publishedAt,
        entries: version.entries
          .map((e) => ({ day: e.day, startTime: e.startTime, endTime: e.endTime, room: e.room ?? '', teacher: e.teacherId ? teacher.get(String(e.teacherId)) ?? null : null, course: { code: course.get(String(e.offeringId))?.code ?? '', name: course.get(String(e.offeringId))?.name ?? '' } }))
          .sort((a, b) => a.day - b.day || a.startTime.localeCompare(b.startTime)),
      },
    });
  }),
);
