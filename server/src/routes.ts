import { Router } from 'express';
import healthRoutes from './modules/health/health.routes';
import academicRoutes from './modules/academic/academic.routes';
import authRoutes from './modules/auth/auth.routes';
import publicRoutes from './modules/public/public.routes';
import rosterRoutes from './modules/roster/roster.routes';
import registrationRoutes from './modules/students/registrations.routes';
import staffRoutes from './modules/staff/staff.routes';
import usersRoutes from './modules/users/users.routes';
import enrollmentRoutes from './modules/enrollment/enrollment.routes';
import courseRoutes from './modules/courses/course.routes';
import offeringRoutes from './modules/offerings/offering.routes';
import { router as notificationRoutes } from './modules/notifications/notification.routes';
import { staffRouter as noticeStaff, studentRouter as noticeStudent } from './modules/notices/notice.routes';
import { teacherRouter } from './modules/teacher/teacher.routes';
import { adminRouter as syllabusAdmin, studentRouter as syllabusStudent } from './modules/syllabus/syllabus.routes';
import { adminRouter as examAdmin, studentRouter as examStudent } from './modules/exams/exam.routes';
import { adminRouter as routineAdmin, studentRouter as routineStudent } from './modules/routines/routine.routes';
import { authenticate, requireRole } from './middleware/authenticate';

const router = Router();

// Open: no login needed.
router.use('/health', healthRoutes);
router.use('/public', publicRoutes);
router.use('/auth', authRoutes);

// Admin only. Login and role are checked first; each route then checks the caller's own area.
router.use('/academic', authenticate, requireRole('super_admin', 'college_admin', 'department_admin'), academicRoutes);
router.use('/roster', rosterRoutes);
router.use('/registrations', registrationRoutes);
router.use('/staff', staffRoutes);
router.use('/users', usersRoutes);
router.use('/enrollment', enrollmentRoutes);
router.use('/courses', courseRoutes);
router.use('/offerings', offeringRoutes);
router.use('/teacher', teacherRouter);
router.use('/notifications', notificationRoutes);
router.use('/notices', noticeStaff);
router.use('/my-notices', noticeStudent);
router.use('/syllabus', syllabusAdmin);
router.use('/my-courses', syllabusStudent);
router.use('/exams', examAdmin);
router.use('/exam', examStudent);
router.use('/routines', routineAdmin);
router.use('/routine', routineStudent);

export default router;
