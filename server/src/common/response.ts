import type { Response } from 'express';
import type { ApiMeta } from '@rubayos/shared';

export function sendSuccess<T>(res: Response, data: T, meta?: ApiMeta, status = 200) {
  return res.status(status).json({ success: true, data, ...(meta ? { meta } : {}) });
}
