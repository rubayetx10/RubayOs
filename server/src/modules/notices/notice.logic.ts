/** Pure rules for who sees a notice. No database. The route uses the filter; the read check uses isVisibleToStudent. */
export type Scope = 'college' | 'department' | 'cohort' | 'course';

export interface NoticeTarget {
  scope: Scope;
  collegeId?: string | null;
  departmentId?: string | null;
  cohortId?: string | null;
  semesterId?: string | null;
  sectionIds?: string[];
  offeringId?: string | null;
}
export interface NoticeLike {
  target: NoticeTarget;
  status: 'active' | 'withdrawn';
  publishAt: Date;
  expiresAt?: Date | null;
}
export interface StudentCtx {
  collegeId: string;
  departmentId: string;
  cohortId: string;
  semesterId: string | null;
  sectionId: string | null;
  /** Offerings the student is enrolled in this semester. */
  offeringIds: ReadonlySet<string>;
}

export function isVisibleToStudent(n: NoticeLike, s: StudentCtx, now = new Date()): boolean {
  if (n.status !== 'active' || n.publishAt > now || (n.expiresAt && n.expiresAt <= now)) return false;
  const t = n.target;
  switch (t.scope) {
    case 'college':
      return !!t.collegeId && t.collegeId === s.collegeId;
    case 'department':
      return !!t.departmentId && t.departmentId === s.departmentId;
    case 'cohort': {
      if (!t.cohortId || t.cohortId !== s.cohortId) return false;
      if (t.semesterId && t.semesterId !== s.semesterId) return false;
      const sections = t.sectionIds ?? [];
      return sections.length === 0 || (!!s.sectionId && sections.includes(s.sectionId));
    }
    case 'course':
      return !!t.offeringId && s.offeringIds.has(t.offeringId);
  }
}

/** The same rules as a Mongo filter, so a feed is one query instead of checking every notice in code. */
export function studentNoticeFilter(s: StudentCtx, now = new Date()): Record<string, unknown> {
  return {
    status: 'active',
    publishAt: { $lte: now },
    $and: [
      { $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] },
      {
        $or: [
          { 'target.scope': 'college', 'target.collegeId': s.collegeId },
          { 'target.scope': 'department', 'target.departmentId': s.departmentId },
          {
            'target.scope': 'cohort',
            'target.cohortId': s.cohortId,
            $and: [
              { $or: [{ 'target.semesterId': null }, { 'target.semesterId': s.semesterId }] },
              { $or: [{ 'target.sectionIds': { $size: 0 } }, ...(s.sectionId ? [{ 'target.sectionIds': s.sectionId }] : [])] },
            ],
          },
          { 'target.scope': 'course', 'target.offeringId': { $in: [...s.offeringIds] } },
        ],
      },
    ],
  };
}
