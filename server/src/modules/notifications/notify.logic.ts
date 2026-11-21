/** Pure helpers for notifications. No database. */
import type { NoticeTarget } from '../notices/notice.logic';

export type Audience = { kind: 'profiles'; filter: Record<string, unknown> } | { kind: 'offering'; offeringId: string };

/** Which students a notice is for, as a query on student profiles (or on one course's enrollments). */
export function audienceOf(t: NoticeTarget): Audience | null {
  switch (t.scope) {
    case 'college':
      return t.collegeId ? { kind: 'profiles', filter: { collegeId: t.collegeId, status: 'active' } } : null;
    case 'department':
      return t.departmentId ? { kind: 'profiles', filter: { departmentId: t.departmentId, status: 'active' } } : null;
    case 'cohort':
      if (!t.cohortId) return null;
      return {
        kind: 'profiles',
        filter: {
          cohortId: t.cohortId,
          status: 'active',
          ...(t.semesterId ? { currentSemesterId: t.semesterId } : {}),
          ...(t.sectionIds?.length ? { sectionId: { $in: t.sectionIds } } : {}),
        },
      };
    case 'course':
      return t.offeringId ? { kind: 'offering', offeringId: t.offeringId } : null;
  }
}

/** A short single-line preview for a notification. */
export function excerpt(text: string, max = 160): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
