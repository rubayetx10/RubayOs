import { z } from 'zod';

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const name = z.string().trim().min(2).max(120);
const code = z.string().trim().min(1).max(30);
const status = z.enum(['active', 'inactive']);
const date = z.coerce.date().nullable().optional();

export const institutionCreate = z.object({
  name,
  shortName: code,
  type: z.enum(['university', 'board', 'other']).optional(),
}).strict();
export const institutionUpdate = z.object({ name: name.optional(), status: status.optional() }).strict();

export const collegeCreate = z.object({ institutionId: objectId, name, code }).strict();
export const collegeUpdate = z.object({ name: name.optional(), status: status.optional() }).strict();

export const departmentCreate = z.object({ collegeId: objectId, name, code }).strict();
export const departmentUpdate = z.object({ name: name.optional(), status: status.optional() }).strict();

export const programCreate = z.object({
  departmentId: objectId,
  name,
  degreeType: z.string().trim().min(2).max(40).optional(),
  durationYears: z.number().int().min(1).max(8).optional(),
  semesterCount: z.number().int().min(1).max(16).optional(),
}).strict();
export const programUpdate = z.object({
  name: name.optional(),
  degreeType: z.string().trim().min(2).max(40).optional(),
  status: status.optional(),
}).strict();

export const sessionCreate = z
  .object({
    institutionId: objectId,
    label: z.string().trim().min(4).max(20),
    startYear: z.number().int().min(1990).max(2100),
    endYear: z.number().int().min(1990).max(2100),
  })
  .strict()
  .refine((v) => v.endYear >= v.startYear, { message: 'endYear must not be before startYear', path: ['endYear'] });
export const sessionUpdate = z.object({ label: z.string().trim().min(4).max(20).optional(), status: status.optional() }).strict();

export const cohortCreate = z.object({ programId: objectId, sessionId: objectId }).strict();
export const cohortUpdate = z.object({ currentSemesterNo: z.number().int().min(1).max(16).optional(), status: status.optional() }).strict();

export const semesterUpdate = z
  .object({ startDate: date, endDate: date, status: z.enum(['upcoming', 'active', 'completed']).optional() })
  .strict();

export const sectionCreate = z.object({ semesterId: objectId, name: z.string().trim().min(1).max(40) }).strict();
export const sectionUpdate = z.object({ name: z.string().trim().min(1).max(40).optional(), status: status.optional() }).strict();

export const partCreate = z
  .object({
    sectionId: objectId,
    name: z.string().trim().min(1).max(40),
    rollMin: z.number().int(),
    rollMax: z.number().int(),
  })
  .strict();
export const partUpdate = z
  .object({
    name: z.string().trim().min(1).max(40).optional(),
    rollMin: z.number().int().optional(),
    rollMax: z.number().int().optional(),
    status: status.optional(),
  })
  .strict();
