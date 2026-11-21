import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../common/asyncHandler';
import { AppError } from '../../common/errors';
import { sendSuccess } from '../../common/response';
import { authenticate } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { objectId } from '../academic/academic.schemas';
import { Notification } from './notification.models';

/** Everyone sees only their own notifications. There is no way to ask for someone else's. */
export const router = Router();
router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const mine = { userId: req.auth!.userId, withdrawnAt: null };
    const [items, unread] = await Promise.all([Notification.find(mine).sort({ createdAt: -1 }).limit(30).lean(), Notification.countDocuments({ ...mine, readAt: null })]);
    sendSuccess(res, {
      unread,
      items: items.map((n) => ({ id: String(n._id), type: n.type, title: n.title, body: n.body, priority: n.priority, read: !!n.readAt, createdAt: n.createdAt })),
    });
  }),
);

router.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    const r = await Notification.updateMany({ userId: req.auth!.userId, readAt: null }, { $set: { readAt: new Date() } });
    sendSuccess(res, { marked: r.modifiedCount });
  }),
);

router.post(
  '/:id/read',
  validate({ params: z.object({ id: objectId }) }),
  asyncHandler(async (req, res) => {
    const r = await Notification.updateOne({ _id: (req.validated!.params as { id: string }).id, userId: req.auth!.userId, readAt: null }, { $set: { readAt: new Date() } });
    if (r.matchedCount === 0 && !(await Notification.exists({ _id: (req.validated!.params as { id: string }).id, userId: req.auth!.userId }))) throw AppError.notFound();
    sendSuccess(res, { read: true });
  }),
);
