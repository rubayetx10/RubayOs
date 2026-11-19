import { Schema, model } from 'mongoose';

const ref = (to: string, required = true) => ({ type: Schema.Types.ObjectId, ref: to, required });

const topicSchema = new Schema({ title: { type: String, required: true }, subtopics: { type: [String], default: [] } }, { _id: false });

/**
 * The syllabus of one course (shared by every batch that studies it). A course has at most one draft
 * and one published version. Older published versions are kept as "superseded".
 */
const syllabusSchema = new Schema(
  {
    institutionId: ref('Institution'),
    collegeId: ref('College'),
    departmentId: ref('Department'),
    programId: ref('Program'),
    courseId: ref('Course'),
    versionNo: { type: Number, default: 0 },
    status: { type: String, enum: ['draft', 'published', 'superseded'], default: 'draft' },
    objectives: { type: [String], default: [] },
    topics: { type: [topicSchema], default: [] },
    changelog: { type: [String], default: [] },
    publishedAt: { type: Date, default: null },
    publishedBy: ref('User', false),
  },
  { timestamps: true },
);
syllabusSchema.index({ courseId: 1, status: 1 });
syllabusSchema.index({ courseId: 1 }, { unique: true, partialFilterExpression: { status: 'draft' }, name: 'one_draft' });
syllabusSchema.index({ courseId: 1 }, { unique: true, partialFilterExpression: { status: 'published' }, name: 'one_published' });
export const Syllabus = model('Syllabus', syllabusSchema);
