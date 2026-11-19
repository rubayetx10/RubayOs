import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAcademic } from '../context/AcademicContext';
import { apiFetch } from '../services/api';

const Err = ({ e }) => (e ? <p role="alert" className="mt-2 rounded bg-error px-2 py-1 text-sm font-semibold text-error-content">{e.message}</p> : null);

function Row({ o, teachers, onDone }) {
  const [pick, setPick] = useState('');
  const save = useMutation({
    mutationFn: (body) => apiFetch(`/offerings/${o.id}`, { method: 'PATCH', body }),
    onSuccess: () => { setPick(''); onDone(); },
  });
  const ids = o.teachers.map((t) => t.id);
  const free = teachers.filter((t) => !ids.includes(t.id));
  return (
    <tr className={o.status === 'closed' ? 'opacity-60' : ''}>
      <td className="font-semibold">{o.course?.code}</td>
      <td>{o.course?.name}<span className="ml-2 text-xs opacity-70">{o.course?.credit} cr · {o.course?.type}</span></td>
      <td>
        <div className="flex flex-wrap items-center gap-1">
          {o.teachers.map((t) => (
            <span key={t.id} className="badge badge-lg gap-1">{t.name}<button aria-label={`Remove ${t.name}`} className="font-bold" onClick={() => save.mutate({ teacherIds: ids.filter((x) => x !== t.id) })}>×</button></span>
          ))}
          {free.length > 0 && (
            <>
              <select aria-label="Add a teacher" className="select select-bordered select-xs" value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">Add teacher…</option>{free.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              {pick && <button className="btn btn-primary btn-xs" disabled={save.isPending} onClick={() => save.mutate({ teacherIds: [...ids, pick] })}>Add</button>}
            </>
          )}
        </div>
        <Err e={save.error} />
      </td>
      <td>{o.students}</td>
      <td><button className="btn btn-ghost btn-xs" onClick={() => save.mutate({ status: o.status === 'active' ? 'closed' : 'active' })}>{o.status === 'active' ? 'Close' : 'Reopen'}</button></td>
    </tr>
  );
}

export default function Offerings() {
  const qc = useQueryClient();
  const { cohortId, semesterId, semesters } = useAcademic();
  const [note, setNote] = useState('');
  const semester = semesters.find((s) => s._id === semesterId);
  const { data: items = [], isLoading } = useQuery({
    queryKey: ['offerings', cohortId, semesterId],
    enabled: !!cohortId && !!semesterId,
    queryFn: () => apiFetch(`/offerings?cohortId=${cohortId}&semesterId=${semesterId}`),
  });
  const { data: users = [] } = useQuery({ queryKey: ['teachers'], queryFn: () => apiFetch('/users?role=teacher&limit=100') });
  const teachers = users.filter((u) => u.status === 'active').map((u) => ({ id: u.id, name: u.name }));
  const refresh = () => qc.invalidateQueries({ queryKey: ['offerings'] });
  const gen = useMutation({
    mutationFn: () => apiFetch('/offerings/generate', { method: 'POST', body: { cohortId, semesterId } }),
    onMutate: () => setNote(''),
    onSuccess: (r) => { setNote(r.courses === 0 ? 'No published courses for this semester yet. Add them on the Courses page first.' : `${r.created} course(s) added. ${r.enrolled} student enrollment(s) created.`); refresh(); },
  });
  return (
    <section aria-labelledby="of-title" className="space-y-6">
      <div>
        <h1 id="of-title" className="text-3xl font-extrabold tracking-tight">Courses this semester{semester ? ` (semester ${semester.number})` : ''}</h1>
        <p className="mt-1 max-w-prose opacity-75">The courses this batch studies now and who teaches them. Students are enrolled in the compulsory ones automatically. Choose the batch and semester at the top.</p>
      </div>
      <div>
        <button className="btn btn-primary btn-sm" disabled={!semesterId || gen.isPending} onClick={() => gen.mutate()}>Create from the course list</button>
        <Err e={gen.error} />
        {note && <p role="status" className="mt-2 text-sm">{note}</p>}
      </div>
      <div className="ros-card overflow-x-auto p-5">
        <table className="table table-sm">
          <thead><tr><th>Code</th><th>Course</th><th>Teachers</th><th>Students</th><th /></tr></thead>
          <tbody>
            {items.map((o) => <Row key={o.id} o={o} teachers={teachers} onDone={refresh} />)}
            {!isLoading && items.length === 0 && <tr><td colSpan="5" className="opacity-70">Nothing yet. Press “Create from the course list”.</td></tr>}
          </tbody>
        </table>
        {teachers.length === 0 && <p className="mt-3 text-sm opacity-75">No active teachers yet. Invite them on the Staff page. They become active after they set their password.</p>}
      </div>
    </section>
  );
}
