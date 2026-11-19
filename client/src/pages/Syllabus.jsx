import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../services/api';

const Err = ({ e }) => (e ? <p role="alert" className="mt-2 rounded bg-error px-2 py-1 text-sm font-semibold text-error-content">{e.message}</p> : null);
const lines = (a) => a.join('\n');

function Editor({ course, data, onChange }) {
  const start = data.draft ?? data.published ?? { objectives: [], topics: [] };
  const [obj, setObj] = useState(lines(start.objectives));
  const [topics, setTopics] = useState(start.topics.map((t) => ({ title: t.title, sub: lines(t.subtopics) })));
  const [dirty, setDirty] = useState(!!data.draft);
  const [file, setFile] = useState(null);
  const [notes, setNotes] = useState('');
  const payload = () => ({ courseId: course._id, objectives: obj.split('\n'), topics: topics.map((t) => ({ title: t.title, subtopics: t.sub.split('\n') })) });
  const edit = (fn) => { fn(); setDirty(true); };

  const save = useMutation({ mutationFn: () => apiFetch('/syllabus/draft', { method: 'PUT', body: payload() }), onSuccess: () => { setDirty(false); onChange(); } });
  const publish = useMutation({
    mutationFn: async () => { await apiFetch('/syllabus/draft', { method: 'PUT', body: payload() }); return apiFetch('/syllabus/publish', { method: 'POST', body: { courseId: course._id } }); },
    onSuccess: () => { setDirty(false); onChange(); },
  });
  const restore = useMutation({ mutationFn: (versionId) => apiFetch('/syllabus/restore', { method: 'POST', body: { versionId } }), onSuccess: onChange });
  const read = useMutation({
    mutationFn: () => { const fd = new FormData(); fd.append('courseId', course._id); fd.append('file', file); return apiFetch('/syllabus/import', { method: 'POST', body: fd }); },
    onSuccess: (r) => {
      if ((obj.trim() || topics.length) && !window.confirm('This replaces what you have written here. Continue?')) return;
      setObj(lines(r.objectives)); setTopics(r.topics.map((t) => ({ title: t.title, sub: lines(t.subtopics) }))); setNotes(r.notes || ''); setDirty(true);
    },
  });
  const upd = (i, patch) => edit(() => setTopics(topics.map((t, j) => (j === i ? { ...t, ...patch } : t))));

  return (
    <div className="space-y-4">
      <div className="ros-card p-5">
        <h3 className="font-bold">Upload the syllabus (PDF or photo)</h3>
        <p className="mt-1 text-sm opacity-70">The AI reads the topics for you. Check them below, then save and publish. It can make mistakes.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input aria-label="Syllabus file" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/*" className="file-input file-input-bordered file-input-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <button className="btn btn-secondary btn-sm" disabled={!file || read.isPending} onClick={() => read.mutate()}>{read.isPending ? 'Reading… this can take a minute' : 'Read the syllabus'}</button>
        </div>
        <Err e={read.error} />
        {notes && <p className="mt-2 text-sm opacity-75">Note from the AI: {notes}</p>}
      </div>

      <div className="ros-card p-5">
        <label className="font-bold" htmlFor="obj">Objectives <span className="font-normal opacity-70">(one per line, optional)</span></label>
        <textarea id="obj" className="textarea textarea-bordered mt-2 w-full" rows={3} value={obj} onChange={(e) => edit(() => setObj(e.target.value))} />
      </div>

      <div className="space-y-3">
        {topics.map((t, i) => (
          <div key={i} className="ros-card p-4">
            <div className="flex items-center gap-2">
              <input aria-label={`Topic ${i + 1} title`} className="input input-bordered input-sm w-full font-semibold" placeholder="Topic or unit title" value={t.title} onChange={(e) => upd(i, { title: e.target.value })} />
              <button className="btn btn-ghost btn-xs" onClick={() => edit(() => setTopics(topics.filter((_, j) => j !== i)))}>Remove</button>
            </div>
            <textarea aria-label={`Topic ${i + 1} subtopics`} className="textarea textarea-bordered mt-2 w-full text-sm" rows={Math.max(2, t.sub.split('\n').length)} placeholder="Subtopics, one per line" value={t.sub} onChange={(e) => upd(i, { sub: e.target.value })} />
          </div>
        ))}
        <button className="btn btn-ghost btn-sm" onClick={() => edit(() => setTopics([...topics, { title: '', sub: '' }]))}>+ Add a topic</button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-secondary btn-sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>Save draft</button>
        <button className="btn btn-primary btn-sm" disabled={!topics.some((t) => t.title.trim()) || publish.isPending} onClick={() => publish.mutate()}>Publish to students</button>
        {dirty && <span className="text-sm opacity-75">Unsaved changes</span>}
      </div>
      <Err e={save.error} /><Err e={publish.error} /><Err e={restore.error} />

      {data.history.length > 0 && (
        <div className="ros-card p-5">
          <h3 className="font-bold">Earlier versions</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {data.history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-2">
                <span>Version {h.versionNo}{h.status === 'published' ? ' (live)' : ''} · {h.publishedAt ? new Date(h.publishedAt).toLocaleDateString() : ''} · {h.changelog.join('; ')}</span>
                {h.status !== 'published' && <button className="btn btn-ghost btn-xs" disabled={restore.isPending} onClick={() => restore.mutate(h.id)}>Restore as draft</button>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function Syllabus() {
  const qc = useQueryClient();
  const { data: programs = [] } = useQuery({ queryKey: ['programs'], queryFn: () => apiFetch('/academic/programs?limit=100') });
  const [programId, setProgramId] = useState('');
  const [sem, setSem] = useState('');
  const [picked, setPicked] = useState('');
  const program = programs.find((p) => p._id === programId) ?? programs[0];
  const { data: courses = [] } = useQuery({ queryKey: ['courses', program?._id, sem], enabled: !!program, queryFn: () => apiFetch(`/courses?programId=${program._id}&limit=200${sem ? `&semesterNumber=${sem}` : ''}`) });
  const course = courses.find((c) => c._id === picked) ?? courses[0];
  const { data } = useQuery({ queryKey: ['syllabus', course?._id], enabled: !!course, queryFn: () => apiFetch(`/syllabus?courseId=${course._id}`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['syllabus'] });

  return (
    <section aria-labelledby="sy-title" className="space-y-6">
      <div>
        <h1 id="sy-title" className="text-3xl font-extrabold tracking-tight">Syllabus</h1>
        <p className="mt-1 max-w-prose opacity-75">One syllabus per course, shared by every batch that studies it. Students see it only after you publish.</p>
      </div>
      {program && (
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Program" className="select select-bordered select-sm" value={program._id} onChange={(e) => { setProgramId(e.target.value); setPicked(''); }}>{programs.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}</select>
          <select aria-label="Semester" className="select select-bordered select-sm" value={sem} onChange={(e) => { setSem(e.target.value); setPicked(''); }}>
            <option value="">All semesters</option>{Array.from({ length: program.semesterCount }, (_, i) => i + 1).map((n) => <option key={n} value={n}>Semester {n}</option>)}
          </select>
          <select aria-label="Course" className="select select-bordered select-sm max-w-sm" value={course?._id ?? ''} onChange={(e) => setPicked(e.target.value)}>{courses.map((c) => <option key={c._id} value={c._id}>{c.code} · {c.name}</option>)}</select>
        </div>
      )}
      {!course && <p className="ros-card p-5">Add courses first (Courses page).</p>}
      {course && data && (
        <>
          <p className="text-sm">{data.published ? `Live for students: version ${data.published.versionNo}.` : 'Not published yet. Students see nothing.'}{data.draft && data.published ? ' You have unpublished changes.' : ''}</p>
          <Editor key={`${course._id}:${data.published?.versionNo ?? 0}:${data.draft ? 'd' : 'p'}`} course={course} data={data} onChange={refresh} />
        </>
      )}
    </section>
  );
}
