import { describe, expect, it } from 'vitest';
import { detectMapping, mapRows, parseCsv, validateRows } from '../src/modules/roster/rosterImport';

describe('detectMapping', () => {
  it('finds common column names', () => {
    const r = detectMapping(['SL', 'Name', 'Reg. No', 'Class Roll']);
    expect(r.mapping).toEqual({ name: 'Name', registrationNo: 'Reg. No', classRoll: 'Class Roll' });
  });
  it('is case and punctuation insensitive', () => {
    expect(detectMapping(['STUDENT NAME', 'NU Registration No', 'ROLL']).mapping).toBeDefined();
  });
  it('reports which columns are missing', () => {
    const r = detectMapping(['Name', 'Roll']);
    expect(r.mapping).toBeUndefined();
    expect(r.missing).toEqual(['registrationNo']);
  });
});

describe('parseCsv + mapRows + validateRows', () => {
  const csv = '\uFEFFName,Reg No,Roll\nRahim Uddin,1234567890,15\nKarim Ali,1234567891,16\n';
  it('reads a CSV with a BOM and maps columns', () => {
    const { headers, rows } = parseCsv(csv);
    const mapping = detectMapping(headers).mapping!;
    const { valid, errors } = validateRows(mapRows(rows, mapping));
    expect(errors).toEqual([]);
    expect(valid).toEqual([
      { rowNo: 2, name: 'Rahim Uddin', registrationNo: '1234567890', classRoll: 15 },
      { rowNo: 3, name: 'Karim Ali', registrationNo: '1234567891', classRoll: 16 },
    ]);
  });
  it('rejects bad rows with sheet row numbers (header is row 1)', () => {
    const { valid, errors } = validateRows([
      { name: 'A', registrationNo: '1234567890', classRoll: '5' },
      { name: 'Good Name', registrationNo: 'x', classRoll: '5' },
      { name: 'Good Name', registrationNo: '1234567891', classRoll: 'abc' },
      { name: 'Good Name', registrationNo: '1234567892', classRoll: '0' },
    ]);
    expect(valid).toHaveLength(0);
    expect(errors.map((e) => e.rowNo)).toEqual([2, 3, 4, 5]);
  });
  it('flags duplicates inside the file and keeps the clean rows', () => {
    const { valid, errors } = validateRows([
      { name: 'Student One', registrationNo: '1000000001', classRoll: '1' },
      { name: 'Student Two', registrationNo: '1000000001', classRoll: '2' },
      { name: 'Student Three', registrationNo: '1000000003', classRoll: '3' },
      { name: 'Student Four', registrationNo: '1000000004', classRoll: '3' },
      { name: 'Student Five', registrationNo: '1000000005', classRoll: '5' },
    ]);
    expect(valid.map((v) => v.registrationNo)).toEqual(['1000000005']);
    expect(errors.some((e) => /more than once/.test(e.message))).toBe(true);
  });
});
