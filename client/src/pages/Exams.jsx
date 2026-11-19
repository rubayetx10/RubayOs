import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAcademic } from '../context/AcademicContext';
import { apiFetch } from '../services/api';

const Err = ({ e }) => (e ? <p role="alert" className="mt-2 rounded bg-error px-2 py-1 text-sm font-semibold text-error-content">{e.message}{Array.isArray(e.details) && <ul className="mt-1 list-disc pl-5 font-normal">{e.details.map((d, i) => <li key={i}>{d.message}</li>)}</ul>}</p> : null);
const ready = (r) => r.date && r.startTime && r.endTime && r.startTime < r.endTime && r.offeringId;

function Review({ result, offerings, onAdd, onCancel, busy }) {
  const [rows, setRows] = useState(() => result.rows.map((r) => ({ ...r, include: r.problems.length === 0 })));
  const upd = (i, patch) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const ok = rows.filter((r) => r.include && ready(r));
  return (
    <div className="mt-4">
      <p className="text-sm font-semibold">The AI read {rows.length} exam(s) from {result.fileName}. It can make mistakes, so check each row against your sheet.</p>
      {result.notes && <p className="mt-1 text-sm opacity-75">Note from the AI: {result.notes}</p>}
      <div className="mt-2 max-h-96 overflow-auto">
        <table className="table table-xs">
          <thead><tr><th>Use</th><th>Course</th><th>Date</th><th>Start</th><th>End</th><th>Room</th><th>Title</th><th>Sheet says</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={!ready(r) ? 'bg-warning/30' : ''}>
                <td><input type="checkbox" aria-label="Use this exam" checked={r.include} onChange={(e) => upd(i, { include: e.target.checked })} /></td>
                <td><select aria-label="Course" className="select select-bordered select-xs max-w-44" value={r.offeringId ?? ''} onChange={(e) => upd(i, { offeringId: e.target.value || null })}><option value="">Choose…</option>{offerings.map((o) => <option key={o.id} value={o.id}>{o.course?.code} · {o.course?.name}</option>)}</select></td>
                <td><input aria-label="Date" type="date" className="input input-bordered input-xs" value={r.date ?? ''} onChange={(e) => upd(i, { date: e.target.value || null })} /></td>
                <td><input aria-label="Starts" type="time" className="input input-bordered input-xs" value={r.startTime ?? ''} onChange={(e) => upd(i, { startTime: e.target.value || null })} /></td>
                <td><input aria-label="Ends" type="time" className="input input-bordered input-xs" value={r.endTime ?? ''} onChange={(e) => upd(i, { endTime: e.target.value || null })} /></td>
                <td><input aria-label="Room" className="input input-bordered input-xs w-20" value={r.room} onChange={(e) => upd(i, { room: e.target.value })} /></td>
                <td><input aria-label="Title" className="input input-bordered input-xs w-24" value={r.title} onChange={(e) => upd(i, { title: e.target.value })} /></td>
                <td className="text-xs">{[r.sheet.courseCode, r.sheet.courseName].filter(Boolean).join(' · ')}{r.problems.length > 0 && <div className="font-semibold">{r.problems.join('. ')}</div>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className="btn btn-primary btn-sm" disabled={ok.length === 0 || busy} onClick={() => onAdd(ok.map((r) => ({ offeringId: r.offeringId, title: r.title || 'Exam', date: r.date, startTime: r.startTime, endTime: r.endTime, room: r.room })))}>Add {ok.length} exam(s) as drafts</button>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>Discard</button>
        <span className="text-xs opacity-70">Drafts are not shown to students until you publish.</span>
      </div>
    </div>
  );
}

function Row({ e, onDone }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState({ date: e.date, startTime: e.startTime, endTime: e.endTime, room: e.room });
  const save = useMutation({ mutationFn: (body) => apiFetch(`/exams/${e.id}`, { method: 'PATCH', body }), onSuccess: () => { setEdit(false); onDone(); } });
  const set = (k) => (ev) => setV({ ...v, [k]: ev.target.value });
  const badge = e.status === 'published' ? 'badge-success' : e.status === 'cancelled' ? 'badge-error' : 'badge-warning';
  return (
    <tr className={e.status === 'cancelled' ? 'opacity-60' : ''}>
      {edit ? (
        <>
          <td><input aria-label="Date" type="date" className="input input-bordered input-xs" value={v.date} onChange={set('date')} /></td>
          <td><input aria-label="Starts" type="time" className="input input-bordered input-xs" value={v.startTime} onChange={set('startTime')} /> <input aria-label="Ends" type="time" className="input input-bordered input-xs" value={v.endTime} onChange={set('endTime')} /></td>
        </>
      ) : <><td>{e.date}</td><td>{e.startTime}–{e.endTime}</td></>}
      <td>{e.course ? `${e.course.code} · ${e.course.name}` : '?'}<span className="ml-2 text-xs opacity-70">{e.title}</span></td>
      <td>{edit ? <input aria-label="Room" className="input input-bordered input-xs w-20" value={v.room} onChange={set('room')} /> : e.room}</td>
      <td><span className={`badge ${badge}`}>{e.status}</span></td>
      <td className="whitespace-nowrap">
        {edit ? (<><button className="btn btn-primary btn-xs" disabled={save.isPending} onClick={() => save.mutate(v)}>Save</button><button className="btn btn-ghost btn-xs" onClick={() => setEdit(false)}>Cancel</button></>)
          : e.status !== 'cancelled' && (<><button className="btn btn-ghost btn-xs" onClick={() => setEdit(true)}>Edit</button><button className="btn btn-ghost btn-xs" onClick={() => window.confirm('Cancel this exam? Students who saw it will see it as cancelled.') && save.mutate({ status: 'cancelled' })}>Cancel exam</button></>)}
        <Err e={save.error} />
      </td>
    </tr>
  );
}

export default function Exams() {
  const qc = useQueryClient();
  const { cohortId, semesterId, semesters } = useAcademic();
  const semester = semesters.find((s) => s._id === semesterId);
  const scope = { cohortId, semesterId };
  const refresh = () => qc.invalidateQueries({ queryKey: ['exams'] });
  const { data: offerings = [] } = useQuery({ queryKey: ['offerings', cohortId, semesterId], enabled: !!semesterId, queryFn: () => apiFetch(`/offerings?cohortId=${cohortId}&semesterId=${semesterId}`) });
  const { data: events = [] } = useQuery({ queryKey: ['exams', cohortId, semesterId], enabled: !!semesterId, queryFn: () => apiFetch(`/exams?${new URLSearchParams(scope)}`) });

  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const read = useMutation({
    mutationFn: () => { const fd = new FormData(); Object.entries(scope).forEach(([k, v]) => fd.append(k, v)); fd.append('file', file); return apiFetch('/exams/import', { method: 'POST', body: fd }); },
    onMutate: () => setResult(null), onSuccess: setResult,
  });
  const add = useMutation({ mutationFn: (list) => apiFetch('/exams/bulk', { method: 'POST', body: { ...scope, events: list } }), onSuccess: () => { setResult(null); refresh(); } });
  const publish = useMutation({ mutationFn: () => apiFetch('/exams/publish', { method: 'POST', body: scope }), onSuccess: refresh });

  const [f, setF] = useState({ title: 'Exam', offeringId: '', date: '', startTime: '10:00', endTime: '13:00', room: '' });
  const picked = f.offeringId || offerings[0]?.id;
  const drafts = events.filter((e) => e.status === 'draft').length;

  return (
    <section aria-labelledby="ex-title" className="space-y-6">
      <div>
        <h1 id="ex-title" className="text-3xl font-extrabold tracking-tight">Exam routine{semester ? ` (semester ${semester.number})` : ''}</h1>
        <p className="mt-1 max-w-prose opacity-75">Upload the exam schedule or add exams by hand. They stay drafts until you publish. Students see only the exams of their own courses. Choose the batch and semester at the top.</p>
      </div>

      <div className="ros-card p-5">
        <h2 className="font-bold">Upload an exam schedule (PDF or photo)</h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input aria-label="Exam schedule file" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/*" className="file-input file-input-bordered file-input-sm" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); }} />
          <button className="btn btn-secondary btn-sm" disabled={!file || read.isPending || offerings.length === 0} onClick={() => read.mutate()}>{read.isPending ? 'Reading… this can take a minute' : 'Read the schedule'}</button>
        </div>
        {offerings.length === 0 && <p className="mt-2 text-sm opacity-75">Create this semester’s courses first (“This semester” page) so the AI can match them.</p>}
        <Err e={read.error} /><Err e={add.error} />
        {result && <Review result={result} offerings={offerings} busy={add.isPending} onAdd={(list) => add.mutate(list)} onCancel={() => setResult(null)} />}
      </div>

      <div className="ros-card p-5">
        <h2 className="font-bold">Add one exam by hand</h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select aria-label="Course" className="select select-bordered select-sm max-w-xs" value={picked ?? ''} onChange={(e) => setF({ ...f, offeringId: e.target.value })}>{offerings.map((o) => <option key={o.id} value={o.id}>{o.course?.code} · {o.course?.name}</option>)}</select>
          <input aria-label="Title" className="input input-bordered input-sm w-28" placeholder="Mid Term" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          <input aria-label="Date" type="date" className="input input-bordered input-sm" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          <input aria-label="Starts" type="time" className="input input-bordered input-sm" value={f.startTime} onChange={(e) => setF({ ...f, startTime: e.target.value })} />
          <input aria-label="Ends" type="time" className="input input-bordered input-sm" value={f.endTime} onChange={(e) => setF({ ...f, endTime: e.target.value })} />
          <input aria-label="Room" className="input input-bordered input-sm w-24" placeholder="Room" value={f.room} onChange={(e) => setF({ ...f, room: e.target.value })} />
          <button className="btn btn-secondary btn-sm" disabled={!picked || !f.date || add.isPending} onClick={() => add.mutate([{ offeringId: picked, title: f.title || 'Exam', date: f.date, startTime: f.startTime, endTime: f.endTime, room: f.room }])}>Add as draft</button>
        </div>
      </div>

      <div className="ros-card overflow-x-auto p-5">
        <table className="table table-sm">
          <thead><tr><th>Date</th><th>Time</th><th>Course</th><th>Room</th><th>Status</th><th /></tr></thead>
          <tbody>
            {events.map((e) => <Row key={e.id} e={e} onDone={refresh} />)}
            {events.length === 0 && <tr><td colSpan="6" className="opacity-70">No exams yet.</td></tr>}
          </tbody>
        </table>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button className="btn btn-primary btn-sm" disabled={drafts === 0 || publish.isPending} onClick={() => publish.mutate()}>Publish {drafts} draft(s) to students</button>
          <span className="text-sm opacity-75">Clashes (two exams at once, a room used twice) are checked first.</span>
        </div>
        <Err e={publish.error} />
      </div>
    </section>
  );
}
