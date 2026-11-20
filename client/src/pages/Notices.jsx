import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAcademic } from '../context/AcademicContext';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../services/api';

const Err = ({ e }) => (e ? <p role="alert" className="mt-2 rounded bg-error px-2 py-1 text-sm font-semibold text-error-content">{e.message}</p> : null);
const PRIORITY = { normal: '', important: 'badge-warning', urgent: 'badge-error' };
const Prio = ({ p }) => (p === 'normal' ? null : <span className={`badge ${PRIORITY[p]}`}>{p}</span>);
const when = (d) => new Date(d).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

// ---------------------------------------------------------------- students

function StudentFeed() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['my-notices'], queryFn: () => apiFetch('/my-notices') });
  const mark = useMutation({ mutationFn: (id) => apiFetch(`/my-notices/${id}/read`, { method: 'POST' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['my-notices'] }) });
  return (
    <section aria-labelledby="nt-title">
      <h1 id="nt-title" className="text-3xl font-extrabold tracking-tight">Notices</h1>
      <p className="mt-1 opacity-75">{data ? `${data.unread} unread` : ''}</p>
      <div className="mt-6 space-y-3">
        {isLoading && <p role="status">Loading…</p>}
        {data?.notices.length === 0 && <p className="ros-card p-5">No notices yet.</p>}
        {data?.notices.map((n) => (
          <details key={n.id} className="ros-card p-4" onToggle={(e) => { if (e.currentTarget.open && !n.read) mark.mutate(n.id); }}>
            <summary className="flex cursor-pointer flex-wrap items-center gap-2">
              {!n.read && <span className="badge badge-primary badge-xs" aria-label="Unread" />}
              <span className={n.read ? 'font-medium' : 'font-bold'}>{n.title}</span>
              {n.pinned && <span className="badge badge-ghost">pinned</span>}<Prio p={n.priority} />
              <span className="ml-auto text-xs opacity-70">{n.publisher.name} · {when(n.publishedAt)}{n.edited ? ' · edited' : ''}</span>
            </summary>
            <p className="mt-3 whitespace-pre-wrap text-sm">{n.body}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- teachers and admins

/** The audiences this person may write to. The server checks again; this only builds the menu. */
function useAudiences() {
  const { roles } = useAuth();
  const { cohortId, semesterId } = useAcademic();
  const admin = roles.some((r) => ['super_admin', 'college_admin', 'department_admin'].includes(r));
  const teacher = useQuery({ queryKey: ['teacher-me'], enabled: !admin, queryFn: () => apiFetch('/teacher/me') });
  const offerings = useQuery({ queryKey: ['offerings', cohortId, semesterId], enabled: admin && !!semesterId, queryFn: () => apiFetch(`/offerings?cohortId=${cohortId}&semesterId=${semesterId}`) });
  const sections = useQuery({ queryKey: ['routine-sections', semesterId], enabled: admin && !!semesterId, queryFn: () => apiFetch(`/academic/sections?semesterId=${semesterId}&limit=50`) });
  const depts = useQuery({ queryKey: ['structure-departments'], enabled: admin, queryFn: () => apiFetch('/academic/departments?limit=100') });
  const colleges = useQuery({ queryKey: ['structure-colleges'], enabled: admin && roles.some((r) => ['super_admin', 'college_admin'].includes(r)), queryFn: () => apiFetch('/academic/colleges?limit=100') });

  const out = [];
  if (!admin) {
    const seen = new Set();
    for (const c of teacher.data?.courses ?? []) {
      out.push({ key: `c:${c.offeringId}`, label: `Course: ${c.course.code} · ${c.batch}`, target: { scope: 'course', offeringId: c.offeringId } });
      const k = `${c.cohortId}:${c.semesterId}`;
      if (!seen.has(k)) { seen.add(k); out.push({ key: `k:${k}`, label: `Whole batch: ${c.batch}, semester ${c.semesterNumber}`, target: { scope: 'cohort', cohortId: c.cohortId, semesterId: c.semesterId } }); }
    }
    return out;
  }
  if (cohortId && semesterId) {
    out.push({ key: 'k', label: 'Whole batch (the one chosen at the top), this semester', target: { scope: 'cohort', cohortId, semesterId } });
    for (const s of sections.data ?? []) out.push({ key: `s:${s._id}`, label: `Section ${s.name} only`, target: { scope: 'cohort', cohortId, semesterId, sectionIds: [s._id] } });
    for (const o of offerings.data ?? []) out.push({ key: `c:${o.id}`, label: `Course: ${o.course?.code} · ${o.course?.name}`, target: { scope: 'course', offeringId: o.id } });
  }
  for (const d of depts.data ?? []) out.push({ key: `d:${d._id}`, label: `Whole department: ${d.name}`, target: { scope: 'department', departmentId: d._id } });
  for (const c of colleges.data ?? []) out.push({ key: `g:${c._id}`, label: `Whole college: ${c.name}`, target: { scope: 'college', collegeId: c._id } });
  return out;
}

function Compose() {
  const qc = useQueryClient();
  const audiences = useAudiences();
  const [v, setV] = useState({ key: '', title: '', body: '', priority: 'normal', pinned: false });
  const chosen = audiences.find((a) => a.key === v.key) ?? audiences[0];
  const send = useMutation({
    mutationFn: () => apiFetch('/notices', { method: 'POST', body: { title: v.title.trim(), body: v.body.trim(), priority: v.priority, pinned: v.pinned, target: chosen.target } }),
    onSuccess: () => { setV({ ...v, title: '', body: '', pinned: false }); qc.invalidateQueries({ queryKey: ['notices-staff'] }); },
  });
  return (
    <div className="ros-card p-5">
      <h2 className="font-bold">Send a notice</h2>
      <div className="mt-3 space-y-3">
        <label className="form-control"><span className="label-text mb-1 font-semibold">Who should see it?</span>
          <select className="select select-bordered select-sm" value={chosen?.key ?? ''} onChange={(e) => setV({ ...v, key: e.target.value })}>
            {audiences.length === 0 && <option value="">Nobody available yet</option>}
            {audiences.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
          </select>
        </label>
        <input aria-label="Title" className="input input-bordered input-sm w-full" placeholder="Title" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />
        <textarea aria-label="Message" className="textarea textarea-bordered w-full" rows={4} placeholder="Message" value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} />
        <div className="flex flex-wrap items-center gap-3">
          <select aria-label="Priority" className="select select-bordered select-sm" value={v.priority} onChange={(e) => setV({ ...v, priority: e.target.value })}><option value="normal">Normal</option><option value="important">Important</option><option value="urgent">Urgent</option></select>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="checkbox checkbox-sm" checked={v.pinned} onChange={(e) => setV({ ...v, pinned: e.target.checked })} />Pin to the top</label>
          <button className="btn btn-primary btn-sm" disabled={!chosen || v.title.trim().length < 3 || !v.body.trim() || send.isPending} onClick={() => send.mutate()}>Send notice</button>
        </div>
      </div>
      <Err e={send.error} />
    </div>
  );
}

function Row({ n }) {
  const qc = useQueryClient();
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState({ title: n.title, body: n.body, priority: n.priority, pinned: n.pinned });
  const done = { onSuccess: () => { setEdit(false); qc.invalidateQueries({ queryKey: ['notices-staff'] }); } };
  const save = useMutation({ mutationFn: () => apiFetch(`/notices/${n.id}`, { method: 'PATCH', body: { title: v.title.trim(), body: v.body.trim(), priority: v.priority, pinned: v.pinned } }), ...done });
  const withdraw = useMutation({ mutationFn: (reason) => apiFetch(`/notices/${n.id}/withdraw`, { method: 'POST', body: { reason } }), ...done });
  const gone = n.status === 'withdrawn';
  return (
    <li className={`ros-card p-4 ${gone ? 'opacity-60' : ''}`}>
      {edit ? (
        <div className="space-y-2">
          <input aria-label="Title" className="input input-bordered input-sm w-full" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />
          <textarea aria-label="Message" className="textarea textarea-bordered w-full" rows={4} value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} />
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Priority" className="select select-bordered select-xs" value={v.priority} onChange={(e) => setV({ ...v, priority: e.target.value })}><option value="normal">Normal</option><option value="important">Important</option><option value="urgent">Urgent</option></select>
            <label className="flex items-center gap-1 text-xs"><input type="checkbox" className="checkbox checkbox-xs" checked={v.pinned} onChange={(e) => setV({ ...v, pinned: e.target.checked })} />Pinned</label>
            <button className="btn btn-primary btn-xs" disabled={save.isPending || v.title.trim().length < 3 || !v.body.trim()} onClick={() => save.mutate()}>Save</button>
            <button className="btn btn-ghost btn-xs" onClick={() => setEdit(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <b>{n.title}</b><Prio p={n.priority} />{n.pinned && <span className="badge badge-ghost">pinned</span>}<span className="badge badge-outline">{n.scope}</span>
            {gone && <span className="badge badge-error">withdrawn</span>}{n.edited && <span className="text-xs opacity-70">edited</span>}
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm">{n.body}</p>
          <p className="mt-2 text-xs opacity-70">{n.mine ? 'You' : n.publisher} · {when(n.createdAt)} · read by {n.readCount}{gone && n.withdrawal?.reason ? ` · withdrawn: ${n.withdrawal.reason}` : ''}</p>
          {!gone && (
            <div className="mt-2 flex gap-2">
              <button className="btn btn-ghost btn-xs" onClick={() => setEdit(true)}>Edit</button>
              <button className="btn btn-ghost btn-xs" onClick={() => { const r = window.prompt('This removes the notice for everyone. Reason (kept in the record):'); if (r && r.trim().length >= 3) withdraw.mutate(r.trim()); }}>Delete for everyone</button>
            </div>
          )}
        </>
      )}
      <Err e={save.error} /><Err e={withdraw.error} />
    </li>
  );
}

function StaffView() {
  const { data = [] } = useQuery({ queryKey: ['notices-staff'], queryFn: () => apiFetch('/notices') });
  return (
    <section aria-labelledby="nt-title" className="space-y-6">
      <div>
        <h1 id="nt-title" className="text-3xl font-extrabold tracking-tight">Notices</h1>
        <p className="mt-1 max-w-prose opacity-75">Choose who should see it. Students see it as soon as you send. “Delete for everyone” removes it from every student at once; a record is kept.</p>
      </div>
      <Compose />
      <ul className="space-y-3">{data.map((n) => <Row key={n.id} n={n} />)}{data.length === 0 && <li className="ros-card p-5">No notices yet.</li>}</ul>
    </section>
  );
}

export default function Notices() {
  const { isAdmin, roles } = useAuth();
  return (
    <div className="space-y-12">
      {(isAdmin || roles.includes('teacher')) && <StaffView />}
      {roles.includes('student') && <StudentFeed />}
    </div>
  );
}
