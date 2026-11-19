/** Pure routine rules: time checks, clash detection, change summary. No database access. */
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export interface Slot {
  day: number;
  startTime: string;
  endTime: string;
  offeringId: string;
  teacherId?: string | null;
  room?: string;
}
export interface Conflict {
  kind: 'section' | 'teacher' | 'room';
  message: string;
}

export function toMinutes(t: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** What is wrong with a single slot, if anything. */
export function slotProblem(s: Slot): string | null {
  if (!Number.isInteger(s.day) || s.day < 0 || s.day > 6) return 'Day must be Sunday to Saturday';
  const a = toMinutes(s.startTime);
  const b = toMinutes(s.endTime);
  if (a === null || b === null) return 'Times must look like 09:30';
  if (b <= a) return 'A class must end after it starts';
  return null;
}

function overlap(a: Slot, b: Slot): boolean {
  if (a.day !== b.day) return false;
  return toMinutes(a.startTime)! < toMinutes(b.endTime)! && toMinutes(b.startTime)! < toMinutes(a.endTime)!;
}
const when = (s: Slot) => `${DAY_NAMES[s.day]} ${s.startTime}-${s.endTime}`;
const sameRoom = (a?: string, b?: string) => !!a?.trim() && !!b?.trim() && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Clashes inside one section's routine (two classes at once) and against other published routines
 * (the same teacher or room used twice at the same time).
 */
export function findConflicts(entries: Slot[], others: Array<Slot & { label: string }>): Conflict[] {
  const out: Conflict[] = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (overlap(entries[i]!, entries[j]!)) out.push({ kind: 'section', message: `Two classes overlap on ${when(entries[i]!)}` });
    }
  }
  for (const e of entries) {
    for (const o of others) {
      if (!overlap(e, o)) continue;
      if (e.teacherId && e.teacherId === o.teacherId) out.push({ kind: 'teacher', message: `The teacher is already teaching ${o.label} on ${when(e)}` });
      if (sameRoom(e.room, o.room)) out.push({ kind: 'room', message: `Room ${e.room} is used by ${o.label} on ${when(e)}` });
    }
  }
  return out;
}

const key = (s: Slot) => [s.day, s.startTime, s.endTime, s.offeringId, s.teacherId ?? '', (s.room ?? '').trim().toLowerCase()].join('|');

/** A short human summary of what changed between two versions. */
export function diffEntries(prev: Slot[] | null, next: Slot[]): string[] {
  if (!prev) return [`First published routine with ${next.length} class(es)`];
  const a = new Set(prev.map(key));
  const b = new Set(next.map(key));
  const added = [...b].filter((k) => !a.has(k)).length;
  const removed = [...a].filter((k) => !b.has(k)).length;
  const lines: string[] = [];
  if (added) lines.push(`${added} class(es) added or changed`);
  if (removed) lines.push(`${removed} class(es) removed or changed`);
  return lines.length ? lines : ['No change in classes'];
}
