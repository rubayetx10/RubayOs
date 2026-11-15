/** Pure matching rules for roster-based registration. No database access. */

/** Lowercases, normalises unicode, ignores dots, commas, dashes and extra spaces. */
export function normalizeName(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[.,'’`"()\-_/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeRegNo(reg: string): string {
  return reg.normalize('NFKC').replace(/\s+/g, '').toUpperCase();
}

export type MismatchReason = 'not_in_roster' | 'name_mismatch' | 'roll_mismatch' | 'department_mismatch';
export type MatchDecision = { decision: 'auto' } | { decision: 'pending'; reasons: MismatchReason[] };

export interface RosterSnapshot {
  nameKey: string;
  classRoll: number;
  sameDepartment: boolean;
}

/**
 * Registration number is the lookup key. Auto-join needs the name AND the class roll to agree
 * with the teacher's sheet. Anything else goes to an admin. There is no fuzzy auto-approval.
 */
export function evaluateRosterMatch(entry: RosterSnapshot | null, input: { name: string; classRoll: number }): MatchDecision {
  if (!entry) return { decision: 'pending', reasons: ['not_in_roster'] };
  const reasons: MismatchReason[] = [];
  if (!entry.sameDepartment) reasons.push('department_mismatch');
  if (entry.nameKey !== normalizeName(input.name)) reasons.push('name_mismatch');
  if (entry.classRoll !== input.classRoll) reasons.push('roll_mismatch');
  return reasons.length === 0 ? { decision: 'auto' } : { decision: 'pending', reasons };
}
