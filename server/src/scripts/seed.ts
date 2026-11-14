import { connectDb, disconnectDb } from '../config/db';
import { logger } from '../config/logger';
import { College, Department, Institution, Program } from '../modules/academic/academic.models';

/**
 * Seeds only the known top of the hierarchy. It does not invent sessions, sections,
 * roll ranges, courses or any official NU data. Codes below are internal and editable.
 * Safe to run repeatedly.
 */
async function main() {
  await connectDb();

  const institution = await Institution.findOneAndUpdate(
    { shortName: 'NU' },
    { $setOnInsert: { name: 'National University Bangladesh', type: 'university' } },
    { upsert: true, new: true },
  );
  const college = await College.findOneAndUpdate(
    { institutionId: institution._id, code: 'DCC' },
    { $setOnInsert: { name: 'Dhaka City College' } },
    { upsert: true, new: true },
  );
  const department = await Department.findOneAndUpdate(
    { collegeId: college._id, code: 'CSE' },
    { $setOnInsert: { name: 'Computer Science and Engineering', institutionId: institution._id } },
    { upsert: true, new: true },
  );
  const program = await Program.findOneAndUpdate(
    { departmentId: department._id, name: 'B.Sc. (Honours)' },
    {
      $setOnInsert: {
        institutionId: institution._id,
        collegeId: college._id,
        degreeType: 'bachelor_honours',
        durationYears: 4,
        semesterCount: 8,
      },
    },
    { upsert: true, new: true },
  );

  logger.info(
    { institution: String(institution._id), college: String(college._id), department: String(department._id), program: String(program._id) },
    'Seed complete',
  );
  await disconnectDb();
}

main().catch(async (err) => {
  logger.fatal({ err }, 'Seed failed');
  await disconnectDb().catch(() => undefined);
  process.exit(1);
});
