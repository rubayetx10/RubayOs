import { Schema, model, type Types } from 'mongoose';
import type { Request } from 'express';
import { logger } from '../../config/logger';

const auditSchema = new Schema(
  {
    actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    action: { type: String, required: true },
    entityType: { type: String, default: null },
    entityId: { type: Schema.Types.ObjectId, default: null },
    meta: { type: Schema.Types.Mixed, default: null },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null },
    at: { type: Date, default: Date.now },
  },
  { versionKey: false },
);
auditSchema.index({ entityType: 1, entityId: 1, at: -1 });
auditSchema.index({ actorId: 1, at: -1 });
auditSchema.index({ at: -1 });
export const AuditLog = model('AuditLog', auditSchema);

export interface AuditInput {
  actorId?: Types.ObjectId | string | null;
  action: string;
  entityType?: string;
  entityId?: Types.ObjectId | string | null;
  meta?: Record<string, unknown>;
  req?: Request;
}

/** Append-only. Audit failures are logged but never break the request. */
export async function audit(input: AuditInput): Promise<void> {
  try {
    await AuditLog.create({
      actorId: input.actorId ?? null,
      action: input.action,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      meta: input.meta ?? null,
      ip: input.req?.ip ?? null,
      userAgent: input.req?.headers['user-agent']?.slice(0, 200) ?? null,
    });
  } catch (err) {
    logger.error({ err, action: input.action }, 'Audit write failed');
  }
}
