import { Schema, model } from 'mongoose';

const options = { timestamps: true } as const;
const ref = (to: string, required = true) => ({ type: Schema.Types.ObjectId, ref: to, required });

/** The teacher's student sheet: who is allowed to join which cohort. */
const rosterSchema = new Schema(
  {
    institutionId: ref('Institution'),
    collegeId: ref('College'),
    departmentId: ref('Department'),
    cohortId: ref('Cohort'),
    name: { type: String, required: true, trim: true },
    nameKey: { type: String, required: true },
    registrationNo: { type: String, required: true, trim: true },
    classRoll: { type: Number, required: true },
    status: { type: String, enum: ['unclaimed', 'claimed'], default: 'unclaimed' },
    claimedBy: ref('User', false),
    source: { type: String, enum: ['import', 'admin_approved'], default: 'import' },
    batchId: { type: String, default: null },
  },
  options,
);
rosterSchema.index({ institutionId: 1, registrationNo: 1 }, { unique: true });
rosterSchema.index({ cohortId: 1, classRoll: 1 }, { unique: true });
rosterSchema.index({ cohortId: 1, status: 1 });
export const RosterEntry = model('RosterEntry', rosterSchema);

/** One row per student: their fixed academic identity. Section and part are assigned in Step 1.5. */
const profileSchema = new Schema(
  {
    userId: { ...ref('User'), unique: true },
    institutionId: ref('Institution'),
    collegeId: ref('College'),
    departmentId: ref('Department'),
    programId: ref('Program'),
    cohortId: ref('Cohort'),
    currentSemesterId: ref('Semester', false),
    sectionId: ref('Section', false),
    partId: ref('Part', false),
    registrationNo: { type: String, required: true },
    classRoll: { type: Number, required: true },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  },
  options,
);
profileSchema.index({ cohortId: 1, classRoll: 1 }, { unique: true });
profileSchema.index({ institutionId: 1, registrationNo: 1 }, { unique: true });
profileSchema.index({ departmentId: 1, currentSemesterId: 1, sectionId: 1, partId: 1 });
export const StudentProfile = model('StudentProfile', profileSchema);

/** A registration that did not match the roster perfectly and waits for an admin. */
const requestSchema = new Schema(
  {
    userId: ref('User'),
    institutionId: ref('Institution'),
    collegeId: ref('College'),
    departmentId: ref('Department'),
    cohortId: ref('Cohort', false),
    rosterEntryId: ref('RosterEntry', false),
    submitted: {
      name: { type: String, required: true },
      registrationNo: { type: String, required: true },
      classRoll: { type: Number, required: true },
    },
    reasons: [{ type: String, enum: ['not_in_roster', 'name_mismatch', 'roll_mismatch', 'department_mismatch'] }],
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    reviewedBy: ref('User', false),
    reviewedAt: { type: Date, default: null },
    rejectReason: { type: String, default: null },
  },
  options,
);
requestSchema.index({ departmentId: 1, status: 1, createdAt: -1 });
requestSchema.index({ collegeId: 1, status: 1, createdAt: -1 });
requestSchema.index({ userId: 1, status: 1 });
export const RegistrationRequest = model('RegistrationRequest', requestSchema);
