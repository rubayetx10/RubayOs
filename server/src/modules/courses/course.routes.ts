import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../common/asyncHandler';
import { AppError } from '../../common/errors';
import { sendSuccess } from '../../common/response';
import { authenticate, requireRole } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { Program } from '../academic/academic.models';
import { objectId } from '../academic/academic.schemas';
import { audit } from '../audit/audit.model';
import { can, type Resource } from '../auth/policy';
import { areaFilter } from '../auth/scope';
import { parseCsv } from '../roster/rosterImport';
import { Course } from './course.models';
import { detectCourseMapping, mapCourseRows, validateCourseRows } from './courseImport';

const router = Router();
router.use(authenticate, requireRole('super_admin', 'college_admin', 'department_admin'));

// Courses belong to a program, so they follow the program's department for access.
const where = (d: { institutionId: unknown; collegeId: unknown; departmentId: unknown }): Resource => ({
  kind: 'program',
  institutionId: String(d.institutionId),
  collegeId: String(d.collegeId),
  departmentId: String(d.departmentId),
});

const fields = z.object({
  name: z.string().trim().min(2).max(160),
  credit: z.number().min(0.5).max(12),
  type: z.enum(['theory', 'lab', 'elective']),
  semesterNumber: z.number().int().min(1).max(16),
  description: z.string().trim().max(1000),
});
const createSchema = fields.partial({ type: true, description: true }).extend({ programId: objectId, code: z.string().trim().min(1).max(30) }).strict();
const updateSchema = fields.partial().extend({ status: z.enum(['draft', 'published', 'archived']).optional() }).strict();

const listQuery = z.object({
  programId: objectId.optional(),
  semesterNumber: z.coerce.number().int().min(1).max(16).optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  q: z.string().trim().max(60).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

router.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const q = req.validated!.query as z.infer<typeof listQuery>;
    const base: Record<string, unknown> = {};
    for (const k of ['programId', 'semesterNumber', 'status'] as const) if (q[k] !== undefined) base[k] = q[k];
    if (q.q) {
      const rx = new RegExp(q.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      base['$or'] = [{ code: rx }, { name: rx }];
    }
    const area = areaFilter(req.auth!);
    const filter = Object.keys(area).length ? { $and: [base, area] } : base;
    const [items, total] = await Promise.all([
      Course.find(filter).sort({ semesterNumber: 1, code: 1 }).skip((q.page - 1) * q.limit).limit(q.limit),
      Course.countDocuments(filter),
    ]);
    sendSuccess(res, items, { page: q.page, limit: q.limit, total });
  }),
);

router.post(
  '/',
  validate({ body: createSchema }),
  asyncHandler(async (req, res) => {
    const b = req.validated!.body as z.infer<typeof createSchema>;
    const program = await Program.findById(b.programId).lean();
    if (!program) throw AppError.badRequest('Program not found');
    if (!can(req.auth!.roles, 'course:create', where(program))) throw AppError.forbidden('This is outside your area');
    if (b.semesterNumber > program.semesterCount) throw AppError.badRequest(`This program has only ${program.semesterCount} semesters`);

    const course = await Course.create({
      ...b,
      code: b.code.toUpperCase(),
      institutionId: program.institutionId,
      collegeId: program.collegeId,
      departmentId: program.departmentId,
    });
    await audit({ actorId: req.auth!.userId, action: 'course.create', entityType: 'Course', entityId: course._id, meta: { code: course.code }, req });
    sendSuccess(res, course, undefined, 201);
  }),
);

router.patch(
  '/:id',
  validate({ params: z.object({ id: objectId }), body: updateSchema }),
  asyncHandler(async (req, res) => {
    const course = await Course.findById((req.validated!.params as { id: string }).id);
    if (!course || !can(req.auth!.roles, 'course:read', where(course))) throw AppError.notFound();
    if (!can(req.auth!.roles, 'course:update', where(course))) throw AppError.forbidden('You can view this but not change it');
    course.set(req.validated!.body as Record<string, unknown>);
    await course.save();
    await audit({ actorId: req.auth!.userId, action: 'course.update', entityType: 'Course', entityId: course._id, meta: req.validated!.body as Record<string, unknown>, req });
    sendSuccess(res, course);
  }),
);

const importSchema = z.object({ programId: objectId, csv: z.string().min(1).max(1_000_000), dryRun: z.boolean().default(false) }).strict();

router.post(
  '/import',
  validate({ body: importSchema }),
  asyncHandler(async (req, res) => {
    const b = req.validated!.body as z.infer<typeof importSchema>;
    const program = await Program.findById(b.programId).lean();
    if (!program) throw AppError.badRequest('Program not found');
    if (!can(req.auth!.roles, 'course:create', where(program))) throw AppError.forbidden('This is outside your area');

    const parsed = parseCsv(b.csv);
    const detected = detectCourseMapping(parsed.headers);
    if (!detected.mapping) {
      throw AppError.badRequest(`Could not find column(s): ${detected.missing.join(', ')}`, { headers: parsed.headers, missing: detected.missing });
    }
    const { valid, errors } = validateCourseRows(mapCourseRows(parsed.rows, detected.mapping));
    for (const row of valid) {
      if (row.semesterNumber > program.semesterCount) errors.push({ rowNo: row.rowNo, message: `Semester ${row.semesterNumber} is beyond this program's ${program.semesterCount} semesters` });
    }
    const ok = valid.filter((r) => r.semesterNumber <= program.semesterCount);
    errors.sort((a, c) => a.rowNo - c.rowNo);

    const existing = await Course.find({ programId: program._id, code: { $in: ok.map((r) => r.code) } }).select('code').lean();
    const have = new Set(existing.map((e) => e.code));
    const created = ok.filter((r) => !have.has(r.code)).length;
    const updated = ok.length - created;

    if (!b.dryRun && ok.length) {
      await Course.bulkWrite(
        ok.map((r) => ({
          updateOne: {
            filter: { programId: program._id, code: r.code },
            update: {
              $set: { name: r.name, credit: r.credit, semesterNumber: r.semesterNumber, type: r.type },
              $setOnInsert: { institutionId: program.institutionId, collegeId: program.collegeId, departmentId: program.departmentId, status: 'published', description: '' },
            },
            upsert: true,
          },
        })),
        { ordered: false },
      );
      await audit({ actorId: req.auth!.userId, action: 'course.import', entityType: 'Program', entityId: program._id, meta: { created, updated, errors: errors.length }, req });
    }
    sendSuccess(res, { dryRun: b.dryRun, total: parsed.rows.length, created, updated, errors });
  }),
);

export default router;
