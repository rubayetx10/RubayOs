import { Router } from 'express';
import { asyncHandler } from '../../common/asyncHandler';
import { sendSuccess } from '../../common/response';
import { Department } from '../academic/academic.models';

const router = Router();

/** Public list used by the registration form. Names only, no ids of people or counts. */
router.get(
  '/departments',
  asyncHandler(async (_req, res) => {
    const depts = await Department.find({ status: 'active' }).populate<{ collegeId: { name: string } }>('collegeId', 'name').sort({ name: 1 }).lean();
    sendSuccess(
      res,
      depts.map((d) => ({ id: String(d._id), name: d.name, code: d.code, collegeName: d.collegeId?.name ?? '' })),
    );
  }),
);

export default router;
