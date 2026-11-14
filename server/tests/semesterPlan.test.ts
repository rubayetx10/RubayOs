import { describe, expect, it } from 'vitest';
import { planSemesters } from '../src/modules/academic/semesterPlan';

describe('planSemesters', () => {
  it('groups 8 semesters into 4 years, two each', () => {
    const plan = planSemesters(8);
    expect(plan).toHaveLength(8);
    expect(plan.map((s) => s.yearNo)).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
    expect(plan[0]).toEqual({ number: 1, yearNo: 1 });
    expect(plan[7]).toEqual({ number: 8, yearNo: 4 });
  });
  it('handles an odd count', () => expect(planSemesters(3).map((s) => s.yearNo)).toEqual([1, 1, 2]));
  it('rejects zero or invalid counts', () => {
    expect(() => planSemesters(0)).toThrow();
    expect(() => planSemesters(2.5)).toThrow();
  });
});
