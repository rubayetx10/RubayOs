import { describe, expect, it } from 'vitest';
import { evaluateRosterMatch, normalizeName, normalizeRegNo } from '../src/modules/students/nameMatch';

describe('normalizeName', () => {
  it('ignores case, dots, dashes and extra spaces', () => {
    expect(normalizeName('  Md.  RAHIM   Uddin ')).toBe('md rahim uddin');
    expect(normalizeName('Md Rahim-Uddin')).toBe('md rahim uddin');
  });
  it('keeps Bangla names intact', () => expect(normalizeName('রহিম উদ্দিন')).toBe('রহিম উদ্দিন'));
  it('does NOT treat different names as equal', () => expect(normalizeName('Rahim Uddin')).not.toBe(normalizeName('Karim Uddin')));
  it('does not reorder words', () => expect(normalizeName('Uddin Rahim')).not.toBe(normalizeName('Rahim Uddin')));
});

describe('normalizeRegNo', () => {
  it('removes spaces and uppercases', () => expect(normalizeRegNo(' 12 34-ab ')).toBe('1234-AB'));
});

describe('evaluateRosterMatch', () => {
  const entry = { nameKey: normalizeName('Rahim Uddin'), classRoll: 15, sameDepartment: true };
  it('auto-joins when name and roll both match', () => {
    expect(evaluateRosterMatch(entry, { name: 'rahim  UDDIN', classRoll: 15 })).toEqual({ decision: 'auto' });
  });
  it('goes to an admin when the registration number is not in the roster', () => {
    expect(evaluateRosterMatch(null, { name: 'Rahim Uddin', classRoll: 15 })).toEqual({ decision: 'pending', reasons: ['not_in_roster'] });
  });
  it('flags a wrong roll', () => {
    expect(evaluateRosterMatch(entry, { name: 'Rahim Uddin', classRoll: 16 })).toEqual({ decision: 'pending', reasons: ['roll_mismatch'] });
  });
  it('flags a different name', () => {
    expect(evaluateRosterMatch(entry, { name: 'Karim Uddin', classRoll: 15 })).toEqual({ decision: 'pending', reasons: ['name_mismatch'] });
  });
  it('flags both when both are wrong', () => {
    const r = evaluateRosterMatch(entry, { name: 'Someone Else', classRoll: 99 });
    expect(r).toEqual({ decision: 'pending', reasons: ['name_mismatch', 'roll_mismatch'] });
  });
  it('never auto-joins a different department even if name and roll match', () => {
    const r = evaluateRosterMatch({ ...entry, sameDepartment: false }, { name: 'Rahim Uddin', classRoll: 15 });
    expect(r).toEqual({ decision: 'pending', reasons: ['department_mismatch'] });
  });
});
