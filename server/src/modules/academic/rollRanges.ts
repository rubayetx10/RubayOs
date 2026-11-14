/** Pure roll-range logic. No database access, so it is easy to test. */
export interface RollRange {
  min: number;
  max: number;
}
export interface LabeledRange extends RollRange {
  id?: string;
  label?: string;
}

export function validateRange(r: RollRange): string | null {
  if (!Number.isInteger(r.min) || !Number.isInteger(r.max)) return 'Roll numbers must be whole numbers';
  if (r.min < 1) return 'Minimum roll must be at least 1';
  if (r.min > r.max) return 'Minimum roll cannot be greater than maximum roll';
  return null;
}

export function overlaps(a: RollRange, b: RollRange): boolean {
  return a.min <= b.max && b.min <= a.max;
}

/** Returns the first existing range that overlaps the candidate (ignoring one id, for edits). */
export function findOverlap<T extends LabeledRange>(existing: T[], candidate: RollRange, ignoreId?: string): T | undefined {
  return existing.find((e) => e.id !== ignoreId && overlaps(e, candidate));
}

/** Finds the range that contains a roll number. Used for auto section/part assignment in Step 1.5. */
export function findRangeForRoll<T extends RollRange>(ranges: T[], roll: number): T | undefined {
  return ranges.find((r) => roll >= r.min && roll <= r.max);
}
