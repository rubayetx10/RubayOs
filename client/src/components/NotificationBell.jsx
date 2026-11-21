import { useState } from 'react';
import { Bell } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../services/api';

const GO = { notice: '/notices', routine: '/dashboard', exam: '/dashboard' };
const PRIORITY = { important: 'badge-warning', urgent: 'badge-error' };
const ago = (d) => {
  const m = Math.round((Date.now() - new Date(d).getTime()) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return new Date(d).toLocaleDateString();
};

export default function NotificationBell() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const { data } = useQuery({ queryKey: ['notifications'], queryFn: () => apiFetch('/notifications'), refetchInterval: 30_000, refetchOnWindowFocus: true });
  const refresh = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  const read = useMutation({ mutationFn: (id) => apiFetch(`/notifications/${id}/read`, { method: 'POST' }), onSuccess: refresh });
  const readAll = useMutation({ mutationFn: () => apiFetch('/notifications/read-all', { method: 'POST' }), onSuccess: refresh });
  const unread = data?.unread ?? 0;

  const go = (n) => {
    if (!n.read) read.mutate(n.id);
    setOpen(false);
    nav(GO[n.type] ?? '/dashboard');
  };

  return (
    <div className="relative" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
      <button type="button" className="btn btn-ghost btn-square relative" aria-label={`Notifications, ${unread} unread`} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Bell size={20} aria-hidden="true" />
        {unread > 0 && <span className="badge badge-error badge-sm absolute -right-1 -top-1" aria-hidden="true">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <>
          <button type="button" aria-hidden="true" tabIndex={-1} className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
          <div className="ros-card absolute right-0 z-50 mt-2 max-h-[28rem] w-80 overflow-auto p-2 shadow-xl" role="dialog" aria-label="Notifications">
            <div className="flex items-center justify-between px-2 py-1">
              <h2 className="font-bold">Notifications</h2>
              <button className="btn btn-ghost btn-xs" disabled={unread === 0 || readAll.isPending} onClick={() => readAll.mutate()}>Mark all read</button>
            </div>
            {data?.items.length === 0 && <p className="px-2 py-6 text-center text-sm opacity-70">Nothing yet.</p>}
            <ul>
              {data?.items.map((n) => (
                <li key={n.id}>
                  <button type="button" className={`w-full rounded-lg px-2 py-2 text-left hover:bg-base-200 ${n.read ? 'opacity-70' : ''}`} onClick={() => go(n)}>
                    <span className="flex items-center gap-2">
                      {!n.read && <span className="badge badge-primary badge-xs" aria-label="Unread" />}
                      <span className={`text-sm ${n.read ? '' : 'font-bold'}`}>{n.title}</span>
                      {PRIORITY[n.priority] && <span className={`badge badge-sm ${PRIORITY[n.priority]}`}>{n.priority}</span>}
                    </span>
                    {n.body && <span className="mt-0.5 block text-xs opacity-80">{n.body}</span>}
                    <span className="mt-0.5 block text-xs opacity-60">{ago(n.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
