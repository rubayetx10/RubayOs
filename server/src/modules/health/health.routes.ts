import { Router } from 'express';
import type { HealthData } from '@rubayos/shared';
import { APP_NAME } from '@rubayos/shared';
import { env } from '../../config/env';
import { dbState } from '../../config/db';
import { sendSuccess } from '../../common/response';

const router = Router();
const startedAt = Date.now();

function snapshot(): HealthData {
  return {
    status: 'ok',
    name: APP_NAME,
    version: process.env.npm_package_version ?? '0.1.0',
    environment: env.NODE_ENV,
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    time: new Date().toISOString(),
    database: { state: dbState() },
  };
}

/** Liveness: the process is up. */
router.get('/', (_req, res) => sendSuccess(res, snapshot()));

/** Readiness: the process can serve traffic (database connected). */
router.get('/ready', (_req, res) => {
  const data = snapshot();
  if (data.database.state !== 'connected') {
    return res.status(503).json({
      success: false,
      error: { code: 'NOT_READY', message: 'Database is not connected', details: data },
    });
  }
  return sendSuccess(res, data);
});

export default router;
