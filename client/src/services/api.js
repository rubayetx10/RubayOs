const BASE = '/api/v1';
let accessToken = null;
let refreshing = null;
let onSessionLost = () => {};

export const setToken = (t) => { accessToken = t; };
export const setOnSessionLost = (fn) => { onSessionLost = fn; };

export class ApiError extends Error {
  constructor(message, { status, code, details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function raw(path, { method = 'GET', body, signal, withMeta = false } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  let res;
  try {
    res = await fetch(`${BASE}${path}`, { method, credentials: 'include', headers, body: body ? JSON.stringify(body) : undefined, signal });
  } catch {
    throw new ApiError('Cannot reach the server', { code: 'NETWORK' });
  }
  let payload = null;
  try { payload = await res.json(); } catch { /* not JSON */ }
  if (!res.ok || !payload?.success) {
    const e = payload?.error;
    throw new ApiError(e?.message ?? `Request failed (${res.status})`, { status: res.status, code: e?.code, details: e?.details });
  }
  return withMeta ? { data: payload.data, meta: payload.meta } : payload.data;
}

/** One refresh at a time: parallel callers share it, so the rotating cookie is never used twice. */
export function refreshSession() {
  refreshing ??= raw('/auth/refresh', { method: 'POST' })
    .then((d) => { accessToken = d.accessToken; return d.accessToken; })
    .finally(() => { refreshing = null; });
  return refreshing;
}

const NO_RETRY = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout'];

/** Calls the API. On 401 it silently refreshes the login once and retries. */
export async function apiFetch(path, opts = {}) {
  try {
    return await raw(path, opts);
  } catch (err) {
    if (err.status !== 401 || NO_RETRY.includes(path)) throw err;
    try {
      await refreshSession();
    } catch {
      accessToken = null;
      onSessionLost();
      throw err;
    }
    return raw(path, opts);
  }
}
