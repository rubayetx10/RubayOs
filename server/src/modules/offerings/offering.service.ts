import { logger } from '../../config/logger';
import { Course } from '../courses/course.models';
import { SemesterEnrollment } from '../enrollment/enrollment.models';
import { CourseEnrollment, CourseOffering } from './offering.models';
import { planCourseEnrollments } from './offering.logic';

/**
 * Makes sure every student of a semester is enrolled in that semester's compulsory courses.
 * Safe to run any number of times: it only adds what is missing.
 */
export async function syncCourseEnrollments(semesterId: string): Promise<number> {
  const offerings = await CourseOffering.find({ semesterId, status: 'active' }).lean();
  if (offerings.length === 0) return 0;
  const courses = await Course.find({ _id: { $in: offerings.map((o) => o.courseId) } }).select('type').lean();
  const typeOf = new Map(courses.map((c) => [String(c._id), c.type as 'theory' | 'lab' | 'elective']));

  const [students, existing] = await Promise.all([
    SemesterEnrollment.find({ semesterId, status: 'active' }).lean(),
    CourseEnrollment.find({ semesterId }).select('profileId offeringId').lean(),
  ]);
  const plan = planCourseEnrollments(
    students.map((s) => ({ profileId: String(s.profileId), userId: String(s.userId), sectionId: s.sectionId ? String(s.sectionId) : null })),
    offerings.map((o) => ({ id: String(o._id), type: typeOf.get(String(o.courseId)) ?? 'theory', sectionIds: (o.sectionIds ?? []).map(String) })),
    new Set(existing.map((e) => `${e.profileId}:${e.offeringId}`)),
  );
  if (plan.length === 0) return 0;

  const offering = new Map(offerings.map((o) => [String(o._id), o]));
  try {
    await CourseEnrollment.insertMany(
      plan.map((p) => ({ ...p, courseId: offering.get(p.offeringId)!.courseId, cohortId: offering.get(p.offeringId)!.cohortId, semesterId })),
      { ordered: false },
    );
  } catch (err) {
    if ((err as { code?: number }).code !== 11000 && !(err as { writeErrors?: unknown[] }).writeErrors) throw err; // duplicates are fine
  }
  return plan.length;
}

/** For places where enrollment must never make the main action fail (joining, approving, promoting). */
export async function syncCourseEnrollmentsSafe(semesterId: unknown): Promise<void> {
  if (!semesterId) return;
  try {
    await syncCourseEnrollments(String(semesterId));
  } catch (err) {
    logger.error({ err }, 'Course enrollment sync failed');
  }
}
