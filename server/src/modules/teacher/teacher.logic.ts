/** Pure helper for the teacher's own timetable. No database. */
export interface VersionLike {
  sectionId: string;
  entries: Array<{ day: number; startTime: string; endTime: string; offeringId: string; teacherId?: string | null; room?: string }>;
}
export interface TeacherSlot {
  day: number;
  startTime: string;
  endTime: string;
  offeringId: string;
  room: string;
  sectionId: string;
}

/** Every class this teacher takes, across all published section routines, in day and time order. */
export function teacherSlots(versions: VersionLike[], teacherId: string): TeacherSlot[] {
  return versions
    .flatMap((v) => v.entries.filter((e) => e.teacherId && String(e.teacherId) === teacherId).map((e) => ({ day: e.day, startTime: e.startTime, endTime: e.endTime, offeringId: String(e.offeringId), room: e.room ?? '', sectionId: v.sectionId })))
    .sort((a, b) => a.day - b.day || a.startTime.localeCompare(b.startTime));
}
