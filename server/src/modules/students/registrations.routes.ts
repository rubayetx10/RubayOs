import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { asyncHandler } from '../../common/asyncHandler';
import { AppError } from '../../common/errors';
import { sendSuccess } from '../../common/response';
import { authenticate, requireRole } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { objectId } from '../academic/academic.schemas';
import { audit } from '../audit/audit.model';
import { User } from '../auth/auth.models';
import { createStudentRecords } from '../auth/auth.service';
import { areaFilter, assertCohortAccess, assertDepartmentAccess } from '../auth/scope';
import { RegistrationRequest, RosterEntry, StudentProfile } from './student.models';
import { syncCourseEnrollmentsSafe } from '../offerings/offering.service';
import { normalizeName } from './nameMatch';

const router = Router();
router.use(authenticate, requireRole('super_admin', 'college_admin', 'department_admin'));

const listQuery = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).default('pending'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

router.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const q = req.validated!.query as z.infer<typeof listQuery>;
    const filter = { ...areaFilter(req.auth!), status: q.status };
    const [items, total] = await Promise.all([
      RegistrationRequest.find(filter)
        .sort({ createdAt: 1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .populate('userId', 'name email registrationNo status')
        .populate('rosterEntryId', 'name registrationNo classRoll')
        .lean(),
      RegistrationRequest.countDocuments(filter),
    ]);
    sendSuccess(res, items, { page: q.page, limit: q.limit, total });
  }),
);

const idParams = z.object({ id: objectId });

/**
 * Approve: the roster row (teacher's sheet) is the truth for roll and cohort.
 * If the student was not in the roster at all, the admin names the cohort and the submitted details are trusted.
 */
router.post(
  '/:id/approve',
  validate({ params: idParams, body: z.object({ cohortId: objectId.optional() }).strict() }),
  asyncHandler(async (req, res) => {
    const request = await RegistrationRequest.findById((req.validated!.params as { id: string }).id);
    if (!request) throw AppError.notFound();
    if (request.status !== 'pending') throw AppError.conflict(`This request is already ${request.status}`);
    await assertDepartmentAccess(req.auth!, request.departmentId, 'registration:review');

    const user = await User.findById(request.userId);
    if (!user) throw AppError.notFound('User not found');

    const body = req.validated!.body as { cohortId?: string };
    const db = await mongoose.startSession();
    try {
      await db.withTransaction(async () => {
        let roster = request.rosterEntryId ? await RosterEntry.findById(request.rosterEntryId).session(db) : null;

        if (roster) {
          if (roster.status !== 'unclaimed') throw AppError.conflict('This roster entry already has an account');
          roster.status = 'claimed';
          roster.claimedBy = user._id;
          await roster.save({ session: db });
        } else {
          const submitted = request.submitted!;
          if (!body.cohortId) throw AppError.badRequest('This student is not in the roster. Choose a cohort to add them to.');
          const cohort = await assertCohortAccess(req.auth!, body.cohortId, 'registration:review');
          if (String(cohort.departmentId) !== String(request.departmentId)) throw AppError.badRequest('Cohort belongs to another department');
          const [created] = await RosterEntry.create(
            [
              {
                institutionId: cohort.institutionId,
                collegeId: cohort.collegeId,
                departmentId: cohort.departmentId,
                cohortId: cohort._id,
                name: submitted.name,
                nameKey: normalizeName(submitted.name),
                registrationNo: submitted.registrationNo,
                classRoll: submitted.classRoll,
                status: 'claimed',
                claimedBy: user._id,
                source: 'admin_approved',
              },
            ],
            { session: db },
          );
          roster = created!;
        }

        await createStudentRecords(user._id, roster, db);
        user.status = 'active';
        await user.save({ session: db });
        request.status = 'approved';
        request.cohortId = roster.cohortId;
        request.reviewedBy = new mongoose.Types.ObjectId(req.auth!.userId);
        request.reviewedAt = new Date();
        await request.save({ session: db });
      });
    } finally {
      await db.endSession();
    }

    await syncCourseEnrollmentsSafe((await StudentProfile.findOne({ userId: user._id }).select('currentSemesterId').lean())?.currentSemesterId);
    await audit({ actorId: req.auth!.userId, action: 'registration.approve', entityType: 'RegistrationRequest', entityId: request._id, meta: { userId: String(user._id) }, req });
    sendSuccess(res, { status: 'approved' });
  }),
);

router.post(
  '/:id/reject',
  validate({ params: idParams, body: z.object({ reason: z.string().trim().min(3).max(300) }).strict() }),
  asyncHandler(async (req, res) => {
    const request = await RegistrationRequest.findById((req.validated!.params as { id: string }).id);
    if (!request) throw AppError.notFound();
    if (request.status !== 'pending') throw AppError.conflict(`This request is already ${request.status}`);
    await assertDepartmentAccess(req.auth!, request.departmentId, 'registration:review');

    request.status = 'rejected';
    request.rejectReason = (req.validated!.body as { reason: string }).reason;
    request.reviewedBy = new mongoose.Types.ObjectId(req.auth!.userId);
    request.reviewedAt = new Date();
    await request.save();
    await User.updateOne({ _id: request.userId }, { $set: { status: 'rejected' } });

    await audit({ actorId: req.auth!.userId, action: 'registration.reject', entityType: 'RegistrationRequest', entityId: request._id, meta: { reason: request.rejectReason }, req });
    sendSuccess(res, { status: 'rejected' });
  }),
);

export default router;
