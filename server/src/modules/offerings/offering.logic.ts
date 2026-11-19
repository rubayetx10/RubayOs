/** Pure rule for who is enrolled in which course. No database access. */
export interface OfferingRef {
  id: string;
  type: 'theory' | 'lab' | 'elective';
  /** Empty means every section. */
  sectionIds: string[];
}
export interface StudentRef {
  profileId: string;
  userId: string;
  sectionId: string | null;
}
export interface NewEnrollment {
  profileId: string;
  userId: string;
  offeringId: string;
}

/**
 * What enrollments are missing? Electives are never added automatically (a student chooses them).
 * An offering limited to some sections only takes students who are already placed in one of them.
 * `existing` holds "profileId:offeringId" pairs that are already there.
 */
export function planCourseEnrollments(students: StudentRef[], offerings: OfferingRef[], existing: ReadonlySet<string>): NewEnrollment[] {
  const out: NewEnrollment[] = [];
  for (const o of offerings) {
    if (o.type === 'elective') continue;
    for (const s of students) {
      if (o.sectionIds.length > 0 && (!s.sectionId || !o.sectionIds.includes(s.sectionId))) continue;
      if (existing.has(`${s.profileId}:${o.id}`)) continue;
      out.push({ profileId: s.profileId, userId: s.userId, offeringId: o.id });
    }
  }
  return out;
}
