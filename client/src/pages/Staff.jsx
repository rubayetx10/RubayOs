import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ROLE_LABEL } from '../context/AuthContext';
import { apiFetch } from '../services/api';

const STATUS = { active: 'Active', invited: 'Invited, not logged in yet', deactivated: 'Deactivated' };

export default function Staff() {
  const qc = useQueryClient();
  const { data: users = [] } = useQuery({ queryKey: ['users', 'staff'], queryFn: () => apiFetch('/users?limit=100') });
  const { data: depts = [] } = useQuery({ queryKey: ['departments'], queryFn: () => apiFetch('/public/departments') });
  const [v, setV] = useState({ name: '', email: '', role: 'teacher', departmentId: '' });
  const [sent, setSent] = useState('');
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const invite = useMutation({
    mutationFn: () => apiFetch('/staff', { method: 'POST', body: { name: v.name.trim(), email: v.email.trim(), role: v.role, departmentId: v.departmentId || depts[0]?.id } }),
    onSuccess: () => { setSent(v.email.trim()); setV({ ...v, name: '', email: '' }); qc.invalidateQueries({ queryKey: ['users'] }); qc.invalidateQueries({ queryKey: ['teachers'] }); },
    onMutate: () => setSent(''),
  });
  const staff = users.filter((u) => u.roles.some((r) => r.role !== 'student'));
  return (
    <section aria-labelledby="sf-title" className="space-y-6">
      <div>
        <h1 id="sf-title" className="text-3xl font-extrabold tracking-tight">Teachers and staff</h1>
        <p className="mt-1 max-w-prose opacity-75">Invite a person by email. They set their own password from the link. You never see or choose it.</p>
      </div>
      <div className="ros-card p-5">
        <h2 className="font-bold">Invite someone</h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input aria-label="Name" className="input input-bordered input-sm w-48" placeholder="Full name" value={v.name} onChange={set('name')} />
          <input aria-label="Email" type="email" className="input input-bordered input-sm w-60" placeholder="Email" value={v.email} onChange={set('email')} />
          <select aria-label="Role" className="select select-bordered select-sm" value={v.role} onChange={set('role')}>
            <option value="teacher">Teacher</option><option value="department_admin">Department Admin</option>
          </select>
          <select aria-label="Department" className="select select-bordered select-sm" value={v.departmentId || depts[0]?.id || ''} onChange={set('departmentId')}>
            {depts.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.collegeName})</option>)}
          </select>
          <button className="btn btn-primary btn-sm" disabled={invite.isPending || v.name.trim().length < 2 || !v.email} onClick={() => invite.mutate()}>Send invite</button>
        </div>
        {invite.error && <p role="alert" className="mt-2 rounded bg-error px-2 py-1 text-sm font-semibold text-error-content">{invite.error.message}</p>}
        {sent && <p role="status" className="mt-2 text-sm">Invite created for {sent}. Until email is set up, the link is printed in the server terminal.</p>}
      </div>
      <div className="ros-card overflow-x-auto p-5">
        <table className="table table-sm">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th></tr></thead>
          <tbody>
            {staff.map((u) => (
              <tr key={u.id}><td className="font-semibold">{u.name}</td><td>{u.email}</td><td>{[...new Set(u.roles.map((r) => ROLE_LABEL[r.role]))].join(', ')}</td><td>{STATUS[u.status] ?? u.status}</td></tr>
            ))}
            {staff.length === 0 && <tr><td colSpan="4" className="opacity-70">No staff in your area yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
