import { Schema, model } from 'mongoose';

const ref = (to: string) => ({ type: Schema.Types.ObjectId, ref: to, required: true });

/**
 * A course of a program, for example "Data Structures" in semester 3. Codes, names and credits are typed
 * in by an admin or imported from a file. Nothing here is invented or copied from official sources.
 */
const courseSchema = new Schema(
  {
    institutionId: ref('Institution'),
    collegeId: ref('College'),
    departmentId: ref('Department'),
    programId: ref('Program'),
    code: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    credit: { type: Number, required: true, min: 0.5, max: 12 },
    type: { type: String, enum: ['theory', 'lab', 'elective'], default: 'theory' },
    semesterNumber: { type: Number, required: true, min: 1, max: 16 },
    description: { type: String, default: '' },
    status: { type: String, enum: ['draft', 'published', 'archived'], default: 'published' },
  },
  { timestamps: true },
);
courseSchema.index({ programId: 1, code: 1 }, { unique: true });
courseSchema.index({ programId: 1, semesterNumber: 1, status: 1 });
export const Course = model('Course', courseSchema);
