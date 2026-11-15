import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { asyncHandler } from '../../common/asyncHandler';
import { sendSuccess } from '../../common/response';
import { env } from '../../config/env';
import { authenticate } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import * as S from './auth.schemas';
import * as svc from './auth.service';
import { REFRESH_COOKIE, clearRefreshCookie, setRefreshCookie } from './tokens';

const router = Router();

const limiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test',
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait a few minutes.' } },
});

router.post(
  '/register',
  limiter,
  validate({ body: S.registerSchema }),
  asyncHandler(async (req, res) => {
    const result = await svc.registerStudent(req.validated!.body as S.RegisterInput, svc.metaOf(req), req);
    if (result.status === 'pending_approval') {
      return sendSuccess(
        res,
        { status: 'pending_approval', message: 'Your details were saved. An admin will check them before you can log in.' },
        undefined,
        202,
      );
    }
    setRefreshCookie(res, result.session.refreshToken, result.session.refreshExpiresAt);
    return sendSuccess(res, { status: 'active', accessToken: result.session.accessToken, user: result.user }, undefined, 201);
  }),
);

router.post(
  '/login',
  limiter,
  validate({ body: S.loginSchema }),
  asyncHandler(async (req, res) => {
    const { identifier, password } = req.validated!.body as { identifier: string; password: string };
    const { session, user, roles } = await svc.login(identifier, password, svc.metaOf(req), req);
    setRefreshCookie(res, session.refreshToken, session.refreshExpiresAt);
    sendSuccess(res, { accessToken: session.accessToken, user, roles });
  }),
);

router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    try {
      const session = await svc.refresh(req.cookies?.[REFRESH_COOKIE], svc.metaOf(req), req);
      setRefreshCookie(res, session.refreshToken, session.refreshExpiresAt);
      sendSuccess(res, { accessToken: session.accessToken });
    } catch (err) {
      clearRefreshCookie(res);
      throw err;
    }
  }),
);

router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    await svc.logout(req.cookies?.[REFRESH_COOKIE]);
    clearRefreshCookie(res);
    sendSuccess(res, { loggedOut: true });
  }),
);

router.post(
  '/logout-all',
  authenticate,
  asyncHandler(async (req, res) => {
    await svc.revokeAllSessions(req.auth!.userId, 'logout_all');
    clearRefreshCookie(res);
    sendSuccess(res, { loggedOut: true });
  }),
);

router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    sendSuccess(res, await svc.currentUser(req.auth!.userId));
  }),
);

router.post(
  '/forgot-password',
  limiter,
  validate({ body: S.forgotSchema }),
  asyncHandler(async (req, res) => {
    await svc.forgotPassword((req.validated!.body as { identifier: string }).identifier, req);
    sendSuccess(res, { message: 'If an account exists, a reset link has been sent to its email.' });
  }),
);

router.post(
  '/reset-password',
  limiter,
  validate({ body: S.resetSchema }),
  asyncHandler(async (req, res) => {
    const { token, password } = req.validated!.body as { token: string; password: string };
    await svc.resetPassword(token, password, req);
    sendSuccess(res, { message: 'Password updated. Please log in.' });
  }),
);

router.post(
  '/change-password',
  authenticate,
  validate({ body: S.changePasswordSchema }),
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.validated!.body as { currentPassword: string; newPassword: string };
    await svc.changePassword(req.auth!.userId, currentPassword, newPassword, req);
    clearRefreshCookie(res);
    sendSuccess(res, { message: 'Password changed. Please log in again.' });
  }),
);

export default router;
