import { NavLink, Outlet } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import Brand from '../components/Brand';
import ThemeToggle from '../components/ThemeToggle';
import { ROLE_LABEL, useAuth } from '../context/AuthContext';
import { AcademicProvider, CohortSelect, SemesterSelect } from '../context/AcademicContext';

const link = ({ isActive }) => `btn btn-sm ${isActive ? 'btn-secondary' : 'btn-ghost'}`;

/** One shell for every role. The menu differs by role; each later feature adds its own entries. */
function Shell() {
  const { user, roles, isAdmin, logout } = useAuth();
  const top = ['super_admin', 'college_admin', 'department_admin', 'teacher', 'student'].find((r) => roles.includes(r));
  return (
    <div className="min-h-screen bg-base-200 text-base-content">
      <header className="border-b border-base-300/70 bg-base-100">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-3">
          <Brand />
          <nav aria-label="Main" className="flex flex-1 flex-wrap gap-1">
            <NavLink to="/dashboard" className={link}>Dashboard</NavLink>
            {isAdmin && <NavLink to="/structure" className={link}>Sections</NavLink>}
            {isAdmin && <NavLink to="/roster" className={link}>Class list</NavLink>}
            {isAdmin && <NavLink to="/courses" className={link}>Courses</NavLink>}
            {isAdmin && <NavLink to="/offerings" className={link}>This semester</NavLink>}
            {isAdmin && <NavLink to="/routine" className={link}>Routine</NavLink>}
            {isAdmin && <NavLink to="/exams" className={link}>Exams</NavLink>}
            {isAdmin && <NavLink to="/staff" className={link}>Staff</NavLink>}
            {isAdmin && <NavLink to="/registrations" className={link}>Registrations</NavLink>}
            {isAdmin && <NavLink to="/system" className={link}>System</NavLink>}
          </nav>
          {isAdmin && <CohortSelect />}
          {isAdmin && <SemesterSelect />}
          <div className="hidden text-right text-sm leading-tight sm:block">
            <div className="font-semibold">{user.name}</div>
            <div className="opacity-70">{ROLE_LABEL[top] ?? ''}</div>
          </div>
          <ThemeToggle />
          <button type="button" className="btn btn-ghost btn-sm" onClick={logout}><LogOut size={16} aria-hidden="true" />Log out</button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-10"><Outlet /></main>
    </div>
  );
}

export default function AppShell() {
  const { isAdmin } = useAuth();
  return isAdmin ? <AcademicProvider><Shell /></AcademicProvider> : <Shell />;
}
