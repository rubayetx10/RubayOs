import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-base-200 p-6 text-base-content">
      <div className="max-w-md">
        <h1 className="text-3xl font-extrabold tracking-tight">Page not found</h1>
        <p className="mt-2 opacity-80">The page you opened does not exist or has moved.</p>
        <Link to="/dashboard" className="btn btn-primary mt-6">Go to dashboard</Link>
      </div>
    </main>
  );
}
