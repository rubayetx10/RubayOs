import { Router } from 'express';
import mongoose from 'mongoose';
import { AppError } from '../../common/errors';
import { buildCrudRouter, mustFind } from './crud';
import * as S from './academic.schemas';
import { AcademicSession, College, Cohort, Department, Institution, Part, Program, Section, Semester } from './academic.models';
import { findOverlap, validateRange } from './rollRanges';
import { planSemesters } from './semesterPlan';

const router = Router();

router.use('/institutions', buildCrudRouter({
  model: Institution,
  kind: 'institution',
  createSchema: S.institutionCreate,
  updateSchema: S.institutionUpdate,
  filterKeys: [],
}));

router.use('/colleges', buildCrudRouter({
  model: College,
  kind: 'college',
  createSchema: S.collegeCreate,
  updateSchema: S.collegeUpdate,
  filterKeys: ['institutionId'],
  prepareCreate: async (d) => {
    await mustFind(Institution, d.institutionId, 'Institution');
    return d;
  },
}));

router.use('/departments', buildCrudRouter({
  model: Department,
  kind: 'department',
  createSchema: S.departmentCreate,
  updateSchema: S.departmentUpdate,
  filterKeys: ['collegeId', 'institutionId'],
  prepareCreate: async (d) => {
    const college = await mustFind(College, d.collegeId, 'College');
    return { ...d, institutionId: college.institutionId };
  },
}));

router.use('/programs', buildCrudRouter({
  model: Program,
  kind: 'program',
  createSchema: S.programCreate,
  updateSchema: S.programUpdate,
  filterKeys: ['departmentId', 'collegeId'],
  prepareCreate: async (d) => {
    const dept = await mustFind(Department, d.departmentId, 'Department');
    return { ...d, collegeId: dept.collegeId, institutionId: dept.institutionId };
  },
}));

router.use('/sessions', buildCrudRouter({
  model: AcademicSession,
  kind: 'session',
  createSchema: S.sessionCreate,
  updateSchema: S.sessionUpdate,
  filterKeys: ['institutionId'],
  prepareCreate: async (d) => {
    await mustFind(Institution, d.institutionId, 'Institution');
    return d;
  },
}));

router.use('/cohorts', buildCrudRouter({
  model: Cohort,
  kind: 'cohort',
  createSchema: S.cohortCreate,
  updateSchema: S.cohortUpdate,
  filterKeys: ['programId', 'sessionId', 'departmentId', 'collegeId'],
  prepareCreate: async (d) => {
    const program = await mustFind(Program, d.programId, 'Program');
    const session = await mustFind(AcademicSession, d.sessionId, 'Session');
    if (String(session.institutionId) !== String(program.institutionId)) {
      throw AppError.badRequest('Session and program belong to different institutions');
    }
    return {
      ...d,
      institutionId: program.institutionId,
      collegeId: program.collegeId,
      departmentId: program.departmentId,
    };
  },
  // Cohort and its semesters are created together or not at all.
  create: async (d) => {
    const program = await mustFind(Program, d.programId, 'Program');
    const db = await mongoose.startSession();
    try {
      let cohort: unknown;
      await db.withTransaction(async () => {
        const [created] = await Cohort.create([d], { session: db });
        await Semester.create(
          planSemesters(program.semesterCount as number).map((s) => ({ cohortId: created!._id, ...s })),
          { session: db, ordered: true },
        );
        cohort = created;
      });
      return cohort;
    } finally {
      await db.endSession();
    }
  },
  prepareUpdate: async (existing, d) => {
    if (d.currentSemesterNo !== undefined) {
      const program = await mustFind(Program, String(existing.programId), 'Program');
      if (d.currentSemesterNo > (program.semesterCount as number)) {
        throw AppError.badRequest(`This program has only ${program.semesterCount} semesters`);
      }
    }
    return d;
  },
}));

// Semesters are generated with the cohort, so there is no POST.
router.use('/semesters', buildCrudRouter({
  model: Semester,
  kind: 'semester',
  updateSchema: S.semesterUpdate,
  filterKeys: ['cohortId'],
}));

router.use('/sections', buildCrudRouter({
  model: Section,
  kind: 'section',
  createSchema: S.sectionCreate,
  updateSchema: S.sectionUpdate,
  filterKeys: ['cohortId', 'semesterId'],
  prepareCreate: async (d) => {
    const semester = await mustFind(Semester, d.semesterId, 'Semester');
    return { ...d, cohortId: semester.cohortId };
  },
}));

async function assertNoRollOverlap(semesterId: unknown, range: { min: number; max: number }, ignoreId?: string) {
  const bad = validateRange(range);
  if (bad) throw AppError.badRequest(bad);
  const active = await Part.find({ semesterId, status: 'active' });
  const existing = active.map((p) => ({ id: String(p._id), min: p.rollMin, max: p.rollMax, label: `${p.name} (${p.rollMin}-${p.rollMax})` }));
  const clash = findOverlap(existing, range, ignoreId);
  if (clash) {
    throw AppError.conflict(`Roll range ${range.min}-${range.max} overlaps an existing part: ${clash.label}`, { partId: clash.id });
  }
}

router.use('/parts', buildCrudRouter({
  model: Part,
  kind: 'part',
  createSchema: S.partCreate,
  updateSchema: S.partUpdate,
  filterKeys: ['cohortId', 'semesterId', 'sectionId'],
  prepareCreate: async (d) => {
    const section = await mustFind(Section, d.sectionId, 'Section');
    if (section.status !== 'active') throw AppError.badRequest('Section is inactive');
    await assertNoRollOverlap(section.semesterId, { min: d.rollMin, max: d.rollMax });
    return { ...d, semesterId: section.semesterId, cohortId: section.cohortId };
  },
  prepareUpdate: async (existing, d) => {
    const next = {
      min: d.rollMin ?? existing.rollMin,
      max: d.rollMax ?? existing.rollMax,
      status: d.status ?? existing.status,
    };
    if (next.status === 'active') await assertNoRollOverlap(existing.semesterId, next, String(existing._id));
    return d;
  },
}));

export default router;
