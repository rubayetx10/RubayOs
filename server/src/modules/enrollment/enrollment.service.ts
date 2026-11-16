/* eslint-disable @typescript-eslint/no-explicit-any */
import mongoose, { type ClientSession } from 'mongoose';
import { AppError } from '../../common/errors';
import { Cohort, Part, Section, Semester } from '../academic/academic.models';
import { findRangeForRoll } from '../academic/rollRanges';
import { RosterEntry, StudentProfile } from '../students/student.models';
import { AssignmentHistory, SemesterEnrollment } from './enrollment.models';
import { overlappingPairs, planAssignments, rangeGaps, type Mode, type PartRange } from './enrollment.logic';

const sid = (v: unknown): string | null => (v ? String(v) : null);

async function activeRanges(semesterId: unknown, session?: ClientSession): Promise<PartRange[]> {
  const parts = await Part.find({ semesterId, status: 'active' }).session(session ?? null).lean();
  return parts.map((p) => ({ id: String(p._id), sectionId: String(p.sectionId), min: p.rollMin, max: p.rollMax, label: p.name }));
}

/**
 * Called when a student joins (auto or approved). Creates their enrollment for the cohort's current
 * semester and places them in the part that covers their roll, if one exists yet.
 */
export async function enrollOnJoin(
  profile: { _id: unknown; userId: unknown; cohortId: unknown; classRoll: number },
  semester: { _id: unknown },
  session: ClientSession,
): Promise<void> {
  const ranges = await activeRanges(semester._id, session);
  const hit = findRangeForRoll(ranges.map((r) => ({ ...r })), profile.classRoll);
  const placed = hit ? { sectionId: hit.sectionId, partId: hit.id } : { sectionId: null, partId: null };

  await SemesterEnrollment.create(
    [{ profileId: profile._id, userId: profile.userId, cohortId: profile.cohortId, semesterId: semester._id, classRoll: profile.classRoll, ...placed, assignedBy: hit ? 'auto' : 'none' }],
    { session },
  );
  if (hit) {
    await StudentProfile.updateOne({ _id: profile._id }, { $set: placed }, { session });
    await AssignmentHistory.create(
      [{ profileId: profile._id, userId: profile.userId, cohortId: profile.cohortId, semesterId: semester._id, from: {}, to: placed, method: 'auto', reason: 'Joined' }],
      { session },
    );
  }
}

export interface RunInput {
  cohort: any;
  semester: any;
  mode: Mode;
  dryRun: boolean;
  actorId?: string | null;
}

/** Fills in (or, in mode "all", corrects) section and part for every student of a semester from the roll ranges. */
export async function runAssignment({ cohort, semester, mode, dryRun, actorId }: RunInput) {
  const [enrollments, ranges] = await Promise.all([
    SemesterEnrollment.find({ semesterId: semester._id, status: 'active' }).lean(),
    activeRanges(semester._id),
  ]);

  const plan = planAssignments(
    enrollments.map((e) => ({ profileId: String(e.profileId), roll: e.classRoll, sectionId: sid(e.sectionId), partId: sid(e.partId), manual: e.assignedBy === 'manual' })),
    ranges,
    mode,
  );

  if (!dryRun && plan.toAssign.length) {
    const byProfile = new Map(enrollments.map((e) => [String(e.profileId), e]));
    const isCurrent = semester.number === cohort.currentSemesterNo;
    const db = await mongoose.startSession();
    try {
      await db.withTransaction(async () => {
        await SemesterEnrollment.bulkWrite(
          plan.toAssign.map((c) => ({
            updateOne: { filter: { profileId: c.profileId, semesterId: semester._id }, update: { $set: { sectionId: c.sectionId, partId: c.partId, assignedBy: 'auto' } } },
          })) as any[],
          { session: db },
        );
        if (isCurrent) {
          await StudentProfile.bulkWrite(
            plan.toAssign.map((c) => ({ updateOne: { filter: { _id: c.profileId }, update: { $set: { sectionId: c.sectionId, partId: c.partId } } } })) as any[],
            { session: db },
          );
        }
        await AssignmentHistory.insertMany(
          plan.toAssign.map((c) => {
            const e = byProfile.get(c.profileId)!;
            return {
              profileId: c.profileId,
              userId: e.userId,
              cohortId: cohort._id,
              semesterId: semester._id,
              from: { sectionId: e.sectionId ?? null, partId: e.partId ?? null },
              to: { sectionId: c.sectionId, partId: c.partId },
              method: 'auto',
              reason: mode === 'all' ? 'Automatic correction' : 'Automatic assignment',
              actorId: actorId ?? null,
            };
          }),
          { session: db },
        );
      });
    } finally {
      await db.endSession();
    }
  }

  return {
    mode,
    dryRun,
    assigned: plan.toAssign.length,
    unchanged: plan.unchanged.length,
    manual: plan.manual.length,
    misplaced: plan.misplaced.length,
    uncovered: plan.uncovered.length,
    changes: plan.toAssign.slice(0, 200).map((c) => ({ profileId: c.profileId, classRoll: c.roll, fromPartId: c.fromPartId, toPartId: c.partId })),
  };
}

/** Manual placement by an admin. Allowed even outside the roll range, but it is flagged and remembered. */
export async function reassignStudent(profileId: string, partId: string, reason: string, actorId: string) {
  const profile = await StudentProfile.findById(profileId);
  if (!profile) throw AppError.notFound('Student not found');
  if (!profile.currentSemesterId) throw AppError.badRequest('This student has no current semester');

  const part = await Part.findById(partId);
  if (!part || part.status !== 'active') throw AppError.badRequest('Part not found or not active');
  if (String(part.cohortId) !== String(profile.cohortId) || String(part.semesterId) !== String(profile.currentSemesterId)) {
    throw AppError.badRequest('This part belongs to a different cohort or semester');
  }

  const enrollment = await SemesterEnrollment.findOne({ profileId: profile._id, semesterId: profile.currentSemesterId, status: 'active' });
  if (!enrollment) throw AppError.conflict('The student has no active enrollment for this semester');
  if (String(enrollment.partId) === String(part._id)) throw AppError.conflict('The student is already in this part');

  const from = { sectionId: enrollment.sectionId ?? null, partId: enrollment.partId ?? null };
  const to = { sectionId: part.sectionId, partId: part._id };

  const db = await mongoose.startSession();
  try {
    await db.withTransaction(async () => {
      enrollment.sectionId = part.sectionId;
      enrollment.partId = part._id;
      enrollment.assignedBy = 'manual';
      await enrollment.save({ session: db });
      await StudentProfile.updateOne({ _id: profile._id }, { $set: { sectionId: part.sectionId, partId: part._id } }, { session: db });
      await AssignmentHistory.create(
        [{ profileId: profile._id, userId: profile.userId, cohortId: profile.cohortId, semesterId: profile.currentSemesterId, from, to, method: 'manual', reason, actorId }],
        { session: db },
      );
    });
  } finally {
    await db.endSession();
  }
  return { profileId, partId, sectionId: String(part.sectionId), outsideRange: profile.classRoll < part.rollMin || profile.classRoll > part.rollMax };
}

/**
 * Moves a whole cohort to its next semester. Old enrollments are closed, not deleted.
 * New semester parts may not exist yet, so students can start unassigned; the roll engine fills them in once parts are added.
 */
export async function promoteCohort(cohortId: string, toSemesterNo: number, actorId: string) {
  const cohort = await Cohort.findById(cohortId);
  if (!cohort) throw AppError.notFound('Cohort not found');
  if (toSemesterNo !== cohort.currentSemesterNo + 1) {
    throw AppError.badRequest(`A cohort moves one semester at a time. It is in semester ${cohort.currentSemesterNo}, so the next is ${cohort.currentSemesterNo + 1}.`);
  }
  const [from, to] = await Promise.all([
    Semester.findOne({ cohortId, number: cohort.currentSemesterNo }),
    Semester.findOne({ cohortId, number: toSemesterNo }),
  ]);
  if (!to) throw AppError.badRequest('That semester does not exist for this program');

  const profiles = await StudentProfile.find({ cohortId, status: 'active' });
  const ranges = await activeRanges(to._id);
  let assigned = 0;

  const db = await mongoose.startSession();
  try {
    await db.withTransaction(async () => {
      assigned = 0;
      if (from) {
        from.status = 'completed';
        await from.save({ session: db });
        await SemesterEnrollment.updateMany({ semesterId: from._id, status: 'active' }, { $set: { status: 'completed' } }, { session: db });
      }
      to.status = 'active';
      await to.save({ session: db });
      cohort.currentSemesterNo = toSemesterNo;
      await cohort.save({ session: db });

      for (const p of profiles) {
        const hit = findRangeForRoll(ranges, p.classRoll);
        const placed = hit ? { sectionId: hit.sectionId, partId: hit.id } : { sectionId: null, partId: null };
        if (hit) assigned += 1;
        await SemesterEnrollment.create(
          [{ profileId: p._id, userId: p.userId, cohortId, semesterId: to._id, classRoll: p.classRoll, ...placed, assignedBy: hit ? 'auto' : 'none' }],
          { session: db },
        );
        await StudentProfile.updateOne({ _id: p._id }, { $set: { currentSemesterId: to._id, ...placed } }, { session: db });
        await AssignmentHistory.create(
          [{ profileId: p._id, userId: p.userId, cohortId, semesterId: to._id, from: { sectionId: p.sectionId ?? null, partId: p.partId ?? null }, to: placed, method: 'promotion', reason: `Semester ${toSemesterNo - 1} to ${toSemesterNo}`, actorId }],
          { session: db },
        );
      }
    });
  } finally {
    await db.endSession();
  }
  return { fromSemesterNo: toSemesterNo - 1, toSemesterNo, students: profiles.length, assigned, unassigned: profiles.length - assigned };
}

/** Counts per part plus everything an admin should look at: gaps in the ranges, uncovered rolls, wrongly placed students. */
export async function overview(cohort: any, semester: any) {
  const [enrollments, parts, sections] = await Promise.all([
    SemesterEnrollment.find({ semesterId: semester._id, status: { $in: ['active', 'completed'] } }).lean(),
    Part.find({ semesterId: semester._id }).sort({ rollMin: 1 }).lean(),
    Section.find({ semesterId: semester._id }).lean(),
  ]);
  const sectionName = new Map(sections.map((s) => [String(s._id), s.name]));
  const counts = new Map<string, number>();
  for (const e of enrollments) if (e.partId) counts.set(String(e.partId), (counts.get(String(e.partId)) ?? 0) + 1);

  const activeParts = parts.filter((p) => p.status === 'active');
  const ranges: PartRange[] = activeParts.map((p) => ({ id: String(p._id), sectionId: String(p.sectionId), min: p.rollMin, max: p.rollMax }));
  const plan = planAssignments(
    enrollments.map((e) => ({ profileId: String(e.profileId), roll: e.classRoll, sectionId: sid(e.sectionId), partId: sid(e.partId), manual: e.assignedBy === 'manual' })),
    ranges,
    'unassigned',
  );
  const assigned = enrollments.filter((e) => e.partId).length;

  return {
    cohort: { id: String(cohort._id), currentSemesterNo: cohort.currentSemesterNo },
    semester: { id: String(semester._id), number: semester.number, status: semester.status },
    totals: { students: enrollments.length, assigned, unassigned: enrollments.length - assigned },
    parts: parts.map((p) => ({
      id: String(p._id),
      name: p.name,
      status: p.status,
      sectionId: String(p.sectionId),
      sectionName: sectionName.get(String(p.sectionId)) ?? '',
      rollMin: p.rollMin,
      rollMax: p.rollMax,
      students: counts.get(String(p._id)) ?? 0,
    })),
    warnings: {
      gaps: rangeGaps(ranges.map((r) => ({ min: r.min, max: r.max }))),
      overlaps: overlappingPairs(ranges),
      uncovered: plan.uncovered.map((u) => ({ profileId: u.profileId, classRoll: u.roll })),
      misplaced: plan.misplaced.map((m) => ({ profileId: m.profileId, classRoll: m.roll, partId: m.partId, expectedPartId: m.expectedPartId })),
    },
  };
}

/**
 * Changes a student's class roll everywhere it is stored: the class list, the profile and every semester record.
 * A student who is not registered yet only has the class list entry changed.
 * Afterwards the student is placed again in the current semester from the new roll, unless an admin placed them by hand.
 */
export async function changeRoll(entry: any, newRoll: number, reason: string, actorId: string) {
  const oldRoll = entry.classRoll as number;
  if (newRoll === oldRoll) throw AppError.conflict(`The roll is already ${newRoll}`);
  const clash = await RosterEntry.findOne({ cohortId: entry.cohortId, classRoll: newRoll, _id: { $ne: entry._id } }).lean();
  if (clash) throw AppError.conflict(`Roll ${newRoll} already belongs to ${clash.name} (${clash.registrationNo}). Change that student first.`);

  const profile = await StudentProfile.findOne({ institutionId: entry.institutionId, registrationNo: entry.registrationNo });
  if (!profile) {
    entry.classRoll = newRoll;
    await entry.save();
    return { oldRoll, newRoll, registered: false, placed: null as string | null };
  }

  let placedPart: string | null = null;
  const db = await mongoose.startSession();
  try {
    await db.withTransaction(async () => {
      placedPart = null;
      await RosterEntry.updateOne({ _id: entry._id }, { $set: { classRoll: newRoll } }, { session: db });
      await StudentProfile.updateOne({ _id: profile._id }, { $set: { classRoll: newRoll } }, { session: db });
      await SemesterEnrollment.updateMany({ profileId: profile._id }, { $set: { classRoll: newRoll } }, { session: db });

      if (!profile.currentSemesterId) return;
      const enrollment = await SemesterEnrollment.findOne({ profileId: profile._id, semesterId: profile.currentSemesterId, status: 'active' }).session(db);
      placedPart = enrollment?.partId ? String(enrollment.partId) : null;
      if (!enrollment || enrollment.assignedBy === 'manual') return;

      const hit = findRangeForRoll(await activeRanges(profile.currentSemesterId, db), newRoll);
      const to = hit ? { sectionId: hit.sectionId, partId: hit.id } : { sectionId: null, partId: null };
      if (String(enrollment.partId ?? '') === String(to.partId ?? '')) return;

      const from = { sectionId: enrollment.sectionId ?? null, partId: enrollment.partId ?? null };
      await SemesterEnrollment.updateOne({ _id: enrollment._id }, { $set: { ...to, assignedBy: hit ? 'auto' : 'none' } }, { session: db });
      await StudentProfile.updateOne({ _id: profile._id }, { $set: to }, { session: db });
      await AssignmentHistory.create(
        [{ profileId: profile._id, userId: profile.userId, cohortId: profile.cohortId, semesterId: profile.currentSemesterId, from, to, method: 'auto', reason: `Roll changed ${oldRoll} to ${newRoll}: ${reason}`, actorId }],
        { session: db },
      );
      placedPart = to.partId;
    });
  } finally {
    await db.endSession();
  }
  return { oldRoll, newRoll, registered: true, placed: placedPart };
}
