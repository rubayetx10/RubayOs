import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../common/asyncHandler';
import { AppError } from '../../common/errors';
import { sendSuccess } from '../../common/response';
import { authenticate, requireRole } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { AcademicSession, Cohort, Program, Section, Semester } from '../academic/academic.models';
import { objectId } from '../academic/academic.schemas';
import { User } from '../auth/auth.models';
import { Course } from '../courses/course.models';
import { SemesterEnrollment } from '../enrollment/enrollment.models';
import { ExamEvent } from '../exams/exam.models';
import { CourseEnrollment, CourseOffering } from '../offerings/offering.models';
import { RoutineVersion } from '../routines/routine.models';
import { teacherSlots } from './teacher.logic';

/** Everything here is limited to the signed-in teacher's own offerings. Another teacher's course answers 404. */
export const teacherRouter = Router();
teacherRouter.use(authenticate, requireRole('teacher'));

teacherRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    const uid = req.auth!.userId;
    const mine = await CourseOffering.find({ teacherIds: uid, status: 'active' }).lean();
    const semesters = await Semester.find({ _id: { $in: mine.map((o) => o.semesterId) }, status: { $ne: 'completed' } }).lean();
    const open = new Set(semesters.map((s) => String(s._id)));
    const offerings = mine.filter((o) => open.has(String(o.semesterId)));
    const ids = offerings.map((o) => o._id);

    const [courses, cohorts, counts, versions, exams] = await Promise.all([
      Course.find({ _id: { $in: offerings.map((o) => o.courseId) } }).lean(),
      Cohort.find({ _id: { $in: offerings.map((o) => o.cohortId) } }).lean(),
      CourseEnrollment.aggregate<{ _id: unknown; n: number }>([{ $match: { offeringId: { $in: ids }, status: 'active' } }, { $group: { _id: '$offeringId', n: { $sum: 1 } } }]),
      RoutineVersion.find({ status: 'published', semesterId: { $in: semesters.map((s) => s._id) }, 'entries.teacherId': uid }).lean(),
      ExamEvent.find({ offeringId: { $in: ids }, status: { $in: ['published', 'cancelled'] }, publishedAt: { $ne: null } }).sort({ date: 1, startTime: 1 }).lean(),
    ]);
    const [sessions, programs, sections] = await Promise.all([
      AcademicSession.find({ _id: { $in: cohorts.map((c) => c.sessionId) } }).lean(),
      Program.find({ _id: { $in: cohorts.map((c) => c.programId) } }).lean(),
      Section.find({ _id: { $in: versions.map((v) => v.sectionId) } }).lean(),
    ]);

    const course = (id: unknown) => courses.find((c) => String(c._id) === String(id));
    const batch = (cohortId: unknown) => {
      const c = cohorts.find((x) => String(x._id) === String(cohortId));
      return c ? `${sessions.find((s) => String(s._id) === String(c.sessionId))?.label ?? '?'} · ${programs.find((p) => String(p._id) === String(c.programId))?.name ?? '?'}` : '?';
    };
    const offering = (id: unknown) => offerings.find((o) => String(o._id) === String(id));
    const brief = (c: ReturnType<typeof course>) => ({ code: c?.code ?? '', name: c?.name ?? '' });

    sendSuccess(res, {
      courses: offerings
        .map((o) => ({ offeringId: String(o._id), course: { ...brief(course(o.courseId)), credit: course(o.courseId)?.credit ?? 0 }, batch: batch(o.cohortId), cohortId: String(o.cohortId), semesterId: String(o.semesterId), semesterNumber: semesters.find((s) => String(s._id) === String(o.semesterId))?.number ?? 0, students: counts.find((c) => String(c._id) === String(o._id))?.n ?? 0 }))
        .sort((a, b) => a.course.code.localeCompare(b.course.code)),
      routine: teacherSlots(versions.map((v) => ({ sectionId: String(v.sectionId), entries: v.entries.map((e) => ({ day: e.day, startTime: e.startTime, endTime: e.endTime, offeringId: String(e.offeringId), teacherId: e.teacherId ? String(e.teacherId) : null, room: e.room ?? '' })) })), uid).map((s) => ({
        day: s.day, startTime: s.startTime, endTime: s.endTime, room: s.room,
        course: brief(course(offering(s.offeringId)?.courseId)),
        section: sections.find((x) => String(x._id) === s.sectionId)?.name ?? '',
        batch: batch(offering(s.offeringId)?.cohortId),
      })),
      exams: exams.map((e) => ({ id: String(e._id), title: e.title, date: e.date, startTime: e.startTime, endTime: e.endTime, room: e.room, cancelled: e.status === 'cancelled', course: brief(course(offering(e.offeringId)?.courseId)), batch: batch(e.cohortId) })),
    });
  }),
);

/** Name, roll and section only. No registration number, email or anything private. */
teacherRouter.get(
  '/offerings/:id/students',
  validate({ params: z.object({ id: objectId }) }),
  asyncHandler(async (req, res) => {
    const offering = await CourseOffering.findOne({ _id: (req.validated!.params as { id: string }).id, teacherIds: req.auth!.userId });
    if (!offering) throw AppError.notFound('Course not found');
    const enrolled = await CourseEnrollment.find({ offeringId: offering._id, status: 'active' }).select('userId').lean();
    const userIds = enrolled.map((e) => e.userId);
    const [places, users] = await Promise.all([
      SemesterEnrollment.find({ semesterId: offering.semesterId, userId: { $in: userIds }, status: 'active' }).lean(),
      User.find({ _id: { $in: userIds } }).select('name').lean(),
    ]);
    const sections = await Section.find({ _id: { $in: places.map((p) => p.sectionId).filter(Boolean) } }).lean();
    sendSuccess(
      res,
      places
        .map((p) => ({ name: users.find((u) => String(u._id) === String(p.userId))?.name ?? '', classRoll: p.classRoll, section: sections.find((s) => String(s._id) === String(p.sectionId))?.name ?? '' }))
        .sort((a, b) => a.classRoll - b.classRoll),
    );
  }),
);
