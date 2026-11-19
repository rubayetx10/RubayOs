/** Pure exam rules: date and time checks, clash detection, reading dates from a sheet. No database, no network. */
import { toMinutes } from '../routines/routine.logic';
import { normalizeTime, matchOffering, type OfferingOption } from '../routines/routine.import';

export interface ExamSlot {
  date: string;
  startTime: string;
  endTime: string;
  room?: string;
}
export interface ExamConflict {
  kind: 'students' | 'room';
  message: string;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const realDate = (y: number, m: number, d: number): string | null => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};
const year = (s: string) => (s.length === 2 ? 2000 + Number(s) : Number(s));

/**
 * Reads a date as written on a sheet and returns "YYYY-MM-DD", or null if it is not a real date.
 * Numbers are read day first (12/03/2026 is 12 March), as is usual in Bangladesh.
 */
export function normalizeDate(raw: unknown): string | null {
  const s = String(raw ?? '').trim().toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, '$1').replace(/,/g, ' ').replace(/\s+/g, ' ');
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) return realDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s);
  if (m) return realDate(year(m[3]!), Number(m[2]), Number(m[1]));
  m = /^(\d{1,2}) ?[-\s] ?([a-z]{3,9}) ?[-\s]? ?(\d{2}|\d{4})$/.exec(s);
  if (m) { const mo = MONTHS.indexOf(m[2]!.slice(0, 3)); return mo < 0 ? null : realDate(year(m[3]!), mo + 1, Number(m[1])); }
  m = /^([a-z]{3,9}) (\d{1,2}) (\d{2}|\d{4})$/.exec(s);
  if (m) { const mo = MONTHS.indexOf(m[1]!.slice(0, 3)); return mo < 0 ? null : realDate(year(m[3]!), mo + 1, Number(m[2])); }
  return null;
}

/** What is wrong with one exam slot, if anything. */
export function examProblem(e: ExamSlot): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date) || normalizeDate(e.date) !== e.date) return 'Date must be a real date';
  const a = toMinutes(e.startTime);
  const b = toMinutes(e.endTime);
  if (a === null || b === null) return 'Times must look like 10:00';
  if (b <= a) return 'An exam must end after it starts';
  return null;
}

const overlap = (a: ExamSlot, b: ExamSlot) => a.date === b.date && toMinutes(a.startTime)! < toMinutes(b.endTime)! && toMinutes(b.startTime)! < toMinutes(a.endTime)!;
const when = (e: ExamSlot) => `${e.date} ${e.startTime}-${e.endTime}`;
const sameRoom = (a?: string, b?: string) => !!a?.trim() && !!b?.trim() && a.trim().toLowerCase() === b.trim().toLowerCase();

/** Two exams of one batch at the same time, and a room used twice (also against other batches' exams). */
export function findExamConflicts(events: ExamSlot[], others: Array<ExamSlot & { label: string }>): ExamConflict[] {
  const out: ExamConflict[] = [];
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      if (overlap(events[i]!, events[j]!)) out.push({ kind: 'students', message: `Two exams of this batch overlap on ${when(events[i]!)}` });
    }
  }
  for (const e of events) for (const o of others) if (overlap(e, o) && sameRoom(e.room, o.room)) out.push({ kind: 'room', message: `Room ${e.room} is used by ${o.label} on ${when(e)}` });
  for (let i = 0; i < events.length; i++) for (let j = i + 1; j < events.length; j++) if (overlap(events[i]!, events[j]!) && sameRoom(events[i]!.room, events[j]!.room)) out.push({ kind: 'room', message: `Room ${events[i]!.room} is used twice on ${when(events[i]!)}` });
  return out;
}

// ---------------------------------------------------------------- reading an exam schedule file

export interface ProposedExam {
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  room: string;
  title: string;
  offeringId: string | null;
  matchedBy: 'code' | 'name' | null;
  sheet: { courseCode: string; courseName: string };
  problems: string[];
}
const text = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');

export function buildExamProposal(entries: Array<Record<string, unknown>>, offerings: OfferingOption[], defaultTitle: string): ProposedExam[] {
  return entries.map((e) => {
    const sheet = { courseCode: text(e['courseCode']), courseName: text(e['courseName']) };
    const date = normalizeDate(e['date']);
    const startTime = normalizeTime(e['start'] ?? e['startTime']);
    const endTime = normalizeTime(e['end'] ?? e['endTime']);
    const match = matchOffering(sheet, offerings);
    const problems: string[] = [];
    if (!date) problems.push('Date not recognised');
    if (!startTime || !endTime) problems.push('Time not recognised');
    else if (toMinutes(endTime)! <= toMinutes(startTime)!) problems.push('End time is not after start time');
    if (!match) problems.push('Course not found in this semester’s courses. Choose it.');
    return { date, startTime, endTime, room: text(e['room']), title: text(e['title']) || defaultTitle, offeringId: match?.offering.id ?? null, matchedBy: match?.by ?? null, sheet, problems };
  });
}

export function buildExamPrompt(offerings: OfferingOption[]): string {
  const list = offerings.map((o) => `${o.code} - ${o.name}`).join('\n');
  return [
    'You read a college exam schedule from the attached PDF or image.',
    'Answer with ONLY this JSON and nothing else:',
    '{"entries":[{"date":"2026-12-01","start":"10:00","end":"13:00","courseCode":"","courseName":"","room":"","title":""}],"notes":""}',
    'Rules:',
    '- One entry for each exam. Skip holidays and empty cells.',
    '- Write the date as YYYY-MM-DD. Numeric dates on the sheet are day first (12/03/2026 is 12 March 2026). If the year is not printed, use ' + new Date().getFullYear() + '.',
    '- Use 24-hour times (HH:MM). If only a start time is printed, leave "end" empty.',
    '- Copy course codes and room numbers exactly as written. Use "" for anything not shown. Put a heading like "Mid Term" or "Final" in "title" if shown.',
    '- Never invent an exam that is not on the sheet. Put anything unclear in "notes".',
    'Courses this semester, for reference only:',
    list || '(none yet)',
  ].join('\n');
}
