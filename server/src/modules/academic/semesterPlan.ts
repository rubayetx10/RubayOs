/** Semester numbers 1..count grouped two per academic year (1-2 = year 1, 3-4 = year 2, ...). */
export function planSemesters(count: number): Array<{ number: number; yearNo: number }> {
  if (!Number.isInteger(count) || count < 1) throw new Error('Semester count must be a positive integer');
  return Array.from({ length: count }, (_, i) => ({ number: i + 1, yearNo: Math.ceil((i + 1) / 2) }));
}
