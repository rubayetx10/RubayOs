import { Schema, model } from 'mongoose';

/**
 * One row per person per event. The same event can never notify the same person twice:
 * (userId, dedupeKey) is unique. Rows disappear on their own after 180 days.
 */
const notificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['notice', 'routine', 'exam'], required: true },
    title: { type: String, required: true },
    body: { type: String, default: '' },
    priority: { type: String, enum: ['normal', 'important', 'urgent'], default: 'normal' },
    ref: { kind: { type: String, default: null }, id: { type: Schema.Types.ObjectId, default: null } },
    dedupeKey: { type: String, required: true },
    readAt: { type: Date, default: null },
    withdrawnAt: { type: Date, default: null },
  },
  { timestamps: true },
);
notificationSchema.index({ userId: 1, dedupeKey: 1 }, { unique: true });
notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ 'ref.kind': 1, 'ref.id': 1 });
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 86_400 });
export const Notification = model('Notification', notificationSchema);
