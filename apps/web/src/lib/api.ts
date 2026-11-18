/**
 * Talks to the local server. Every request carries X-MonksTracker: 1, which the server requires for writes
 * (it stops other websites from changing your data through the browser).
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? 'GET',
      headers: { 'content-type': 'application/json', 'x-monkstracker': '1' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'offline', 'Cannot reach the MonksTracker server on this computer.');
  }
  const data = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
  if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? `http_${res.status}`, data?.error?.message ?? res.statusText);
  return data as T;
}

export const post = <T>(path: string, body: unknown = {}) => api<T>(path, { method: 'POST', body });
export const patch = <T>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body });
