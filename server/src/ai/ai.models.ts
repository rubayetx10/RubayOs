import { Schema, model } from 'mongoose';

/** One row per AI call: who, what, how long, did it work. Used for limits and costs later. */
const usageSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    task: { type: String, required: true },
    provider: { type: String, required: true },
    model: { type: String, required: true },
    status: { type: String, enum: ['ok', 'error'], required: true },
    inputBytes: { type: Number, default: 0 },
    latencyMs: { type: Number, default: 0 },
    at: { type: Date, default: Date.now },
  },
  { versionKey: false },
);
usageSchema.index({ userId: 1, at: -1 });
usageSchema.index({ at: -1 });
export const AiUsageLog = model('AiUsageLog', usageSchema);
