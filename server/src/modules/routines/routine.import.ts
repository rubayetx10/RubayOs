/** Pure helpers for turning an AI reading of a routine into rows an admin can review. No database, no network. */
import { z } from 'zod';
import { toMinutes } from './routine.logic';

// ---------------------------------------------------------------- files

/** The real type of an uploaded file, from its first bytes (the filename and the browser's claim are not trusted). */
export function sniffMime(b: Buffer): 'application/pdf' | 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (b.length < 12) return null;
  if (b.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (b[0] === 0x89 && b.subarray(1, 4).toString('latin1') === 'PNG') return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

// ---------------------------------------------------------------- normalising what the sheet says

const DAYS: Record<string, number> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6,
  'রবিবার': 0, 'রবি': 0, 'সোমবার': 1, 'সোম': 1, 'মঙ্গলবার': 2, 'মঙ্গল': 2, 'বুধবার': 3, 'বুধ': 3,
  'বৃহস্পতিবার': 4, 'বৃহস্পতি': 4, 'শুক্রবার': 5, 'শুক্র': 5, 'শনিবার': 6, 'শনি': 6,
};

export function normalizeDay(raw: unknown): number | null {
  const k = String(raw ?? '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return k in DAYS ? DAYS[k]! : null;
}

/**
 * "9:30", "09.30", "9:30 PM", "2pm" become "HH:MM". Without am or pm, hours 1 to 6 are taken as afternoon
 * (a class at "2:00" is 14:00), because college classes do not start in the small hours.
 */
export function normalizeTime(raw: unknown): string | null {
  const m = /^(\d{1,2})(?:\s*[:.]\s*(\d{2}))?\s*(?:([ap])\.?\s*m\.?)?$/i.exec(String(raw ?? '').trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const ap = m[3]?.toLowerCase();
  if (min > 59) return null;
  if (ap) {
    if (h < 1 || h > 12) return null;
    if (ap === 'p' && h < 12) h += 12;
    if (ap === 'a' && h === 12) h = 0;
  } else if (h >= 1 && h <= 6) h += 12;
  const t = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  return toMinutes(t) === null ? null : t;
}

const alnum = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
const letters = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const sectionKey = (s: string) => letters(s).replace(/^(section|sec|group)/, '');

export interface OfferingOption {
  id: string;
  code: string;
  name: string;
  teachers: Array<{ id: string; name: string }>;
}

/** Which of this semester's courses does the sheet mean? By code first, then by name. Never guesses between two. */
export function matchOffering(sheet: { courseCode?: string; courseName?: string }, offerings: OfferingOption[]): { offering: OfferingOption; by: 'code' | 'name' } | null {
  const code = alnum(sheet.courseCode ?? '');
  if (code) {
    const hit = offerings.filter((o) => alnum(o.code) === code);
    if (hit.length === 1) return { offering: hit[0]!, by: 'code' };
  }
  const name = letters(sheet.courseName ?? '');
  if (name.length >= 6) {
    const hit = offerings.filter((o) => {
      const n = letters(o.name);
      return n === name || (n.length >= 6 && (n.includes(name) || name.includes(n)));
    });
    if (hit.length === 1) return { offering: hit[0]!, by: 'name' };
  }
  return null;
}

/** The offering's own teacher list is the truth. The sheet's name only picks between several. */
export function pickTeacher(sheetTeacher: string | undefined, offering: OfferingOption): string | null {
  if (offering.teachers.length === 1) return offering.teachers[0]!.id;
  const t = letters(sheetTeacher ?? '');
  if (!t) return null;
  const hit = offering.teachers.filter((x) => {
    const n = letters(x.name);
    return n === t || (t.length >= 4 && (n.includes(t) || t.includes(n)));
  });
  return hit.length === 1 ? hit[0]!.id : null;
}

// ---------------------------------------------------------------- the AI's answer

const aiSchema = z.object({ entries: z.array(z.record(z.unknown())).max(300), notes: z.string().optional() });

/** Reads the AI's JSON, tolerating code fences around it. Throws if it is not the expected shape. */
export function parseAiJson(text: string): { entries: Array<Record<string, unknown>>; notes: string } {
  const body = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const parsed = aiSchema.parse(JSON.parse(body));
  return { entries: parsed.entries, notes: parsed.notes ?? '' };
}

export interface ProposedRow {
  day: number | null;
  startTime: string | null;
  endTime: string | null;
  room: string;
  offeringId: string | null;
  teacherId: string | null;
  matchedBy: 'code' | 'name' | null;
  otherSection: boolean;
  sheet: { courseCode: string; courseName: string; teacher: string; section: string };
  problems: string[];
}

const text = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');

/** Turns what the AI read into reviewable rows, with every doubt written down as a problem. */
export function buildProposal(entries: Array<Record<string, unknown>>, offerings: OfferingOption[], sectionName: string): ProposedRow[] {
  return entries.map((e) => {
    const sheet = { courseCode: text(e['courseCode']), courseName: text(e['courseName']), teacher: text(e['teacher']), section: text(e['section']) };
    const day = normalizeDay(e['day']);
    const startTime = normalizeTime(e['start'] ?? e['startTime']);
    const endTime = normalizeTime(e['end'] ?? e['endTime']);
    const match = matchOffering(sheet, offerings);
    const problems: string[] = [];
    if (day === null) problems.push('Day not recognised');
    if (!startTime || !endTime) problems.push('Time not recognised');
    else if (toMinutes(endTime)! <= toMinutes(startTime)!) problems.push('End time is not after start time');
    if (!match) problems.push('Course not found in this semester’s courses. Choose it.');
    return {
      day, startTime, endTime,
      room: text(e['room']),
      offeringId: match?.offering.id ?? null,
      teacherId: match ? pickTeacher(sheet.teacher, match.offering) : null,
      matchedBy: match?.by ?? null,
      otherSection: !!sheet.section && sectionKey(sheet.section) !== sectionKey(sectionName),
      sheet,
      problems,
    };
  });
}

export function buildPrompt(offerings: OfferingOption[], sectionName: string): string {
  const list = offerings.map((o) => `${o.code} - ${o.name}`).join('\n');
  return [
    'You read a college class routine (weekly timetable) from the attached PDF or image.',
    'Answer with ONLY this JSON and nothing else:',
    '{"entries":[{"day":"Sunday","start":"09:00","end":"10:00","courseCode":"","courseName":"","teacher":"","room":"","section":""}],"notes":""}',
    'Rules:',
    '- One entry for each class period on each day. Skip breaks, prayer time and empty cells.',
    '- Use 24-hour times (HH:MM) and English day names.',
    '- Copy course codes, teacher names and room numbers exactly as written on the sheet. Use "" for anything not shown.',
    `- The routine I need is for section "${sectionName}". If the sheet has several sections or groups, include all of them and put the section or group name in "section".`,
    '- Never invent a class that is not on the sheet. Put anything unclear in "notes".',
    'Courses this semester, for reference only:',
    list || '(none yet)',
  ].join('\n');
}
