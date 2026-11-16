import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAcademic } from '../context/AcademicContext';
import { apiFetch } from '../services/api';

function RollCell({ r }) {
  const qc = useQueryClient();
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState({ roll: r.classRoll, reason: '' });
  const save = useMutation({
    mutationFn: () => apiFetch(`/roster/${r._id}/roll`, { method: 'POST', body: { classRoll: Number(v.roll), reason: v.reason.trim() } }),
    onSuccess: () => {
      setEdit(false);
      ['roster', 'enrollment-overview', 'structure'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
  });
  if (!edit) return <span className="flex items-center gap-2">{r.classRoll}<button className="btn btn-ghost btn-xs" onClick={() => { setV({ roll: r.classRoll, reason: '' }); setEdit(true); }}>Edit roll</button></span>;
  return (
    <span className="flex flex-wrap items-center gap-1">
      <input aria-label="New roll" type="number" min="1" className="input input-bordered input-xs w-20" value={v.roll} onChange={(e) => setV({ ...v, roll: e.target.value })} />
      <input aria-label="Reason" className="input input-bordered input-xs w-44" placeholder="Why? (required)" value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} />
      <button className="btn btn-primary btn-xs" disabled={save.isPending || v.reason.trim().length < 3 || !v.roll} onClick={() => save.mutate()}>Save</button>
      <button className="btn btn-ghost btn-xs" onClick={() => setEdit(false)}>Cancel</button>
      {save.error && <span role="alert" className="w-full rounded bg-error px-2 py-1 text-xs font-semibold text-error-content">{save.error.message}</span>}
    </span>
  );
}

export default function Roster() {
  const qc = useQueryClient();
  const { cohortId, cohorts } = useAcademic();
  const [csv, setCsv] = useState('');
  const [file, setFile] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const { data: list = [] } = useQuery({ queryKey: ['roster', cohortId], enabled: !!cohortId, queryFn: () => apiFetch(`/roster?cohortId=${cohortId}&limit=200`) });
  const run = useMutation({
    mutationFn: (dryRun) => apiFetch('/roster/import', { method: 'POST', body: { cohortId, csv, dryRun } }),
    onMutate: () => setError(''),
    onSuccess: (d) => {
      setResult(d);
      if (!d.dryRun) { qc.invalidateQueries({ queryKey: ['roster'] }); qc.invalidateQueries({ queryKey: ['enrollment-overview'] }); }
    },
    onError: (e) => setError(e.details?.missing ? `Missing column(s): ${e.details.missing.join(', ')}. Columns found: ${e.details.headers.join(', ')}` : e.message),
  });

  const pick = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setResult(null); setError(''); setFile(f.name); setCsv(await f.text());
  };
  const label = cohorts.find((c) => c.id === cohortId)?.label;

  return (
    <section aria-labelledby="ro-title" className="space-y-6">
      <div>
        <h1 id="ro-title" className="text-3xl font-extrabold tracking-tight">Class list</h1>
        <p className="mt-1 max-w-prose opacity-75">The teacher’s list of name, NU registration number and class roll. Students who match it join without waiting. Importing into: <b>{label ?? '—'}</b></p>
      </div>

      <div className="ros-card p-5">
        <label className="font-semibold" htmlFor="csv">CSV file</label>
        <input id="csv" type="file" accept=".csv,text/csv" className="file-input file-input-bordered file-input-sm mt-2 block w-full max-w-md" onChange={pick} />
        <p className="mt-2 text-sm opacity-70">From Excel or Google Sheets: File → Save as / Download → CSV. Needs name, registration number and roll columns (for example Name, Reg No, Roll).</p>
        <div className="mt-4 flex gap-2">
          <button className="btn btn-secondary btn-sm" disabled={!csv || !cohortId || run.isPending} onClick={() => run.mutate(true)}>Preview</button>
          <button className="btn btn-primary btn-sm" disabled={!result?.dryRun || result.created + result.updated === 0 || run.isPending} onClick={() => run.mutate(false)}>Import {result?.dryRun ? `${result.created + result.updated} rows` : ''}</button>
        </div>
        {error && <p role="alert" className="mt-3 rounded bg-error px-2 py-1 text-sm font-semibold text-error-content">{error}</p>}
        {result && (
          <div className="mt-4 text-sm" role="status">
            <p className="font-semibold">{result.dryRun ? `Preview of ${file}` : 'Imported'}: {result.created} new, {result.updated} updated, {result.skipped.length} unchanged, {result.errors.length} with problems</p>
            {[...result.skipped.map((s) => ({ ...s, kind: 'Skipped' })), ...result.errors.map((s) => ({ ...s, kind: 'Problem' }))].length > 0 && (
              <ul className="mt-2 max-h-56 overflow-auto rounded border border-base-300 p-2">
                {result.errors.map((x, i) => <li key={`e${i}`}>Row {x.rowNo}: {x.message}</li>)}
                {result.skipped.map((x, i) => <li key={`s${i}`} className="opacity-70">Row {x.rowNo}: {x.message}</li>)}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="ros-card overflow-x-auto p-5">
        <h2 className="font-bold">Current list ({list.length}). Changing a roll updates the student everywhere and places them again by the new roll.</h2>
        <table className="table table-sm mt-2">
          <thead><tr><th>Roll</th><th>Name</th><th>Registration no.</th><th>Account</th></tr></thead>
          <tbody>
            {list.map((r) => (
              <tr key={r._id}><td><RollCell r={r} /></td><td>{r.name}</td><td>{r.registrationNo}</td><td>{r.status === 'claimed' ? 'Registered' : 'Not yet'}</td></tr>
            ))}
            {list.length === 0 && <tr><td colSpan="4" className="opacity-70">No students imported yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
