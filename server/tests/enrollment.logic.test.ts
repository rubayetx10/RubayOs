import { describe, expect, it } from 'vitest';
import { overlappingPairs, planAssignments, rangeGaps, type PartRange, type StudentRef } from '../src/modules/enrollment/enrollment.logic';

const p1: PartRange = { id: 'p1', sectionId: 'sA', min: 1, max: 30 };
const p2: PartRange = { id: 'p2', sectionId: 'sA', min: 31, max: 60 };
const p3: PartRange = { id: 'p3', sectionId: 'sB', min: 91, max: 120 };
const parts = [p1, p2, p3];
const stu = (profileId: string, roll: number, partId: string | null = null, manual = false): StudentRef => ({ profileId, roll, partId, sectionId: null, manual });

describe('planAssignments', () => {
  it('places an unassigned student in the part that covers the roll, with its section', () => {
    const plan = planAssignments([stu('a', 45)], parts, 'unassigned');
    expect(plan.toAssign).toEqual([{ profileId: 'a', roll: 45, partId: 'p2', sectionId: 'sA', fromPartId: null }]);
  });
  it('matches range boundaries exactly (30 and 31 are different parts)', () => {
    const plan = planAssignments([stu('a', 30), stu('b', 31), stu('c', 1), stu('d', 120)], parts, 'unassigned');
    expect(plan.toAssign.map((t) => [t.profileId, t.partId])).toEqual([['a', 'p1'], ['b', 'p2'], ['c', 'p1'], ['d', 'p3']]);
  });
  it('leaves students who are already in the right part alone', () => {
    const plan = planAssignments([stu('a', 10, 'p1')], parts, 'all');
    expect(plan.unchanged).toEqual(['a']);
    expect(plan.toAssign).toEqual([]);
  });
  it('reports a roll no part covers as uncovered instead of guessing', () => {
    const plan = planAssignments([stu('a', 75), stu('b', 200)], parts, 'unassigned');
    expect(plan.uncovered.map((u) => u.profileId)).toEqual(['a', 'b']);
    expect(plan.toAssign).toEqual([]);
  });
  it('mode "unassigned" reports a wrongly placed student but does not move them', () => {
    const plan = planAssignments([stu('a', 10, 'p2')], parts, 'unassigned');
    expect(plan.misplaced).toEqual([{ profileId: 'a', roll: 10, partId: 'p2', expectedPartId: 'p1' }]);
    expect(plan.toAssign).toEqual([]);
  });
  it('mode "all" moves a wrongly placed student and remembers where they came from', () => {
    const plan = planAssignments([stu('a', 10, 'p2')], parts, 'all');
    expect(plan.toAssign).toEqual([{ profileId: 'a', roll: 10, partId: 'p1', sectionId: 'sA', fromPartId: 'p2' }]);
  });
  it('NEVER moves a hand-placed student, in either mode', () => {
    for (const mode of ['unassigned', 'all'] as const) {
      const plan = planAssignments([stu('a', 10, 'p3', true)], parts, mode);
      expect(plan.manual).toEqual(['a']);
      expect(plan.toAssign).toEqual([]);
      expect(plan.misplaced).toEqual([]);
    }
  });
  it('a student in a part that was closed (not in the active list) is misplaced', () => {
    const plan = planAssignments([stu('a', 10, 'closed-part')], parts, 'unassigned');
    expect(plan.misplaced[0]).toMatchObject({ profileId: 'a', expectedPartId: 'p1' });
  });
  it('a placed student whose roll is now covered by nothing is misplaced with no expected part', () => {
    const plan = planAssignments([stu('a', 75, 'p2')], parts, 'all');
    expect(plan.misplaced).toEqual([{ profileId: 'a', roll: 75, partId: 'p2', expectedPartId: null }]);
    expect(plan.toAssign).toEqual([]);
  });
  it('handles no students and no parts', () => {
    expect(planAssignments([], parts, 'all')).toEqual({ toAssign: [], unchanged: [], manual: [], misplaced: [], uncovered: [] });
    expect(planAssignments([stu('a', 5)], [], 'all').uncovered).toHaveLength(1);
  });
  it('every student lands in exactly one bucket', () => {
    const students = [stu('a', 5), stu('b', 45, 'p2'), stu('c', 75), stu('d', 10, 'p2'), stu('e', 10, 'p3', true)];
    const plan = planAssignments(students, parts, 'unassigned');
    const total = plan.toAssign.length + plan.unchanged.length + plan.manual.length + plan.misplaced.length + plan.uncovered.length;
    expect(total).toBe(students.length);
  });
});

describe('rangeGaps', () => {
  it('finds the hole between two ranges', () => expect(rangeGaps([{ min: 1, max: 30 }, { min: 61, max: 90 }])).toEqual([{ from: 31, to: 60 }]));
  it('finds a hole at the start', () => expect(rangeGaps([{ min: 5, max: 30 }])).toEqual([{ from: 1, to: 4 }]));
  it('contiguous ranges have no gaps', () => expect(rangeGaps([{ min: 1, max: 30 }, { min: 31, max: 60 }])).toEqual([]));
  it('does not care about the order given', () => expect(rangeGaps([{ min: 61, max: 90 }, { min: 1, max: 30 }])).toEqual([{ from: 31, to: 60 }]));
  it('reports several gaps', () => {
    expect(rangeGaps([{ min: 1, max: 10 }, { min: 20, max: 30 }, { min: 50, max: 60 }])).toEqual([{ from: 11, to: 19 }, { from: 31, to: 49 }]);
  });
  it('overlapping ranges do not create a false gap', () => expect(rangeGaps([{ min: 1, max: 40 }, { min: 30, max: 60 }])).toEqual([]));
  it('no ranges, no gaps', () => expect(rangeGaps([])).toEqual([]));
});

describe('overlappingPairs', () => {
  it('finds none in clean data', () => expect(overlappingPairs(parts)).toEqual([]));
  it('finds a pair in bad legacy data', () => {
    expect(overlappingPairs([p1, { id: 'x', sectionId: 'sA', min: 25, max: 40 }])).toEqual([{ a: 'p1', b: 'x' }]);
  });
});
