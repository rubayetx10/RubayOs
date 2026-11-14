import { describe, expect, it } from 'vitest';
import { findOverlap, findRangeForRoll, overlaps, validateRange } from '../src/modules/academic/rollRanges';

describe('validateRange', () => {
  it('accepts a normal range', () => expect(validateRange({ min: 1, max: 30 })).toBeNull());
  it('accepts a single-roll range', () => expect(validateRange({ min: 5, max: 5 })).toBeNull());
  it('rejects min greater than max', () => expect(validateRange({ min: 31, max: 30 })).toMatch(/cannot be greater/));
  it('rejects zero or negative', () => expect(validateRange({ min: 0, max: 10 })).toMatch(/at least 1/));
  it('rejects non-integers', () => expect(validateRange({ min: 1.5, max: 10 })).toMatch(/whole numbers/));
});

describe('overlaps / findOverlap', () => {
  const existing = [
    { id: 'p1', min: 1, max: 30 },
    { id: 'p2', min: 31, max: 60 },
  ];
  it('adjacent ranges do not overlap', () => expect(overlaps({ min: 1, max: 30 }, { min: 31, max: 60 })).toBe(false));
  it('sharing one roll is an overlap', () => expect(overlaps({ min: 1, max: 31 }, { min: 31, max: 60 })).toBe(true));
  it('a range inside another overlaps', () => expect(findOverlap(existing, { min: 10, max: 20 })?.id).toBe('p1'));
  it('a range spanning two overlaps the first', () => expect(findOverlap(existing, { min: 25, max: 40 })?.id).toBe('p1'));
  it('a free range returns undefined', () => expect(findOverlap(existing, { min: 61, max: 90 })).toBeUndefined());
  it('editing a part ignores itself', () => expect(findOverlap(existing, { min: 1, max: 35 }, 'p1')?.id).toBe('p2'));
  it('editing a part within its own range is allowed', () => expect(findOverlap(existing, { min: 5, max: 25 }, 'p1')).toBeUndefined());
});

describe('findRangeForRoll', () => {
  const ranges = [{ min: 1, max: 30, name: 'A1' }, { min: 31, max: 60, name: 'A2' }];
  it('finds boundaries', () => {
    expect(findRangeForRoll(ranges, 30)?.name).toBe('A1');
    expect(findRangeForRoll(ranges, 31)?.name).toBe('A2');
  });
  it('returns undefined outside every range', () => expect(findRangeForRoll(ranges, 61)).toBeUndefined());
});
