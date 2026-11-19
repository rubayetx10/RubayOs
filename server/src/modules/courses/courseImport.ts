/** Pure parsing and checking of a course list file. No database access. */
import type { RowError } from '../roster/rosterImport';

export interface CourseRow {
  rowNo: number;
  code: string;
  name: string;
  credit: number;
  semesterNumber: number;
  type: 'theory' | 'lab' | 'elective';
}

const clean = (h: string) => h.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

const ALIASES = {
  code: ['code', 'coursecode', 'courseno', 'subjectcode', 'cc'],
  name: ['name', 'coursename', 'coursetitle', 'title', 'subject', 'subjectname'],
  credit: ['credit', 'credits', 'creditpoint', 'creditpoints', 'creditHour', 'credithour', 'credithours'],
  semesterNumber: ['semester', 'sem', 'semesterno', 'semesternumber'],
  type: ['type', 'coursetype', 'kind'],
} as const;

type Field = keyof typeof ALIASES;
export type CourseMapping = Record<Exclude<Field, 'type'>, string> & { type?: string };

/** Which column is which. Type is optional (defaults to theory). */
export function detectCourseMapping(headers: string[]): { mapping?: CourseMapping; missing: Field[] } {
  const found: Partial<Record<Field, string>> = {};
  for (const header of headers) {
    const key = clean(header);
    for (const f of Object.keys(ALIASES) as Field[]) {
      if (!found[f] && (ALIASES[f] as readonly string[]).map(clean).includes(key)) found[f] = header;
    }
  }
  const missing = (['code', 'name', 'credit', 'semesterNumber'] as Field[]).filter((f) => !found[f]);
  return missing.length ? { missing } : { mapping: found as CourseMapping, missing: [] };
}

export function mapCourseRows(rows: Record<string, unknown>[], m: CourseMapping): Record<string, unknown>[] {
  return rows.map((r) => ({ code: r[m.code], name: r[m.name], credit: r[m.credit], semesterNumber: r[m.semesterNumber], type: m.type ? r[m.type] : undefined }));
}

function toType(v: string): CourseRow['type'] {
  const t = v.toLowerCase();
  if (t.includes('lab') || t.includes('practical') || t.includes('sessional')) return 'lab';
  if (t.includes('elective') || t.includes('optional')) return 'elective';
  return 'theory';
}

export function validateCourseRows(raw: Record<string, unknown>[]): { valid: CourseRow[]; errors: RowError[] } {
  const errors: RowError[] = [];
  const candidates: CourseRow[] = [];

  raw.forEach((r, i) => {
    const rowNo = i + 2;
    const code = String(r['code'] ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
    const name = String(r['name'] ?? '').trim();
    const credit = Number(String(r['credit'] ?? '').trim());
    const semMatch = String(r['semesterNumber'] ?? '').match(/^\D*(\d{1,2})\D*$/);
    const semesterNumber = semMatch ? Number(semMatch[1]) : NaN;

    if (!/^[A-Z0-9][A-Z0-9 .\-_/]{0,29}$/.test(code)) return errors.push({ rowNo, message: `Invalid course code "${code}"` });
    if (name.length < 2) return errors.push({ rowNo, message: 'Course name is missing' });
    if (!Number.isFinite(credit) || credit < 0.5 || credit > 12) return errors.push({ rowNo, message: `Invalid credit "${String(r['credit'] ?? '')}"` });
    if (!Number.isInteger(semesterNumber) || semesterNumber < 1 || semesterNumber > 16) {
      return errors.push({ rowNo, message: `Invalid semester "${String(r['semesterNumber'] ?? '')}"` });
    }
    candidates.push({ rowNo, code, name, credit, semesterNumber, type: toType(String(r['type'] ?? '')) });
  });

  const seen = new Map<string, number[]>();
  for (const c of candidates) seen.set(c.code, [...(seen.get(c.code) ?? []), c.rowNo]);
  const dup = new Set<number>();
  for (const [code, rows] of seen) {
    if (rows.length > 1) rows.forEach((rowNo) => { dup.add(rowNo); errors.push({ rowNo, message: `Course code ${code} appears more than once in the file` }); });
  }
  errors.sort((a, b) => a.rowNo - b.rowNo);
  return { valid: candidates.filter((c) => !dup.has(c.rowNo)), errors };
}
