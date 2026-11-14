import { describe, expect, it } from 'vitest';
import { objectId, partCreate, partUpdate, sessionCreate, cohortCreate } from '../src/modules/academic/academic.schemas';

const id = '507f1f77bcf86cd799439011';

describe('academic schemas', () => {
  it('objectId accepts 24 hex chars only', () => {
    expect(objectId.safeParse(id).success).toBe(true);
    expect(objectId.safeParse('abc').success).toBe(false);
    expect(objectId.safeParse('507f1f77bcf86cd79943901z').success).toBe(false);
  });
  it('part create rejects unknown fields (no client-supplied semesterId)', () => {
    expect(partCreate.safeParse({ sectionId: id, name: 'P1', rollMin: 1, rollMax: 30, semesterId: id }).success).toBe(false);
  });
  it('part create accepts a valid body', () => {
    expect(partCreate.safeParse({ sectionId: id, name: 'P1', rollMin: 1, rollMax: 30 }).success).toBe(true);
  });
  it('part update cannot move a part to another section', () => {
    expect(partUpdate.safeParse({ sectionId: id }).success).toBe(false);
  });
  it('session needs endYear >= startYear', () => {
    expect(sessionCreate.safeParse({ institutionId: id, label: '2023-24', startYear: 2024, endYear: 2023 }).success).toBe(false);
    expect(sessionCreate.safeParse({ institutionId: id, label: '2023-24', startYear: 2023, endYear: 2024 }).success).toBe(true);
  });
  it('cohort create takes only program and session', () => {
    expect(cohortCreate.safeParse({ programId: id, sessionId: id, departmentId: id }).success).toBe(false);
  });
});
