import Brand from './Brand';
import ThemeToggle from './ThemeToggle';

export default function AuthCard({ title, subtitle, children, footer }) {
  return (
    <div className="min-h-screen bg-base-200 text-base-content">
      <div className="mx-auto flex max-w-md items-center justify-between px-4 py-4"><Brand /><ThemeToggle /></div>
      <main className="mx-auto max-w-md px-4 pb-12">
        <div className="ros-card p-6 sm:p-8">
          <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-sm opacity-75">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
        {footer && <p className="mt-4 text-center text-sm">{footer}</p>}
      </main>
    </div>
  );
}

export function Field({ label, error, children, hint }) {
  return (
    <label className="form-control w-full">
      <span className="label-text mb-1 font-semibold">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 text-xs opacity-70">{hint}</span>}
      {error && <span role="alert" className="mt-1 text-xs font-semibold text-error-content bg-error rounded px-2 py-1">{error}</span>}
    </label>
  );
}
