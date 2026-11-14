import { Schema, model } from 'mongoose';

const ref = (to: string) => ({ type: Schema.Types.ObjectId, ref: to, required: true });
const status = { type: String, enum: ['active', 'inactive'], default: 'active' };
const options = { timestamps: true } as const;

export const Institution = model(
  'Institution',
  new Schema(
    {
      name: { type: String, required: true, trim: true },
      shortName: { type: String, required: true, trim: true, unique: true },
      type: { type: String, enum: ['university', 'board', 'other'], default: 'university' },
      status,
    },
    options,
  ),
);

const collegeSchema = new Schema(
  {
    institutionId: ref('Institution'),
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true },
    status,
  },
  options,
);
collegeSchema.index({ institutionId: 1, code: 1 }, { unique: true });
export const College = model('College', collegeSchema);

const departmentSchema = new Schema(
  {
    institutionId: ref('Institution'),
    collegeId: ref('College'),
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true },
    status,
  },
  options,
);
departmentSchema.index({ collegeId: 1, code: 1 }, { unique: true });
export const Department = model('Department', departmentSchema);

const programSchema = new Schema(
  {
    institutionId: ref('Institution'),
    collegeId: ref('College'),
    departmentId: ref('Department'),
    name: { type: String, required: true, trim: true },
    degreeType: { type: String, default: 'bachelor_honours' },
    durationYears: { type: Number, default: 4 },
    semesterCount: { type: Number, default: 8 },
    status,
  },
  options,
);
programSchema.index({ departmentId: 1, name: 1 }, { unique: true });
export const Program = model('Program', programSchema);

const sessionSchema = new Schema(
  {
    institutionId: ref('Institution'),
    label: { type: String, required: true, trim: true },
    startYear: { type: Number, required: true },
    endYear: { type: Number, required: true },
    status,
  },
  options,
);
sessionSchema.index({ institutionId: 1, label: 1 }, { unique: true });
export const AcademicSession = model('AcademicSession', sessionSchema);

/** A cohort is one admission batch of one program: program + session. */
const cohortSchema = new Schema(
  {
    institutionId: ref('Institution'),
    collegeId: ref('College'),
    departmentId: ref('Department'),
    programId: ref('Program'),
    sessionId: ref('AcademicSession'),
    currentSemesterNo: { type: Number, default: 1 },
    status,
  },
  options,
);
cohortSchema.index({ programId: 1, sessionId: 1 }, { unique: true });
export const Cohort = model('Cohort', cohortSchema);

const semesterSchema = new Schema(
  {
    cohortId: ref('Cohort'),
    number: { type: Number, required: true },
    yearNo: { type: Number, required: true },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    status: { type: String, enum: ['upcoming', 'active', 'completed'], default: 'upcoming' },
  },
  options,
);
semesterSchema.index({ cohortId: 1, number: 1 }, { unique: true });
export const Semester = model('Semester', semesterSchema);

const sectionSchema = new Schema(
  {
    cohortId: ref('Cohort'),
    semesterId: ref('Semester'),
    name: { type: String, required: true, trim: true },
    status,
  },
  options,
);
sectionSchema.index({ semesterId: 1, name: 1 }, { unique: true });
export const Section = model('Section', sectionSchema);

const partSchema = new Schema(
  {
    cohortId: ref('Cohort'),
    semesterId: ref('Semester'),
    sectionId: ref('Section'),
    name: { type: String, required: true, trim: true },
    rollMin: { type: Number, required: true },
    rollMax: { type: Number, required: true },
    status,
  },
  options,
);
partSchema.index({ sectionId: 1, name: 1 }, { unique: true });
partSchema.index({ semesterId: 1, status: 1 });
export const Part = model('Part', partSchema);
