import { Types } from 'mongoose';
import { logger } from '../../config/logger';
import { Course } from '../courses/course.models';
import { CourseEnrollment, CourseOffering } from '../offerings/offering.models';
import type { NoticeTarget } from '../notices/notice.logic';
import { StudentProfile } from '../students/student.models';
import { Notification } from './notification.models';
import { audienceOf, chunk, excerpt, type Audience } from './notify.logic';

export interface Template {
  type: 'notice' | 'routine' | 'exam';
  title: string;
  body?: string;
  priority?: 'normal' | 'important' | 'urgent';
  refKind: string;
  refId: unknown;
  dedupeKey: string;
}

export async function usersOf(a: Audience): Promise<string[]> {
  const ids = a.kind === 'profiles' ? await StudentProfile.find(a.filter).distinct('userId') : await CourseEnrollment.find({ offeringId: a.offeringId, status: 'active' }).distinct('userId');
  return ids.map(String);
}

/** Adds the notification for every user. Anyone who already has it (same dedupeKey) is skipped. Never throws. */
export async function notifyUsers(userIds: string[], t: Template): Promise<number> {
  try {
    let made = 0;
    for (const part of chunk([...new Set(userIds)], 500)) {
      try {
        const res = await Notification.insertMany(
          part.map((userId) => ({ userId, type: t.type, title: t.title, body: excerpt(t.body ?? ''), priority: t.priority ?? 'normal', ref: { kind: t.refKind, id: new Types.ObjectId(String(t.refId)) }, dedupeKey: t.dedupeKey })),
          { ordered: false },
        );
        made += res.length;
      } catch (err) {
        // Duplicates are expected when an event is repeated; anything else is logged.
        if (!(err as { writeErrors?: unknown[] }).writeErrors && (err as { code?: number }).code !== 11000) throw err;
        made += (err as { insertedDocs?: unknown[] }).insertedDocs?.length ?? 0;
      }
    }
    return made;
  } catch (err) {
    logger.error({ err: String((err as Error)?.message ?? err) }, 'Could not create notifications');
    return 0;
  }
}

export async function notifyNotice(notice: { _id: unknown; title: string; body: string; priority: string }, target: NoticeTarget): Promise<void> {
  const audience = audienceOf(target);
  if (!audience) return;
  await notifyUsers(await usersOf(audience), { type: 'notice', title: notice.title, body: notice.body, priority: notice.priority as Template['priority'], refKind: 'notice', refId: notice._id, dedupeKey: `notice:${String(notice._id)}` });
}

/** A withdrawn notice also leaves every bell. */
export async function withdrawNoticeNotifications(noticeId: unknown): Promise<void> {
  try {
    await Notification.updateMany({ 'ref.kind': 'notice', 'ref.id': noticeId }, { $set: { withdrawnAt: new Date() } });
  } catch (err) {
    logger.error({ err: String((err as Error)?.message ?? err) }, 'Could not withdraw notifications');
  }
}

export async function notifySection(sectionId: unknown, semesterId: unknown, t: Template): Promise<void> {
  const ids = await StudentProfile.find({ sectionId, currentSemesterId: semesterId, status: 'active' }).distinct('userId');
  await notifyUsers(ids.map(String), t);
}

/** "CSE 101" for an exam notification. */
export async function courseCodeOfOffering(offeringId: unknown): Promise<string> {
  const o = await CourseOffering.findById(offeringId).select('courseId').lean();
  return (o ? (await Course.findById(o.courseId).select('code').lean())?.code : '') ?? '';
}

export async function notifyOfferingStudents(offeringId: unknown, t: Template): Promise<void> {
  await notifyUsers(await usersOf({ kind: 'offering', offeringId: String(offeringId) }), t);
}
