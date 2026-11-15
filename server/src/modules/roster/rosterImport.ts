import Papa from 'papaparse';
import { normalizeName, normalizeRegNo } from '../students/nameMatch';

export interface RosterRow {
  rowNo: number;
  name: string;
  registrationNo: string;
  classRoll: number;
}
export interface RowError {
  rowNo: number;
  message: string;
}

const clean = (h: string) => h.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

const ALIASES = {
  name: ['name', 'studentname', 'fullname', 'student', 'নাম', 'শিক্ষার্থীরনাম'],
  registrationNo: ['reg', 'regno', 'registration', 'registrationno', 'registrationnumber', 'nuregno', 'nuregistrationno', 'nureg', 'রেজিস্ট্রেশন', 'রেজিঃনং'],
  classRoll: ['roll', 'classroll', 'rollno', 'rollnumber', 'classrollno', 'রোল', 'ক্লাসরোল'],
} as const;

export type Field = keyof typeof ALIASES;
export type Mapping = Record<Field, string>;

/** Finds which CSV column is the name, registration number and class roll. */
export function detectMapping(headers: string[]): { mapping?: Mapping; missing: Field[] } {
  const found: Partial<Mapping> = {};
  for (const header of headers) {
    const key = clean(header);
    for (const field of Object.keys(ALIASES) as Field[]) {
      if (!found[field] && (ALIASES[field] as readonly string[]).includes(key)) found[field] = header;
    }
  }
  const missing = (Object.keys(ALIASES) as Field[]).filter((f) => !found[f]);
  return missing.length ? { missing } : { mapping: found as Mapping, missing: [] };
}

export function parseCsv(csv: string): { headers: string[]; rows: Record<string, string>[] } {
  const result = Papa.parse<Record<string, string>>(csv.replace(/^\uFEFF/, ''), { header: true, skipEmptyLines: 'greedy' });
  return { headers: result.meta.fields ?? [], rows: result.data };
}

export function mapRows(rows: Record<string, unknown>[], mapping: Mapping): Record<string, unknown>[] {
  return rows.map((r) => ({
    name: r[mapping.name],
    registrationNo: r[mapping.registrationNo],
    classRoll: r[mapping.classRoll],
  }));
}

/** Validates rows and flags duplicates inside the file. Row numbers match the sheet (header is row 1). */
export function validateRows(raw: Record<string, unknown>[]): { valid: RosterRow[]; errors: RowError[] } {
  const errors: RowError[] = [];
  const candidates: RosterRow[] = [];

  raw.forEach((r, i) => {
    const rowNo = i + 2;
    const name = String(r['name'] ?? '').trim();
    const reg = normalizeRegNo(String(r['registrationNo'] ?? ''));
    const rollText = String(r['classRoll'] ?? '').trim();
    const classRoll = Number(rollText);

    if (name.length < 2) return errors.push({ rowNo, message: 'Name is missing or too short' });
    if (!/^[A-Z0-9-]{4,25}$/.test(reg)) return errors.push({ rowNo, message: `Invalid registration number "${reg}"` });
    if (!/^\d+$/.test(rollText) || classRoll < 1 || classRoll > 9999) {
      return errors.push({ rowNo, message: `Invalid class roll "${rollText}"` });
    }
    candidates.push({ rowNo, name, registrationNo: reg, classRoll });
  });

  const byReg = new Map<string, RosterRow[]>();
  const byRoll = new Map<number, RosterRow[]>();
  for (const c of candidates) {
    byReg.set(c.registrationNo, [...(byReg.get(c.registrationNo) ?? []), c]);
    byRoll.set(c.classRoll, [...(byRoll.get(c.classRoll) ?? []), c]);
  }
  const bad = new Set<number>();
  for (const [reg, list] of byReg) {
    if (list.length > 1) list.forEach((c) => { bad.add(c.rowNo); errors.push({ rowNo: c.rowNo, message: `Registration number ${reg} appears more than once in the file` }); });
  }
  for (const [roll, list] of byRoll) {
    if (list.length > 1) list.forEach((c) => { if (!bad.has(c.rowNo)) bad.add(c.rowNo); errors.push({ rowNo: c.rowNo, message: `Class roll ${roll} appears more than once in the file` }); });
  }
  errors.sort((a, b) => a.rowNo - b.rowNo);
  return { valid: candidates.filter((c) => !bad.has(c.rowNo)), errors };
}

export { normalizeName };
