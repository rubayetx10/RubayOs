import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../common/asyncHandler';
import { randomToken } from '../../common/crypto';
import { AppError } from '../../common/errors';
import { sendSuccess } from '../../common/response';
import { authenticate, requireRole } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { objectId } from '../academic/academic.schemas';
import { audit } from '../audit/audit.model';
import { assertCohortAccess } from '../auth/scope';
import { RosterEntry } from '../students/student.models';
import { changeRoll } from '../enrollment/enrollment.service';
import { normalizeName } from '../students/nameMatch';
import { detectMapping, mapRows, parseCsv, validateRows, type Mapping } from './rosterImport';

const router = Router();
router.use(authenticate, requireRole('super_admin', 'college_admin', 'department_admin'));

const importSchema = z
  .object({
    cohortId: objectId,
    // Either a CSV text (columns are detected) or rows already read from Excel by the client.
    csv: z.string().max(2_000_000).optional(),
    rows: z.array(z.record(z.unknown())).max(5000).optional(),
    mapping: z.object({ name: z.string(), registrationNo: z.string(), classRoll: z.string() }).optional(),
    dryRun: z.boolean().default(false),
  })
  .strict()
  .refine((v) => Boolean(v.csv) !== Boolean(v.rows), { message: 'Send either csv or rows, not both' });

router.post(
  '/import',
  validate({ body: importSchema }),
  asyncHandler(async (req, res) => {
    const body = req.validated!.body as z.infer<typeof importSchema>;
    const cohort = await assertCohortAccess(req.auth!, body.cohortId, 'roster:manage');

    let rawRows: Record<string, unknown>[];
    let mapping: Mapping | undefined = body.mapping;
    if (body.csv) {
      const parsed = parseCsv(body.csv);
      if (!mapping) {
        const detected = detectMapping(parsed.headers);
        if (!detected.mapping) {
          throw AppError.badRequest(`Could not find column(s): ${detected.missing.join(', ')}`, { headers: parsed.headers, missing: detected.missing });
        }
        mapping = detected.mapping;
      }
      rawRows = mapRows(parsed.rows, mapping);
    } else {
      rawRows = body.rows!;
      if (mapping) rawRows = mapRows(rawRows, mapping);
    }
    if (rawRows.length === 0) throw AppError.badRequest('The file has no student rows');

    const { valid, errors } = validateRows(rawRows);
    const regs = valid.map((r) => r.registrationNo);
    const rolls = valid.map((r) => r.classRoll);

    const [byReg, byRoll] = await Promise.all([
      RosterEntry.find({ institutionId: cohort.institutionId, registrationNo: { $in: regs } }).lean(),
      RosterEntry.find({ cohortId: cohort._id, classRoll: { $in: rolls } }).lean(),
    ]);
    const regMap = new Map(byReg.map((e) => [e.registrationNo, e]));
    const rollMap = new Map(byRoll.map((e) => [e.classRoll, e]));

    const batchId = randomToken(8);
    const ops: Parameters<typeof RosterEntry.bulkWrite>[0] = [];
    const skipped: Array<{ rowNo: number; message: string }> = [];
    let created = 0;
    let updated = 0;

    for (const row of valid) {
      const existing = regMap.get(row.registrationNo);
      const rollOwner = rollMap.get(row.classRoll);

      if (existing && String(existing.cohortId) !== String(cohort._id)) {
        errors.push({ rowNo: row.rowNo, message: `${row.registrationNo} is already in another cohort` });
        continue;
      }
      if (rollOwner && rollOwner.registrationNo !== row.registrationNo) {
        errors.push({ rowNo: row.rowNo, message: `Class roll ${row.classRoll} already belongs to ${rollOwner.registrationNo}` });
        continue;
      }
      if (existing?.status === 'claimed') {
        skipped.push({ rowNo: row.rowNo, message: `${row.registrationNo} already has an account, left unchanged` });
        continue;
      }
      const fields = { name: row.name, nameKey: normalizeName(row.name), classRoll: row.classRoll, batchId };
      if (existing) {
        updated += 1;
        ops.push({ updateOne: { filter: { _id: existing._id, status: 'unclaimed' }, update: { $set: fields } } });
      } else {
        created += 1;
        ops.push({
          insertOne: {
            document: {
              ...fields,
              registrationNo: row.registrationNo,
              institutionId: cohort.institutionId,
              collegeId: cohort.collegeId,
              departmentId: cohort.departmentId,
              cohortId: cohort._id,
            },
          },
        });
      }
    }
    errors.sort((a, b) => a.rowNo - b.rowNo);

    if (!body.dryRun && ops.length) {
      await RosterEntry.bulkWrite(ops, { ordered: false });
      await audit({ actorId: req.auth!.userId, action: 'roster.import', entityType: 'Cohort', entityId: cohort._id, meta: { batchId, created, updated, skipped: skipped.length, errors: errors.length }, req });
    }
    sendSuccess(res, { dryRun: body.dryRun, total: rawRows.length, created, updated, skipped, errors, batchId });
  }),
);

const listQuery = z.object({
  cohortId: objectId,
  status: z.enum(['unclaimed', 'claimed']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

router.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const q = req.validated!.query as z.infer<typeof listQuery>;
    await assertCohortAccess(req.auth!, q.cohortId, 'roster:manage');
    const filter = { cohortId: q.cohortId, ...(q.status ? { status: q.status } : {}) };
    const [items, total] = await Promise.all([
      RosterEntry.find(filter).sort({ classRoll: 1 }).skip((q.page - 1) * q.limit).limit(q.limit).select('-nameKey').lean(),
      RosterEntry.countDocuments(filter),
    ]);
    sendSuccess(res, items, { page: q.page, limit: q.limit, total });
  }),
);

const rollBody = z.object({ classRoll: z.number().int().min(1).max(9999), reason: z.string().trim().min(3).max(300) }).strict();

router.post(
  '/:id/roll',
  validate({ params: z.object({ id: objectId }), body: rollBody }),
  asyncHandler(async (req, res) => {
    const entry = await RosterEntry.findById((req.validated!.params as { id: string }).id);
    if (!entry) throw AppError.notFound('Student not found in the class list');
    await assertCohortAccess(req.auth!, entry.cohortId, 'roster:manage');
    const { classRoll, reason } = req.validated!.body as z.infer<typeof rollBody>;

    const result = await changeRoll(entry, classRoll, reason, req.auth!.userId);
    await audit({ actorId: req.auth!.userId, action: 'roster.roll.change', entityType: 'RosterEntry', entityId: entry._id, meta: { registrationNo: entry.registrationNo, from: result.oldRoll, to: result.newRoll, reason }, req });
    sendSuccess(res, result);
  }),
);

export default router;
