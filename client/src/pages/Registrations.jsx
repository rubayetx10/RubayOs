import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAcademic } from '../context/AcademicContext';
import { apiFetch } from '../services/api';

const WHY = { not_in_roster: 'Not in the class list', name_mismatch: 'Name differs from the list', roll_mismatch: 'Roll differs from the list', department_mismatch: 'Different department' };

function Row({ r, cohorts }) {
  const qc = useQueryClient();
  const options = cohorts.filter((c) => c.departmentId === r.departmentId);
  const [cohortId, setCohortId] = useState(options[0]?.id ?? '');
  const [error, setError] = useState('');
  const done = { onSuccess: () => { qc.invalidateQueries({ queryKey: ['registrations'] }); qc.invalidateQueries({ queryKey: ['pending-registrations'] }); }, onError: (e) => setError(e.message) };
  const approve = useMutation({ mutationFn: () => apiFetch(`/registrations/${r._id}/approve`, { method: 'POST', body: r.rosterEntryId ? {} : { cohortId } }), ...done });
  const reject = useMutation({ mutationFn: (reason) => apiFetch(`/registrations/${r._id}/reject`, { method: 'POST', body: { reason } }), ...done });
  const roster = r.rosterEntryId;
  return (
    <li className="ros-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-bold">{r.submitted.name} <span className="font-normal opacity-70">· {r.submitted.registrationNo} · roll {r.submitted.classRoll}</span></p>
          <p className="text-sm opacity-70">{r.userId?.email}</p>
          {roster && <p className="mt-1 text-sm">Class list says: <b>{roster.name}</b>, roll {roster.classRoll}</p>}
          <p className="mt-2 flex flex-wrap gap-1">{r.reasons.map((x) => <span key={x} className="badge badge-warning">{WHY[x] ?? x}</span>)}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {!roster && (
            <select aria-label="Add to cohort" className="select select-bordered select-sm" value={cohortId} onChange={(e) => setCohortId(e.target.value)}>
              {options.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          )}
          <div className="flex gap-2">
            <button className="btn btn-primary btn-sm" disabled={approve.isPending || (!roster && !cohortId)} onClick={() => approve.mutate()}>Approve</button>
            <button className="btn btn-ghost btn-sm" disabled={reject.isPending} onClick={() => { const reason = window.prompt('Reason for rejecting (the student is not told automatically):'); if (reason && reason.trim().length >= 3) reject.mutate(reason.trim()); }}>Reject</button>
          </div>
        </div>
      </div>
      {error && <p role="alert" className="mt-2 text-sm font-semibold text-error-content bg-error rounded px-2 py-1">{error}</p>}
    </li>
  );
}

export default function Registrations() {
  const { cohorts } = useAcademic();
  const { data, isLoading, error } = useQuery({ queryKey: ['registrations', 'pending'], queryFn: () => apiFetch('/registrations?status=pending&limit=100') });
  return (
    <section aria-labelledby="reg-title">
      <h1 id="reg-title" className="text-3xl font-extrabold tracking-tight">Registrations to check</h1>
      <p className="mt-1 max-w-prose opacity-75">These students did not match the class list exactly. When the list has them, approving uses the list’s name, roll and cohort.</p>
      <div className="mt-6">
        {isLoading && <p role="status">Loading…</p>}
        {error && <p role="alert">{error.message}</p>}
        {data && data.length === 0 && <p className="ros-card p-5">Nothing waiting. New requests will show up here.</p>}
        <ul className="space-y-3">{data?.map((r) => <Row key={r._id} r={r} cohorts={cohorts} />)}</ul>
      </div>
    </section>
  );
}
