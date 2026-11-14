import { Outlet } from 'react-router-dom';
import Brand from '../components/Brand';
import ThemeToggle from '../components/ThemeToggle';

export default function AppShell() {
  return (
    <div className="min-h-screen bg-base-200 text-base-content">
      <header className="border-b border-base-300/70 bg-base-100">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
          <Brand />
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-10">
        <Outlet />
      </main>
    </div>
  );
}
