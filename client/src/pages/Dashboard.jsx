import { useQuery } from '@tanstack/react-query';
import { ROLE_LABEL, useAuth } from '../context/AuthContext';
import { useAcademic } from '../context/AcademicContext';
import { apiFetch } from '../services/api';

const Card = ({ title, children }) => <div className="ros-card p-5"><h2 className="text-sm font-semibold opacity-70">{title}</h2><div className="mt-2 text-lg font-bold">{children}</div></div>;

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const REASON = { not_published: 'Your routine has not been published yet.', no_section: 'You will see your routine once you are placed in a section.' };

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const daysTo = (date) => Math.round((new Date(`${date}T00:00:00`) - new Date(`${today()}T00:00:00`)) / 86_400_000);
const away = (n) => (n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`);

function MyCoursesCard() {
  const { data } = useQuery({ queryKey: ['my-courses'], queryFn: () => apiFetch('/my-courses/me') });
  if (!data) return null;
  return (
    <div className="ros-card p-5 sm:col-span-2">
      <h2 className="text-sm font-semibold opacity-70">My courses</h2>
      {data.courses.length === 0 && <p className="mt-2">Your courses will appear here once your department sets them up.</p>}
      <div className="mt-2 space-y-2">
        {data.courses.map((c) => (
          <details key={c.course.id} className="rounded border border-base-300 p-3">
            <summary className="cursor-pointer font-semibold">{c.course.code} · {c.course.name}<span className="ml-2 text-sm font-normal opacity-70">{c.course.credit} credit{c.teachers.length ? ` · ${c.teachers.join(', ')}` : ''}</span></summary>
            {!c.syllabus && <p className="mt-2 text-sm opacity-75">The syllabus has not been published yet.</p>}
            {c.syllabus && (
              <div className="mt-2 text-sm">
                {c.syllabus.objectives.length > 0 && <><p className="font-semibold">Objectives</p><ul className="list-disc pl-5">{c.syllabus.objectives.map((o, i) => <li key={i}>{o}</li>)}</ul></>}
                <p className="mt-2 font-semibold">Topics</p>
                <ol className="list-decimal pl-5">{c.syllabus.topics.map((t, i) => <li key={i}>{t.title}{t.subtopics.length > 0 && <ul className="list-disc pl-5 opacity-80">{t.subtopics.map((x, k) => <li key={k}>{x}</li>)}</ul>}</li>)}</ol>
              </div>
            )}
          </details>
        ))}
      </div>
    </div>
  );
}

function ExamCard() {
  const { data } = useQuery({ queryKey: ['my-exams'], queryFn: () => apiFetch('/exam/me') });
  const upcoming = (data?.exams ?? []).filter((e) => e.date >= today());
  if (!data) return null;
  return (
    <div className="ros-card p-5 sm:col-span-2">
      <h2 className="text-sm font-semibold opacity-70">Upcoming exams</h2>
      {upcoming.length === 0 && <p className="mt-2">No exams announced yet.</p>}
      <ul className="mt-2 space-y-2 text-sm">
        {upcoming.map((e) => (
          <li key={e.id} className={e.cancelled ? 'line-through opacity-60' : ''}>
            <b>{e.course.code}</b> {e.course.name} · {e.title} · {e.date} {e.startTime}–{e.endTime}{e.room ? ` · Room ${e.room}` : ''}
            <span className="ml-2 badge badge-ghost">{e.cancelled ? 'cancelled' : away(daysTo(e.date))}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RoutineCard() {
  const { data } = useQuery({ queryKey: ['my-routine'], queryFn: () => apiFetch('/routine/me') });
  if (!data) return null;
  const today = new Date().getDay();
  const days = data.routine ? [...new Set(data.routine.entries.map((e) => e.day))] : [];
  return (
    <div className="ros-card p-5 sm:col-span-2">
      <h2 className="text-sm font-semibold opacity-70">Class routine</h2>
      {!data.routine && <p className="mt-2">{REASON[data.reason] ?? 'No routine yet.'}</p>}
      {days.map((d) => (
        <div key={d} className="mt-3">
          <h3 className={`font-bold ${d === today ? 'text-primary' : ''}`}>{DAYS[d]}{d === today ? ' · today' : ''}</h3>
          <ul className="mt-1 space-y-1 text-sm">
            {data.routine.entries.filter((e) => e.day === d).map((e, i) => (
              <li key={i}>{e.startTime}–{e.endTime} · <b>{e.course.code}</b> {e.course.name}{e.teacher ? ` · ${e.teacher}` : ''}{e.room ? ` · Room ${e.room}` : ''}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

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
        {isStudent && <RoutineCard />}
        {isStudent && <ExamCard />}
        {isStudent && <MyCoursesCard />}
        {isAdmin && <PendingCard />}
        {isAdmin && <CohortCards />}
        {roles.includes('teacher') && <Card title="Your classes">Coming with the course and routine modules</Card>}
      </div>
    </section>
  );
}
