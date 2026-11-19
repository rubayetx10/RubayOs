import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { buildProposal, matchOffering, normalizeDay, normalizeTime, parseAiJson, pickTeacher, sniffMime, type OfferingOption } from '../src/modules/routines/routine.import';

const offerings: OfferingOption[] = [
  { id: 'o1', code: 'CSE 101', name: 'Introduction to Programming', teachers: [{ id: 't1', name: 'Md. Karim' }] },
  { id: 'o2', code: 'CSE 102', name: 'Programming Lab', teachers: [{ id: 't2', name: 'Rahim Uddin' }, { id: 't3', name: 'Salma Akter' }] },
  { id: 'o3', code: 'MAT 111', name: 'Calculus', teachers: [] },
];

describe('sniffMime (file type from the first bytes)', () => {
  const pad = (b: number[]) => Buffer.from([...b, ...new Array(20).fill(0)]);
  it('knows PDF, PNG, JPEG and WEBP', () => {
    expect(sniffMime(Buffer.from('%PDF-1.7 and more bytes'))).toBe('application/pdf');
    expect(sniffMime(pad([0x89, 0x50, 0x4e, 0x47]))).toBe('image/png');
    expect(sniffMime(pad([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffMime(Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 '))).toBe('image/webp');
  });
  it('refuses everything else, even if named .pdf', () => {
    expect(sniffMime(Buffer.from('MZ\x90\x00 an executable pretending to be a pdf'))).toBeNull();
    expect(sniffMime(Buffer.from('<html><script>alert(1)</script></html>'))).toBeNull();
    expect(sniffMime(Buffer.from('tiny'))).toBeNull();
  });
});

describe('normalizeDay', () => {
  it('reads English, short and Bangla names', () => {
    expect(normalizeDay('Sunday')).toBe(0);
    expect(normalizeDay(' sat. ')).toBe(6);
    expect(normalizeDay('THU')).toBe(4);
    expect(normalizeDay('সোমবার')).toBe(1);
    expect(normalizeDay('বৃহস্পতিবার')).toBe(4);
  });
  it('returns null for nonsense', () => { expect(normalizeDay('Funday')).toBeNull(); expect(normalizeDay(undefined)).toBeNull(); });
});

describe('normalizeTime', () => {
  it('reads common styles', () => {
    expect(normalizeTime('09:30')).toBe('09:30');
    expect(normalizeTime('9:30')).toBe('09:30');
    expect(normalizeTime('9.30')).toBe('09:30');
    expect(normalizeTime('9:30 AM')).toBe('09:30');
    expect(normalizeTime('2pm')).toBe('14:00');
    expect(normalizeTime('12:15 PM')).toBe('12:15');
    expect(normalizeTime('12:15 AM')).toBe('00:15');
    expect(normalizeTime('14:00')).toBe('14:00');
  });
  it('takes 1 to 6 without am or pm as afternoon, and leaves 8 to 12 alone', () => {
    expect(normalizeTime('2:00')).toBe('14:00');
    expect(normalizeTime('8:00')).toBe('08:00');
    expect(normalizeTime('12:00')).toBe('12:00');
  });
  it('rejects impossible times', () => { for (const t of ['25:00', '9:75', 'noon', '', '13 pm']) expect(normalizeTime(t)).toBeNull(); });
});

describe('matchOffering', () => {
  it('matches by code ignoring spaces, dashes and case', () => {
    expect(matchOffering({ courseCode: 'cse-101' }, offerings)).toMatchObject({ by: 'code', offering: { id: 'o1' } });
    expect(matchOffering({ courseCode: 'CSE102' }, offerings)?.offering.id).toBe('o2');
  });
  it('falls back to the name when the code is missing', () => {
    expect(matchOffering({ courseName: 'Intro to Programming' }, offerings)).toBeNull(); // not close enough: no guessing
    expect(matchOffering({ courseName: 'introduction to programming' }, offerings)).toMatchObject({ by: 'name', offering: { id: 'o1' } });
  });
  it('does not guess when a name fits two courses', () => {
    expect(matchOffering({ courseName: 'Programming' }, offerings)).toBeNull();
  });
  it('returns null when nothing matches', () => expect(matchOffering({ courseCode: 'XYZ 999', courseName: 'Unknown' }, offerings)).toBeNull());
});

describe('pickTeacher', () => {
  it('uses the only teacher of the course', () => expect(pickTeacher('someone else', offerings[0]!)).toBe('t1'));
  it('picks between several by name', () => expect(pickTeacher('Salma', offerings[1]!)).toBe('t3'));
  it('leaves it empty when it cannot tell', () => { expect(pickTeacher('', offerings[1]!)).toBeNull(); expect(pickTeacher('Nobody', offerings[1]!)).toBeNull(); });
  it('no teachers gives null', () => expect(pickTeacher('x', offerings[2]!)).toBeNull());
});

describe('parseAiJson', () => {
  it('reads JSON, with or without code fences', () => {
    expect(parseAiJson('{"entries":[{"day":"Sunday"}],"notes":"ok"}').entries).toHaveLength(1);
    expect(parseAiJson('```json\n{"entries":[]}\n```').entries).toEqual([]);
  });
  it('throws on text that is not the expected JSON', () => {
    expect(() => parseAiJson('Sorry, I cannot read this')).toThrow();
    expect(() => parseAiJson('{"rows":[]}')).toThrow();
  });
});

describe('buildProposal', () => {
  const entries = [
    { day: 'Sunday', start: '9:00', end: '10:00', courseCode: 'CSE 101', teacher: 'Karim', room: '301', section: 'A' },
    { day: 'Mon', start: '10:00', end: '9:00', courseCode: 'CSE 102', section: 'Section A' },
    { day: 'Tue', start: '11:00', end: '12:00', courseCode: 'ZZZ 1', courseName: 'Mystery', section: 'B' },
    { day: 'Someday', start: '??', end: '12:00', courseCode: 'MAT 111' },
  ];
  const rows = buildProposal(entries, offerings, 'A');
  it('turns a clean row into a ready row', () => {
    expect(rows[0]).toMatchObject({ day: 0, startTime: '09:00', endTime: '10:00', room: '301', offeringId: 'o1', teacherId: 't1', matchedBy: 'code', otherSection: false, problems: [] });
  });
  it('flags a bad time order', () => expect(rows[1]!.problems).toContain('End time is not after start time'));
  it('flags a course it cannot find and marks other sections', () => {
    expect(rows[2]!.offeringId).toBeNull();
    expect(rows[2]!.problems.join(' ')).toMatch(/Course not found/);
    expect(rows[2]!.otherSection).toBe(true);
  });
  it('treats "Section A" and "A" as the same section', () => expect(rows[1]!.otherSection).toBe(false));
  it('lists every doubt for a broken row', () => expect(rows[3]!.problems).toEqual(['Day not recognised', 'Time not recognised']));
});

describe('routine import API is locked', () => {
  it('needs a login', async () => expect((await request(createApp()).post('/api/v1/routines/import')).status).toBe(401));
});
