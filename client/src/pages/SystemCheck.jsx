import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { useHealth } from '../features/health/useHealth';

function formatUptime(sec) {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

function Row({ label, value, ok }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <dt className="text-sm opacity-70">{label}</dt>
      <dd className="flex items-center gap-2 text-sm font-semibold">
        {ok === true && <CheckCircle2 size={16} aria-hidden="true" />}
        {ok === false && <AlertTriangle size={16} aria-hidden="true" />}
        {value}
      </dd>
    </div>
  );
}

export default function SystemCheck() {
  const { data, error, isLoading, isFetching, refetch } = useHealth();
  const dbOk = data?.database.state === 'connected';

  return (
    <section aria-labelledby="sys-title" className="mx-auto max-w-xl">
      <h1 id="sys-title" className="text-3xl font-extrabold tracking-tight">
        System check
      </h1>
      <p className="mt-2 max-w-prose opacity-80">
        Confirms that this app can reach the RubayOS server and that the server can reach its database.
      </p>

      <div className="ros-card mt-8 p-6">
        {isLoading && <p role="status">Checking the server…</p>}

        {error && (
          <div role="alert" className="alert alert-error">
            <AlertTriangle size={20} aria-hidden="true" />
            <div>
              <p className="font-semibold">Cannot reach the server</p>
              <p className="text-sm">
                Start it with <code>npm run dev:server</code> from the project root, then check again.
              </p>
            </div>
          </div>
        )}

        {data && (
          <dl className="divide-y divide-base-300/60">
            <Row label="Server" value="Running" ok />
            <Row
              label="Database"
              value={dbOk ? 'Connected' : `Not connected (${data.database.state})`}
              ok={dbOk}
            />
            <Row label="Environment" value={data.environment} />
            <Row label="Version" value={data.version} />
            <Row label="Server uptime" value={formatUptime(data.uptimeSec)} />
          </dl>
        )}

        <button type="button" className="btn btn-primary mt-6" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw size={16} className={isFetching ? 'animate-spin' : ''} aria-hidden="true" />
          Check again
        </button>
      </div>
    </section>
  );
}
