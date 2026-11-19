import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../services/api';

const Err = ({ e }) => (e ? <p role="alert" className="mt-2 rounded bg-error px-2 py-1 text-sm font-semibold text-error-content">{e.message}</p> : null);
const TYPES = ['theory', 'lab', 'elective'];
const STATUS = ['published', 'draft', 'archived'];

function useRefresh() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['courses'] });
}

function AddCourse({ program }) {
  const refresh = useRefresh();
  const empty = { code: '', name: '', credit: '3', semesterNumber: '1', type: 'theory' };
  const [v, setV] = useState(empty);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const add = useMutation({
    mutationFn: () => apiFetch('/courses', { method: 'POST', body: { programId: program._id, code: v.code.trim(), name: v.name.trim(), credit: Number(v.credit), semesterNumber: Number(v.semesterNumber), type: v.type } }),
    onSuccess: () => { setV({ ...empty, semesterNumber: v.semesterNumber }); refresh(); },
  });
  return (
    <div className="ros-card p-5">
      <h2 className="font-bold">Add a course</h2>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input aria-label="Course code" className="input input-bordered input-sm w-28" placeholder="Code" value={v.code} onChange={set('code')} />
        <input aria-label="Course name" className="input input-bordered input-sm w-64" placeholder="Course name" value={v.name} onChange={set('name')} />
        <input aria-label="Credit" type="number" step="0.5" min="0.5" className="input input-bordered input-sm w-20" value={v.credit} onChange={set('credit')} />
        <select aria-label="Semester" className="select select-bordered select-sm" value={v.semesterNumber} onChange={set('semesterNumber')}>
          {Array.from({ length: program.semesterCount }, (_, i) => i + 1).map((n) => <option key={n} value={n}>Semester {n}</option>)}
        </select>
        <select aria-label="Type" className="select select-bordered select-sm" value={v.type} onChange={set('type')}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select>
        <button className="btn btn-primary btn-sm" disabled={add.isPending || !v.code.trim() || !v.name.trim()} onClick={() => add.mutate()}>Add</button>
      </div>
      <Err e={add.error} />
    </div>
  );
}

function ImportCourses({ program }) {
  const refresh = useRefresh();
  const [csv, setCsv] = useState('');
  const [file, setFile] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const run = useMutation({
    mutationFn: (dryRun) => apiFetch('/courses/import', { method: 'POST', body: { programId: program._id, csv, dryRun } }),
    onMutate: () => setError(''),
    onSuccess: (d) => { setResult(d); if (!d.dryRun) refresh(); },
    onError: (e) => setError(e.details?.missing ? `Missing column(s): ${e.details.missing.join(', ')}. Columns found: ${e.details.headers.join(', ')}` : e.message),
  });
  return (
    <div className="ros-card p-5">
      <h2 className="font-bold">Import from a file</h2>
      <p className="mt-1 text-sm opacity-70">CSV with columns for code, name, credit and semester (type is optional). From Excel or Google Sheets: Save as / Download as CSV. A code that already exists is updated.</p>
      <input aria-label="CSV file" type="file" accept=".csv,text/csv" className="file-input file-input-bordered file-input-sm mt-3 block w-full max-w-md" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setResult(null); setError(''); setFile(f.name); setCsv(await f.text()); } }} />
      <div className="mt-3 flex gap-2">
        <button className="btn btn-secondary btn-sm" disabled={!csv || run.isPending} onClick={() => run.mutate(true)}>Preview</button>
        <button className="btn btn-primary btn-sm" disabled={!result?.dryRun || result.created + result.updated === 0 || run.isPending} onClick={() => run.mutate(false)}>Import</button>
      </div>
      {error && <p role="alert" className="mt-3 rounded bg-error px-2 py-1 text-sm font-semibold text-error-content">{error}</p>}
      {result && (
        <div className="mt-3 text-sm" role="status">
          <p className="font-semibold">{result.dryRun ? `Preview of ${file}` : 'Imported'}: {result.created} new, {result.updated} updated, {result.errors.length} with problems</p>
          {result.errors.length > 0 && <ul className="mt-2 max-h-48 overflow-auto rounded border border-base-300 p-2">{result.errors.map((x, i) => <li key={i}>Row {x.rowNo}: {x.message}</li>)}</ul>}
        </div>
      )}
    </div>
  );
}

function Row({ c, program }) {
  const refresh = useRefresh();
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState({ name: c.name, credit: c.credit, semesterNumber: c.semesterNumber, type: c.type, status: c.status });
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const save = useMutation({
    mutationFn: () => apiFetch(`/courses/${c._id}`, { method: 'PATCH', body: { name: v.name.trim(), credit: Number(v.credit), semesterNumber: Number(v.semesterNumber), type: v.type, status: v.status } }),
    onSuccess: () => { setEdit(false); refresh(); },
  });
  if (!edit) {
    return (
      <tr className={c.status === 'archived' ? 'opacity-60' : ''}>
        <td>{c.semesterNumber}</td><td className="font-semibold">{c.code}</td><td>{c.name}</td><td>{c.credit}</td><td>{c.type}</td>
        <td>{c.status !== 'published' && <span className="badge badge-warning">{c.status}</span>}</td>
        <td><button className="btn btn-ghost btn-xs" onClick={() => setEdit(true)}>Edit</button></td>
      </tr>
    );
  }
  return (
    <tr>
      <td><select aria-label="Semester" className="select select-bordered select-xs" value={v.semesterNumber} onChange={set('semesterNumber')}>{Array.from({ length: program.semesterCount }, (_, i) => i + 1).map((n) => <option key={n}>{n}</option>)}</select></td>
      <td className="font-semibold">{c.code}</td>
      <td><input aria-label="Name" className="input input-bordered input-xs w-full min-w-40" value={v.name} onChange={set('name')} /></td>
      <td><input aria-label="Credit" type="number" step="0.5" className="input input-bordered input-xs w-16" value={v.credit} onChange={set('credit')} /></td>
      <td><select aria-label="Type" className="select select-bordered select-xs" value={v.type} onChange={set('type')}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select></td>
      <td><select aria-label="Status" className="select select-bordered select-xs" value={v.status} onChange={set('status')}>{STATUS.map((t) => <option key={t}>{t}</option>)}</select></td>
      <td className="whitespace-nowrap">
        <button className="btn btn-primary btn-xs" disabled={save.isPending} onClick={() => save.mutate()}>Save</button>
        <button className="btn btn-ghost btn-xs" onClick={() => setEdit(false)}>Cancel</button>
        <Err e={save.error} />
      </td>
    </tr>
  );
}

export default function Courses() {
  const { data: programs = [] } = useQuery({ queryKey: ['programs'], queryFn: () => apiFetch('/academic/programs?limit=100') });
  const [programId, setProgramId] = useState('');
  const [sem, setSem] = useState('');
  const program = programs.find((p) => p._id === programId) ?? programs[0];
  const { data: courses = [], isLoading } = useQuery({
    queryKey: ['courses', program?._id, sem],
    enabled: !!program,
    queryFn: () => apiFetch(`/courses?programId=${program._id}&limit=200${sem ? `&semesterNumber=${sem}` : ''}`),
  });
  return (
    <section aria-labelledby="co-title" className="space-y-6">
      <div>
        <h1 id="co-title" className="text-3xl font-extrabold tracking-tight">Courses</h1>
        <p className="mt-1 max-w-prose opacity-75">The courses of a program, by semester. You type them in or import a file, so the codes and credits are exactly your college’s.</p>
      </div>
      {program && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Program" className="select select-bordered select-sm" value={program._id} onChange={(e) => setProgramId(e.target.value)}>{programs.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}</select>
            <select aria-label="Show semester" className="select select-bordered select-sm" value={sem} onChange={(e) => setSem(e.target.value)}>
              <option value="">All semesters</option>
              {Array.from({ length: program.semesterCount }, (_, i) => i + 1).map((n) => <option key={n} value={n}>Semester {n}</option>)}
            </select>
          </div>
          <AddCourse program={program} />
          <ImportCourses program={program} />
          <div className="ros-card overflow-x-auto p-5">
            <h2 className="font-bold">{courses.length} course(s)</h2>
            <table className="table table-sm mt-2">
              <thead><tr><th>Sem</th><th>Code</th><th>Name</th><th>Credit</th><th>Type</th><th>Status</th><th /></tr></thead>
              <tbody>
                {courses.map((c) => <Row key={c._id} c={c} program={program} />)}
                {!isLoading && courses.length === 0 && <tr><td colSpan="7" className="opacity-70">No courses yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
