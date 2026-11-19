import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAcademic } from '../context/AcademicContext';
import { apiFetch } from '../services/api';

export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const Err = ({ e }) => (e ? <p role="alert" className="mt-2 rounded bg-error px-2 py-1 text-sm font-semibold text-error-content">{e.message}{Array.isArray(e.details) && <ul className="mt-1 list-disc pl-5 font-normal">{e.details.map((d, i) => <li key={i}>{d.message}</li>)}</ul>}</p> : null);
const order = (a, b) => a.day - b.day || a.startTime.localeCompare(b.startTime);

const usable = (r) => r.day !== null && r.startTime && r.endTime && r.startTime < r.endTime && r.offeringId;

/** The rows the AI read. Nothing here is saved or shown to students until an admin uses them and publishes. */
function Review({ result, offerings, hasWork, onUse, onCancel }) {
  const [rows, setRows] = useState(() => result.rows.map((r) => ({ ...r, include: !r.otherSection && r.problems.length === 0 })));
  const upd = (i, patch) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const ready = rows.filter((r) => r.include && usable(r));
  const use = () => {
    if (hasWork && !window.confirm('This replaces the classes you are editing now. Continue?')) return;
    onUse(ready.map((r) => {
      const o = offerings.find((x) => x.id === r.offeringId);
      const teacherId = o?.teachers.some((t) => t.id === r.teacherId) ? r.teacherId : o?.teachers[0]?.id ?? null;
      return { day: r.day, startTime: r.startTime, endTime: r.endTime, offeringId: r.offeringId, teacherId, room: r.room };
    }));
  };
  return (
    <div className="mt-4">
      <p className="text-sm font-semibold">The AI read {rows.length} class(es) from {result.fileName}. It can make mistakes, so check each row against your sheet.</p>
      {result.notes && <p className="mt-1 text-sm opacity-75">Note from the AI: {result.notes}</p>}
      <div className="mt-2 max-h-96 overflow-auto">
        <table className="table table-xs">
          <thead><tr><th>Use</th><th>Day</th><th>Start</th><th>End</th><th>Course</th><th>Room</th><th>Sheet says</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={!usable(r) ? 'bg-warning/30' : r.otherSection ? 'opacity-60' : ''}>
                <td><input type="checkbox" aria-label="Use this class" checked={r.include} onChange={(e) => upd(i, { include: e.target.checked })} /></td>
                <td><select aria-label="Day" className="select select-bordered select-xs" value={r.day ?? ''} onChange={(e) => upd(i, { day: e.target.value === '' ? null : Number(e.target.value) })}><option value="">?</option>{DAYS.map((d, k) => <option key={d} value={k}>{d}</option>)}</select></td>
                <td><input aria-label="Starts" type="time" className="input input-bordered input-xs" value={r.startTime ?? ''} onChange={(e) => upd(i, { startTime: e.target.value || null })} /></td>
                <td><input aria-label="Ends" type="time" className="input input-bordered input-xs" value={r.endTime ?? ''} onChange={(e) => upd(i, { endTime: e.target.value || null })} /></td>
                <td><select aria-label="Course" className="select select-bordered select-xs max-w-44" value={r.offeringId ?? ''} onChange={(e) => upd(i, { offeringId: e.target.value || null, teacherId: null })}><option value="">Choose…</option>{offerings.map((o) => <option key={o.id} value={o.id}>{o.course?.code} · {o.course?.name}</option>)}</select></td>
                <td><input aria-label="Room" className="input input-bordered input-xs w-20" value={r.room} onChange={(e) => upd(i, { room: e.target.value })} /></td>
                <td className="text-xs">{[r.sheet.courseCode, r.sheet.courseName, r.sheet.teacher, r.sheet.section && `section ${r.sheet.section}`].filter(Boolean).join(' · ')}{r.otherSection && <span className="badge badge-ghost ml-1">other section</span>}{r.problems.length > 0 && <div className="font-semibold">{r.problems.join('. ')}</div>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className="btn btn-primary btn-sm" disabled={ready.length === 0} onClick={use}>Use {ready.length} class(es) as my draft</button>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>Discard</button>
        <span className="text-xs opacity-70">Next you can still edit, then save and publish. Rows missing a day, time or course cannot be used until you fill them in.</span>
      </div>
    </div>
  );
}

function UploadCard({ scope, offerings, hasWork, onUse }) {
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const read = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      Object.entries(scope).forEach(([k, v]) => fd.append(k, v));
      fd.append('file', file);
      return apiFetch('/routines/import', { method: 'POST', body: fd });
    },
    onMutate: () => setResult(null),
    onSuccess: setResult,
  });
  return (
    <div className="ros-card p-5">
      <h3 className="font-bold">Upload a routine (PDF or photo)</h3>
      <p className="mt-1 text-sm opacity-70">Skip the typing. The AI reads the file and you only check it. Works best with a clear PDF. Courses must exist on the “This semester” page first so it can match them.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input aria-label="Routine file" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/*" className="file-input file-input-bordered file-input-sm" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); }} />
        <button className="btn btn-secondary btn-sm" disabled={!file || read.isPending || offerings.length === 0} onClick={() => read.mutate()}>{read.isPending ? 'Reading… this can take a minute' : 'Read the routine'}</button>
      </div>
      <Err e={read.error} />
      {result && <Review result={result} offerings={offerings} hasWork={hasWork} onUse={(rows) => { setResult(null); onUse(rows); }} onCancel={() => setResult(null)} />}
    </div>
  );
}

function Editor({ data, offerings, scope, onChange, seed }) {
  const [rows, setRows] = useState(seed ?? data.draft?.entries ?? data.published?.entries ?? []);
  const [dirty, setDirty] = useState(!!seed || !!data.draft);
  const [f, setF] = useState({ day: 0, startTime: '09:00', endTime: '10:00', offeringId: '', teacherId: '', room: '' });
  const [warn, setWarn] = useState([]);
  const label = Object.fromEntries(offerings.map((o) => [o.id, `${o.course?.code} · ${o.course?.name}`]));
  const picked = offerings.find((o) => o.id === (f.offeringId || offerings[0]?.id));
  const edit = (next) => { setRows(next); setDirty(true); };

  const save = useMutation({ mutationFn: () => apiFetch('/routines/draft', { method: 'PUT', body: { ...scope, entries: rows } }), onSuccess: (r) => { setWarn(r.conflicts); setDirty(false); onChange(); } });
  const publish = useMutation({
    mutationFn: async () => { await apiFetch('/routines/draft', { method: 'PUT', body: { ...scope, entries: rows } }); return apiFetch('/routines/publish', { method: 'POST', body: scope }); },
    onSuccess: () => { setDirty(false); setWarn([]); onChange(); },
  });
  const add = () => {
    if (!picked) return;
    edit([...rows, { day: Number(f.day), startTime: f.startTime, endTime: f.endTime, offeringId: picked.id, teacherId: f.teacherId || picked.teachers[0]?.id || null, room: f.room.trim() }]);
  };

  return (
    <div className="space-y-4">
      <div className="ros-card p-5">
        <h3 className="font-bold">Add a class</h3>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select aria-label="Day" className="select select-bordered select-sm" value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select>
          <input aria-label="Starts" type="time" className="input input-bordered input-sm" value={f.startTime} onChange={(e) => setF({ ...f, startTime: e.target.value })} />
          <input aria-label="Ends" type="time" className="input input-bordered input-sm" value={f.endTime} onChange={(e) => setF({ ...f, endTime: e.target.value })} />
          <select aria-label="Course" className="select select-bordered select-sm max-w-xs" value={picked?.id ?? ''} onChange={(e) => setF({ ...f, offeringId: e.target.value, teacherId: '' })}>{offerings.map((o) => <option key={o.id} value={o.id}>{label[o.id]}</option>)}</select>
          {picked && picked.teachers.length > 1 && <select aria-label="Teacher" className="select select-bordered select-sm" value={f.teacherId} onChange={(e) => setF({ ...f, teacherId: e.target.value })}>{picked.teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>}
          <input aria-label="Room" className="input input-bordered input-sm w-28" placeholder="Room" value={f.room} onChange={(e) => setF({ ...f, room: e.target.value })} />
          <button className="btn btn-secondary btn-sm" disabled={!picked} onClick={add}>Add</button>
        </div>
        {offerings.length === 0 && <p className="mt-2 text-sm opacity-75">No courses this semester yet. Create them on the “This semester” page first.</p>}
      </div>

      <div className="ros-card overflow-x-auto p-5">
        <table className="table table-sm">
          <thead><tr><th>Day</th><th>Time</th><th>Course</th><th>Teacher</th><th>Room</th><th /></tr></thead>
          <tbody>
            {[...rows].sort(order).map((r) => (
              <tr key={`${r.day}${r.startTime}${r.offeringId}${r.room}`}>
                <td>{DAYS[r.day]}</td><td>{r.startTime}–{r.endTime}</td><td>{label[r.offeringId] ?? '?'}</td>
                <td>{offerings.find((o) => o.id === r.offeringId)?.teachers.find((t) => t.id === r.teacherId)?.name ?? ''}</td>
                <td>{r.room}</td>
                <td><button className="btn btn-ghost btn-xs" onClick={() => edit(rows.filter((x) => x !== r))}>Remove</button></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan="6" className="opacity-70">No classes yet.</td></tr>}
          </tbody>
        </table>
        {warn.length > 0 && <ul className="mt-3 list-disc rounded bg-warning px-6 py-2 text-sm text-warning-content">{warn.map((w, i) => <li key={i}>{w.message}</li>)}</ul>}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button className="btn btn-secondary btn-sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>Save draft</button>
          <button className="btn btn-primary btn-sm" disabled={rows.length === 0 || publish.isPending} onClick={() => publish.mutate()}>Publish to students</button>
          {dirty && <span className="text-sm opacity-75">Unsaved changes</span>}
        </div>
        <Err e={save.error} /><Err e={publish.error} />
      </div>
    </div>
  );
}

export default function Routine() {
  const qc = useQueryClient();
  const { cohortId, semesterId, semesters } = useAcademic();
  const semester = semesters.find((s) => s._id === semesterId);
  const [picked, setPicked] = useState('');
  const [seed, setSeed] = useState({ n: 0, rows: null, sectionId: null });
  const { data: sections = [] } = useQuery({ queryKey: ['routine-sections', semesterId], enabled: !!semesterId, queryFn: () => apiFetch(`/academic/sections?semesterId=${semesterId}&limit=50`) });
  const sectionId = sections.some((s) => s._id === picked) ? picked : sections[0]?._id;
  const scope = { cohortId, semesterId, sectionId };
  const { data: offerings = [] } = useQuery({ queryKey: ['offerings', cohortId, semesterId], enabled: !!semesterId, queryFn: () => apiFetch(`/offerings?cohortId=${cohortId}&semesterId=${semesterId}`) });
  const { data } = useQuery({ queryKey: ['routine', cohortId, semesterId, sectionId], enabled: !!sectionId, queryFn: () => apiFetch(`/routines?${new URLSearchParams(scope)}`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['routine'] });
  const restore = useMutation({ mutationFn: (versionId) => apiFetch('/routines/restore', { method: 'POST', body: { versionId } }), onSuccess: refresh });

  return (
    <section aria-labelledby="rt-title" className="space-y-6">
      <div>
        <h1 id="rt-title" className="text-3xl font-extrabold tracking-tight">Class routine{semester ? ` (semester ${semester.number})` : ''}</h1>
        <p className="mt-1 max-w-prose opacity-75">One weekly routine per section. Upload a PDF or photo, or add classes by hand. Save a draft as you work. Students see it only after you publish. Choose the batch and semester at the top.</p>
      </div>
      {sections.length === 0 ? <p className="ros-card p-5">Add a section for this semester first (Sections page).</p> : (
        <>
          <label className="flex items-center gap-2 font-semibold">Section
            <select className="select select-bordered select-sm" value={sectionId} onChange={(e) => setPicked(e.target.value)}>{sections.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}</select>
          </label>
          {data && (
            <>
              <p className="text-sm">{data.published ? `Live for students: version ${data.published.versionNo}.` : 'Not published yet. Students see nothing.'}{data.draft && data.published ? ' You have unpublished changes.' : ''}</p>
              <UploadCard scope={scope} offerings={offerings} hasWork={!!data.draft || !!data.published} onUse={(rows) => setSeed({ n: seed.n + 1, rows, sectionId })} />
              <Editor key={`${sectionId}:${data.published?.versionNo ?? 0}:${data.draft ? 'd' : 'p'}:${seed.n}`} data={data} offerings={offerings} scope={scope} onChange={refresh} seed={seed.sectionId === sectionId ? seed.rows : null} />
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
            </>
          )}
        </>
      )}
    </section>
  );
}
