// Thin client for the Vercel functions in /api.

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}, timeoutMs = 60000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      signal: controller.signal,
      headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) }
    });
  } catch (error) {
    if (controller.signal.aborted) throw new ApiError(0, 'The server took too long to respond. Try a smaller radius and retry.');
    throw new ApiError(0, 'Could not reach the Notifyem server. Check your connection and retry.');
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // A non-JSON answer means the /api functions are not deployed (e.g. static-only hosting).
    throw new ApiError(
      response.status,
      response.status === 404
        ? `API route ${path.split('?')[0]} was not found. Deploy to Vercel (or run "npm run dev") so the /api functions are available.`
        : `Unexpected server response (HTTP ${response.status}).`
    );
  }
  if (!response.ok) throw new ApiError(response.status, body?.error || `Request failed (HTTP ${response.status}).`);
  return body as T;
}

export const apiGet = <T>(path: string, timeoutMs?: number) => apiFetch<T>(path, {}, timeoutMs);
export const apiSend = <T>(method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown, timeoutMs?: number) =>
  apiFetch<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) }, timeoutMs);

export function newId(): string {
  return crypto.randomUUID();
}
