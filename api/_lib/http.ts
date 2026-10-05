/// <reference path="./env.d.ts" />
// Shared helpers for the Vercel functions in /api (Web Request -> Response handlers).

export const USER_AGENT =
  process.env.UPSTREAM_USER_AGENT ||
  `Notifyem/1.0 (+${process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'https://vercel.com'})`;

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }
  });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) return json({ error: error.message }, error.status);
  console.error(error);
  return json({ error: error instanceof Error ? error.message : 'Unexpected server error.' }, 500);
}

/** Wraps a handler so thrown HttpErrors become JSON responses. */
export function handler(fn: (request: Request) => Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    try {
      return await fn(request);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export async function readJson<T = Record<string, unknown>>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.');
  }
}

export function numberParam(url: URL, name: string, fallback?: number): number {
  const raw = url.searchParams.get(name);
  const value = raw === null || raw === '' ? fallback : Number(raw);
  if (value === undefined || !Number.isFinite(value)) throw new HttpError(400, `Query parameter "${name}" must be a number.`);
  return value;
}

/** fetch with a hard timeout and a descriptive User-Agent (OSM/Nominatim reject anonymous clients). */
export async function fetchWithTimeout(input: string, init: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...(init.headers || {}) }
    });
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. */
export function isCronRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && request.headers.get('authorization') === `Bearer ${secret}`;
}
