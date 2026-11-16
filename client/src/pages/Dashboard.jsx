import { useQuery } from '@tanstack/react-query';
import { ROLE_LABEL, useAuth } from '../context/AuthContext';
import { useAcademic } from '../context/AcademicContext';
import { apiFetch } from '../services/api';

const Card = ({ title, children }) => <div className="ros-card p-5"><h2 className="text-sm font-semibold opacity-70">{title}</h2><div className="mt-2 text-lg font-bold">{children}</div></div>;

function PendingCard() {
  const { data } = useQuery({ queryKey: ['pending-registrations'], queryFn: () => apiFetch('/registrations?status=pending&limit=1', { withMeta: true }) });
  return <Card title="Registrations waiting for approval">{data ? data.meta.total : '…'}</Card>;
}

function CohortCards() {
  const { cohortId, cohorts, semesterId } = useAcademic();
  const { data } = useQuery({ queryKey: ['enrollment-overview', cohortId, semesterId], enabled: !!cohortId && !!semesterId, queryFn: () => apiFetch(`/enrollment/overview?cohortId=${cohortId}&semesterId=${semesterId}`) });
  if (!cohortId || !data) return null;
  const w = data.warnings;
  return (
    <>
      <Card title={`Students · ${cohorts.find((c) => c.id === cohortId)?.label} · semester ${data.semester.number}`}>{data.totals.students}</Card>
      <Card title="Waiting for a section and part">{data.totals.unassigned}</Card>
      <Card title="Roll range warnings">{w.gaps.length + w.overlaps.length + w.uncovered.length + w.misplaced.length}</Card>
    </>
  );
}

export default function Dashboard() {
  const { user, roles, profile, isAdmin } = useAuth();
  const isStudent = roles.includes('student');
  return (
    <section aria-labelledby="dash-title">
      <h1 id="dash-title" className="text-3xl font-extrabold tracking-tight">Hello, {user.name.split(' ')[0]}</h1>
      <p className="mt-1 opacity-75">{roles.map((r) => ROLE_LABEL[r]).join(' · ')}</p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {isStudent && profile && (
          <>
            <Card title="Registration number">{user.registrationNo}</Card>
            <Card title="Class roll">{profile.classRoll}</Card>
            <Card title="Section and part">{profile.partId ? 'Assigned' : 'Not assigned yet'}</Card>
          </>
        )}
        {isAdmin && <PendingCard />}
        {isAdmin && <CohortCards />}
        {roles.includes('teacher') && <Card title="Your classes">Coming with the course and routine modules</Card>}
      </div>
    </section>
  );
}
