/** Pure syllabus rules: cleaning, change summary, reading the AI's answer. No database, no network. */
import { z } from 'zod';

export interface Topic {
  title: string;
  subtopics: string[];
}
export interface SyllabusBody {
  objectives: string[];
  topics: Topic[];
}

const tidy = (s: unknown, max: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Trims text, drops empty lines and repeated lines, and applies sane limits. */
export function cleanSyllabus(input: { objectives?: unknown; topics?: unknown }): SyllabusBody {
  const lines = (v: unknown, n: number, max: number) => {
    const out: string[] = [];
    for (const x of Array.isArray(v) ? v : []) {
      const t = tidy(x, max);
      if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
      if (out.length >= n) break;
    }
    return out;
  };
  const topics: Topic[] = [];
  for (const t of Array.isArray(input.topics) ? input.topics : []) {
    const title = tidy((t as { title?: unknown })?.title, 200);
    if (!title) continue;
    topics.push({ title, subtopics: lines((t as { subtopics?: unknown })?.subtopics, 60, 300) });
    if (topics.length >= 100) break;
  }
  return { objectives: lines(input.objectives, 30, 300), topics };
}

const norm = (s: string) => s.toLowerCase();

/** A short human summary of what changed between two versions. */
export function diffSyllabus(prev: SyllabusBody | null, next: SyllabusBody): string[] {
  if (!prev) return [`First published syllabus: ${next.topics.length} topic(s), ${next.objectives.length} objective(s)`];
  const before = new Map(prev.topics.map((t) => [norm(t.title), t]));
  const after = new Map(next.topics.map((t) => [norm(t.title), t]));
  const added = [...after.keys()].filter((k) => !before.has(k)).length;
  const removed = [...before.keys()].filter((k) => !after.has(k)).length;
  let sub = 0;
  for (const [k, t] of after) {
    const old = before.get(k);
    if (!old) continue;
    const a = new Set(old.subtopics.map(norm));
    const b = new Set(t.subtopics.map(norm));
    sub += [...b].filter((x) => !a.has(x)).length + [...a].filter((x) => !b.has(x)).length;
  }
  const o1 = new Set(prev.objectives.map(norm));
  const o2 = new Set(next.objectives.map(norm));
  const obj = [...o2].filter((x) => !o1.has(x)).length + [...o1].filter((x) => !o2.has(x)).length;
  const lines: string[] = [];
  if (added) lines.push(`${added} topic(s) added`);
  if (removed) lines.push(`${removed} topic(s) removed`);
  if (sub) lines.push(`${sub} subtopic(s) changed`);
  if (obj) lines.push(`${obj} objective(s) changed`);
  return lines.length ? lines : ['No change'];
}

const aiSchema = z.object({
  objectives: z.array(z.string()).max(60).optional(),
  topics: z.array(z.object({ title: z.string(), subtopics: z.array(z.string()).optional() })).max(300),
  notes: z.string().optional(),
});

/** Reads the AI's JSON (code fences allowed). Throws if it is not the expected shape. */
export function parseSyllabusJson(text: string): { body: SyllabusBody; notes: string } {
  const raw = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const p = aiSchema.parse(JSON.parse(raw));
  return { body: cleanSyllabus({ objectives: p.objectives ?? [], topics: p.topics }), notes: p.notes ?? '' };
}

export function buildSyllabusPrompt(course: { code: string; name: string }): string {
  return [
    `You read the syllabus of the course "${course.code} ${course.name}" from the attached PDF or image.`,
    'Answer with ONLY this JSON and nothing else:',
    '{"objectives":["..."],"topics":[{"title":"Chapter or unit title","subtopics":["..."]}],"notes":""}',
    'Rules:',
    '- "objectives" are the learning objectives or course aims, if the file lists any. Use [] if there are none.',
    '- One entry in "topics" for each chapter, unit or main topic, in the order of the file. Put its listed sub-points in "subtopics".',
    '- If the file has several courses, read only this one. If you cannot find it, return empty lists and explain in "notes".',
    '- Copy the wording of the file. Do not add topics that are not in it. Put anything unclear in "notes".',
  ].join('\n');
}
