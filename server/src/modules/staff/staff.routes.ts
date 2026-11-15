import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../common/asyncHandler';
import { randomToken } from '../../common/crypto';
import { AppError } from '../../common/errors';
import { sendSuccess } from '../../common/response';
import { appUrl } from '../../config/env';
import { sendMailSafe } from '../../integrations/email';
import { authenticate, requireRole } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { objectId } from '../academic/academic.schemas';
import { audit } from '../audit/audit.model';
import { RoleAssignment, User } from '../auth/auth.models';
import { createResetToken } from '../auth/auth.service';
import { hashPassword } from '../auth/password';
import { assertCan, staffRoleResource } from '../auth/scope';

const router = Router();
router.use(authenticate, requireRole('super_admin', 'college_admin', 'department_admin'));

const createSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().toLowerCase().email().max(160),
    role: z.enum(['college_admin', 'department_admin', 'teacher']),
    collegeId: objectId.optional(),
    departmentId: objectId.optional(),
  })
  .strict();

router.post(
  '/',
  validate({ body: createSchema }),
  asyncHandler(async (req, res) => {
    const body = req.validated!.body as z.infer<typeof createSchema>;
    const auth = req.auth!;

    // Scope is derived from the database; the policy then decides if THIS admin may create THIS role THERE.
    const { resource, scope } = await staffRoleResource(body.role, body.collegeId, body.departmentId);
    assertCan(auth, `staff:create:${body.role}`, resource);

    if (await User.exists({ email: body.email })) throw AppError.conflict('An account with this email already exists');

    // The invited person sets their own password through an emailed link. Nobody else ever knows it.
    const user = await User.create({ name: body.name, email: body.email, passwordHash: await hashPassword(randomToken(32)), status: 'invited' });
    await RoleAssignment.create({ userId: user._id, role: body.role, scope, grantedBy: auth.userId });

    const token = await createResetToken(user._id, 'invite');
    await sendMailSafe({
      to: user.email,
      subject: 'You have been added to RubayOS',
      text: `Hello ${user.name},\n\nYou were added as ${body.role.replace('_', ' ')}. Set your password with this link (valid for 7 days):\n${appUrl}/reset-password?token=${token}`,
    });
    await audit({ actorId: auth.userId, action: 'staff.create', entityType: 'User', entityId: user._id, meta: { role: body.role }, req });

    sendSuccess(res, { id: String(user._id), email: user.email, role: body.role, status: 'invited' }, undefined, 201);
  }),
);

export default router;
