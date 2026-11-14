import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <section className="mx-auto max-w-xl">
      <h1 className="text-3xl font-extrabold tracking-tight">Page not found</h1>
      <p className="mt-2 opacity-80">The page you opened does not exist or has moved.</p>
      <Link to="/" className="btn btn-primary mt-6">
        Go to system check
      </Link>
    </section>
  );
}
