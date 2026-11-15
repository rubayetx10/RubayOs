/** Pure rules for assigning students to parts. No database access, so every case can be tested. */
import { findRangeForRoll, overlaps } from '../academic/rollRanges';

export interface PartRange {
  id: string;
  sectionId: string;
  min: number;
  max: number;
  label?: string;
}
export interface StudentRef {
  profileId: string;
  roll: number;
  sectionId?: string | null;
  partId?: string | null;
  /** Placed by an admin by hand. Automatic runs never move these. */
  manual?: boolean;
}
export type Mode = 'unassigned' | 'all';

export interface Plan {
  toAssign: Array<{ profileId: string; roll: number; partId: string; sectionId: string; fromPartId: string | null }>;
  unchanged: string[];
  manual: string[];
  /** Assigned somewhere that no longer matches their roll (range edited, part closed). Needs a human decision. */
  misplaced: Array<{ profileId: string; roll: number; partId: string; expectedPartId: string | null }>;
  /** No active part covers this roll. */
  uncovered: Array<{ profileId: string; roll: number }>;
}

/**
 * Decides, for every student, what an automatic run would do.
 * mode "unassigned": only fills in students who have no part yet; wrongly placed students are reported, not moved.
 * mode "all": also moves wrongly placed students. Hand-placed students are never moved in either mode.
 */
export function planAssignments(students: StudentRef[], parts: PartRange[], mode: Mode): Plan {
  const plan: Plan = { toAssign: [], unchanged: [], manual: [], misplaced: [], uncovered: [] };

  for (const s of students) {
    if (s.manual && s.partId) {
      plan.manual.push(s.profileId);
      continue;
    }
    const expected = findRangeForRoll(parts, s.roll);

    if (!expected) {
      if (s.partId) plan.misplaced.push({ profileId: s.profileId, roll: s.roll, partId: s.partId, expectedPartId: null });
      else plan.uncovered.push({ profileId: s.profileId, roll: s.roll });
      continue;
    }
    if (s.partId === expected.id) {
      plan.unchanged.push(s.profileId);
      continue;
    }
    if (!s.partId || mode === 'all') {
      plan.toAssign.push({ profileId: s.profileId, roll: s.roll, partId: expected.id, sectionId: expected.sectionId, fromPartId: s.partId ?? null });
    } else {
      plan.misplaced.push({ profileId: s.profileId, roll: s.roll, partId: s.partId, expectedPartId: expected.id });
    }
  }
  return plan;
}

/** Roll numbers that no part covers, between 1 and the highest configured roll. Likely a typo or a missing part. */
export function rangeGaps(parts: Array<{ min: number; max: number }>): Array<{ from: number; to: number }> {
  const sorted = [...parts].sort((a, b) => a.min - b.min);
  const gaps: Array<{ from: number; to: number }> = [];
  let cursor = 1;
  for (const p of sorted) {
    if (p.min > cursor) gaps.push({ from: cursor, to: p.min - 1 });
    cursor = Math.max(cursor, p.max + 1);
  }
  return gaps;
}

/** Should never happen (creation blocks it), but existing data may predate the rule. */
export function overlappingPairs(parts: PartRange[]): Array<{ a: string; b: string }> {
  const pairs: Array<{ a: string; b: string }> = [];
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      const a = parts[i]!;
      const b = parts[j]!;
      if (overlaps(a, b)) pairs.push({ a: a.id, b: b.id });
    }
  }
  return pairs;
}
