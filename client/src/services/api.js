const BASE = '/api/v1';

export class ApiError extends Error {
  constructor(message, { status, code, details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Calls the RubayOS API and unwraps the { success, data } envelope. */
export async function apiFetch(path, { method = 'GET', body, signal } = {}) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch {
    throw new ApiError('Cannot reach the server', { code: 'NETWORK' });
  }

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    /* non-JSON response */
  }

  if (!res.ok || !payload?.success) {
    const err = payload?.error;
    throw new ApiError(err?.message ?? `Request failed (${res.status})`, {
      status: res.status,
      code: err?.code,
      details: err?.details,
    });
  }
  return payload.data;
}
