import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { errorResponse, HttpError } from './http.js';
import { authClient, getSupabase, userClient } from './supabase.js';

// Session handling for the /api functions.
//
// Supabase Auth issues the tokens (we never hash passwords or sign tokens ourselves). The server keeps
// them in HttpOnly cookies, so page scripts can never read them, and checks them on every request:
//   access token  -> short-lived JWT, verified with Supabase on each call
//   refresh token -> rotated by Supabase when the access token expires (session persistence)
// Cookies are SameSite=Lax and, on HTTPS, Secure with the __Host- prefix. State-changing requests must
// also come from our own origin (assertSameOrigin), which blocks cross-site request forgery.

export type Role = 'admin' | 'user';

export interface AppUser {
  id: string;
  public_uid: string;
  username: string;
  login_email: string;
  role: Role;
  status: 'active' | 'deactivated';
  must_change_password: boolean;
  full_name: string;
  brokerage: string;
  job_title: string;
  contact_email: string;
  phone: string;
  service_area: string;
  brand_voice: string;
  marketing_preferences: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface AuthContext {
  user: AppUser;
  /** Database client acting as this user: row-level security applies to every query. */
  db: SupabaseClient;
  accessToken: string;
}

const REFRESH_MAX_AGE_SECONDS = 30 * 24 * 3600;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// ---------------------------------------------------------------------------
// Cookies
// ---------------------------------------------------------------------------

export const isSecureRequest = (request: Request) => new URL(request.url).protocol === 'https:';

/** __Host- cookies require HTTPS, so plain-HTTP local dev uses unprefixed names. */
export const cookieNames = (secure: boolean) =>
  secure ? { access: '__Host-nem_at', refresh: '__Host-nem_rt' } : { access: 'nem_at', refresh: 'nem_rt' };

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    const name = part.slice(0, index).trim();
    const raw = part.slice(index + 1).trim();
    try {
      out[name] = decodeURIComponent(raw);
    } catch {
      out[name] = raw;
    }
  }
  return out;
}

export function serializeCookie(name: string, value: string, maxAgeSeconds: number, secure: boolean): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
    secure ? 'Secure' : ''
  ]
    .filter(Boolean)
    .join('; ');
}

export function sessionCookies(session: Pick<Session, 'access_token' | 'refresh_token' | 'expires_in'>, secure: boolean): string[] {
  const names = cookieNames(secure);
  return [
    serializeCookie(names.access, session.access_token, session.expires_in || 3600, secure),
    serializeCookie(names.refresh, session.refresh_token, REFRESH_MAX_AGE_SECONDS, secure)
  ];
}

export function clearedSessionCookies(secure: boolean): string[] {
  const names = cookieNames(secure);
  return [serializeCookie(names.access, '', 0, secure), serializeCookie(names.refresh, '', 0, secure)];
}

export function withCookies(response: Response, cookies: string[]): Response {
  if (!cookies.length) return response;
  const headers = new Headers(response.headers);
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// ---------------------------------------------------------------------------
// CSRF: state-changing requests must originate from this site.
// ---------------------------------------------------------------------------

function allowedOrigins(request: Request): Set<string> {
  const origins = new Set([new URL(request.url).origin]);
  for (const extra of (process.env.APP_ORIGINS || '').split(',')) if (extra.trim()) origins.add(extra.trim().replace(/\/+$/, ''));
  return origins;
}

export function assertSameOrigin(request: Request): void {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return;
  const origin = request.headers.get('origin');
  if (origin) {
    if (!allowedOrigins(request).has(origin)) throw new HttpError(403, 'Request blocked: it did not come from NotifyEm.');
    return;
  }
  // Browsers always send Origin on cross-site POSTs; Sec-Fetch-Site is the fallback signal.
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') throw new HttpError(403, 'Request blocked: it did not come from NotifyEm.');
}

// ---------------------------------------------------------------------------
// Session resolution
// ---------------------------------------------------------------------------

interface ResolvedSession {
  authUserId: string;
  accessToken: string;
  /** Set-Cookie values to send back (rotated tokens, or cleared cookies). */
  cookies: string[];
}

/** Returns the signed-in Supabase user for this request, refreshing an expired access token when possible. */
export async function resolveSession(request: Request): Promise<ResolvedSession | null> {
  const secure = isSecureRequest(request);
  const names = cookieNames(secure);
  const cookies = parseCookies(request.headers.get('cookie'));
  const accessToken = cookies[names.access];
  const refreshToken = cookies[names.refresh];
  if (!accessToken && !refreshToken) return null;

  const auth = authClient().auth;
  if (accessToken) {
    const { data, error } = await auth.getUser(accessToken);
    if (!error && data.user) return { authUserId: data.user.id, accessToken, cookies: [] };
  }

  if (refreshToken) {
    const { data, error } = await auth.refreshSession({ refresh_token: refreshToken });
    if (!error && data.session && data.user) {
      return { authUserId: data.user.id, accessToken: data.session.access_token, cookies: sessionCookies(data.session, secure) };
    }
  }

  // Both tokens are dead: tell the browser to drop them.
  return { authUserId: '', accessToken: '', cookies: clearedSessionCookies(secure) };
}

export async function loadAppUser(id: string): Promise<AppUser | null> {
  const sb = getSupabase();
  if (!sb) throw new HttpError(503, 'Sign-in is not configured on the server.');
  const { data, error } = await sb.from('app_users').select('*').eq('id', id).maybeSingle();
  if (error) {
    throw new HttpError(
      500,
      /does not exist|Could not find the table/i.test(error.message)
        ? 'User accounts are not set up yet. Run supabase/0008_auth_foundation.sql.'
        : 'Could not load your account.'
    );
  }
  return (data as AppUser | null) ?? null;
}

export interface AuthOptions {
  /** Restrict the endpoint to this role. */
  role?: Role;
  /** Let a user whose temporary password must be changed reach this endpoint (change-password, me, sign-out). */
  allowPasswordChangeRequired?: boolean;
}

/**
 * Resolves and authorizes the caller. Throws 401 (not signed in), 403 (deactivated, wrong role,
 * password change required) — never trusts anything the browser says about its own role.
 */
export async function authenticate(request: Request, options: AuthOptions = {}): Promise<{ ctx: AuthContext; cookies: string[] }> {
  assertSameOrigin(request);
  const session = await resolveSession(request);
  if (!session || !session.authUserId) throw Object.assign(new HttpError(401, 'Please sign in.'), { cookies: session?.cookies ?? [] });

  const user = await loadAppUser(session.authUserId);
  const secure = isSecureRequest(request);
  if (!user) throw Object.assign(new HttpError(403, 'This sign-in has no NotifyEm account. Ask an administrator for an invitation.'), { cookies: clearedSessionCookies(secure) });
  if (user.status !== 'active') throw Object.assign(new HttpError(403, 'This account has been deactivated.'), { cookies: clearedSessionCookies(secure) });
  if (user.must_change_password && !options.allowPasswordChangeRequired) {
    throw Object.assign(new HttpError(403, 'PASSWORD_CHANGE_REQUIRED'), { cookies: session.cookies });
  }
  if (options.role && user.role !== options.role) throw Object.assign(new HttpError(403, 'You do not have permission to do that.'), { cookies: session.cookies });

  return { ctx: { user, db: userClient(session.accessToken), accessToken: session.accessToken }, cookies: session.cookies };
}

/** Wraps an /api handler so it only runs for an authorized user, and forwards any rotated session cookies. */
export function withAuth(fn: (request: Request, ctx: AuthContext) => Promise<Response>, options: AuthOptions = {}) {
  return async (request: Request): Promise<Response> => {
    let cookies: string[] = [];
    try {
      const result = await authenticate(request, options);
      cookies = result.cookies;
      const response = await fn(request, result.ctx);
      // A handler that issues its own session (e.g. after a password change) wins over a routine refresh.
      return response.headers.has('set-cookie') ? response : withCookies(response, cookies);
    } catch (error) {
      const carried = (error as { cookies?: string[] })?.cookies;
      return withCookies(errorResponse(error), carried ?? cookies);
    }
  };
}
