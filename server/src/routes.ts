import { Router } from 'express';
import { env } from './config/env';
import { logger } from './config/logger';
import healthRoutes from './modules/health/health.routes';
import academicRoutes from './modules/academic/academic.routes';

const router = Router();
router.use('/health', healthRoutes);

// TEMPORARY (Step 1.2): academic CRUD has no authentication yet.
// It is mounted outside production only. Step 1.4 replaces this with role-based access.
if (env.NODE_ENV !== 'production') {
  router.use('/academic', academicRoutes);
  logger.warn('Academic admin routes are mounted WITHOUT authentication (development only)');
}

export default router;
