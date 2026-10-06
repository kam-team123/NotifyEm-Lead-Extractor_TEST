import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabase } from './fakeSupabase';

const fake = vi.hoisted(() => ({ current: null as ReturnType<typeof createFakeSupabase> | null }));

vi.mock('../api/_lib/supabase.js', () => ({
  getSupabase: () => fake.current!.service,
  requireSupabase: () => fake.current!.service,
  authClient: () => fake.current!.anon,
  userClient: () => fake.current!.service,
  supabaseUrl: () => 'https://supabase.test',
  isAuthConfigured: () => true,
  isSupabaseConfigured: () => true
}));

fake.current = createFakeSupabase();
const sb = fake.current;

const { GET: authGet, POST: authPost } = await import('../api/auth');
const { POST: adminPost } = await import('../api/admin');
// Tests go through the real single-function dispatchers, exactly as Vercel routes them.
const login = authPost, logout = authPost, changePassword = authPost, forgotPassword = authPost, complete = authPost;
const me = authGet;
const invite = adminPost;

const ORIGIN = 'https://notifyem.test';
const TEMP_PASSWORD = 'Temporary-Pass-123';
const NEW_PASSWORD = 'Brand-New-Secret-456';

function call(handler: (r: Request) => Promise<Response>, path: string, body?: unknown, cookie = '', extra: Record<string, string> = {}) {
  return handler(
    new Request(`${ORIGIN}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7', ...(cookie ? { cookie } : {}), ...extra },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  );
}

/** Turns Set-Cookie response headers into a Cookie request header. */
const cookieFrom = (res: Response) =>
  res.headers
    .getSetCookie()
    .map(c => c.split(';')[0])
    .filter(c => !c.endsWith('='))
    .join('; ');

function seedUser(opts: { username?: string; email?: string; password?: string; role?: string; status?: string; mustChange?: boolean } = {}) {
  const email = opts.email ?? 'agent@example.com';
  const id = sb.addAuthUser(email, opts.password ?? TEMP_PASSWORD);
  sb.addAppUser({
    id,
    username: opts.username ?? 'agent',
    login_email: email,
    role: opts.role ?? 'user',
    status: opts.status ?? 'active',
    must_change_password: opts.mustChange ?? false
  });
  return id;
}

const auditText = () => JSON.stringify(sb.tables.audit_events);

beforeEach(() => sb.reset());

describe('POST /api/auth?action=login', () => {
  it('signs in by username and sets two HttpOnly cookies', async () => {
    seedUser();
    const res = await call(login, '/api/auth?action=login', { username: 'agent', password: TEMP_PASSWORD });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toMatchObject({ username: 'agent', role: 'user', publicUid: '002' });
    const cookies = res.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    for (const c of cookies) expect(c).toMatch(/HttpOnly.*SameSite=Lax.*Secure/);
    expect(JSON.stringify(body)).not.toMatch(/at-|rt-|Temporary/);
  });

  it('accepts the username case-insensitively', async () => {
    seedUser({ username: 'Manny' });
    expect((await call(login, '/api/auth?action=login', { username: 'manny', password: TEMP_PASSWORD })).status).toBe(200);
  });

  it('gives the same answer for a wrong password and an unknown username', async () => {
    seedUser();
    const wrong = await call(login, '/api/auth?action=login', { username: 'agent', password: 'nope-nope-nope' });
    const unknown = await call(login, '/api/auth?action=login', { username: 'ghost', password: 'nope-nope-nope' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
    expect(wrong.headers.getSetCookie()).toHaveLength(0);
  });

  it('audits failures without ever storing the password', async () => {
    seedUser();
    await call(login, '/api/auth?action=login', { username: 'agent', password: 'Secret-Attempt-999' });
    const events = sb.tables.audit_events;
    expect(events.at(-1)).toMatchObject({ action: 'auth.login', outcome: 'failure' });
    expect(auditText()).not.toContain('Secret-Attempt-999');
  });

  it('refuses deactivated accounts and revokes the session it just got', async () => {
    seedUser({ status: 'deactivated' });
    const res = await call(login, '/api/auth?action=login', { username: 'agent', password: TEMP_PASSWORD });
    expect(res.status).toBe(403);
    expect(res.headers.getSetCookie()).toHaveLength(0);
    expect(sb.calls.signOut).toHaveLength(1);
  });

  it('rate-limits repeated attempts on one username', async () => {
    seedUser();
    let last: Response | undefined;
    for (let i = 0; i < 9; i++) last = await call(login, '/api/auth?action=login', { username: 'agent', password: TEMP_PASSWORD });
    expect(last!.status).toBe(429);
  });

  it('rejects a cross-site login post', async () => {
    seedUser();
    const res = await call(login, '/api/auth?action=login', { username: 'agent', password: TEMP_PASSWORD }, '', { origin: 'https://evil.example' });
    expect(res.status).toBe(403);
  });
});

describe('session lifecycle', () => {
  it('me → change password (forced) → me', async () => {
    seedUser({ mustChange: true });
    const signedIn = await call(login, '/api/auth?action=login', { username: 'agent', password: TEMP_PASSWORD });
    expect((await signedIn.json()).user.mustChangePassword).toBe(true);
    let cookie = cookieFrom(signedIn);

    const meRes = await call(me, '/api/auth', undefined, cookie);
    expect(meRes.status).toBe(200);

    const wrong = await call(changePassword, '/api/auth?action=change-password', { currentPassword: 'not-it', newPassword: NEW_PASSWORD }, cookie);
    expect(wrong.status).toBe(400);

    const weak = await call(changePassword, '/api/auth?action=change-password', { currentPassword: TEMP_PASSWORD, newPassword: 'short' }, cookie);
    expect(weak.status).toBe(400);

    const ok = await call(changePassword, '/api/auth?action=change-password', { currentPassword: TEMP_PASSWORD, newPassword: NEW_PASSWORD }, cookie);
    expect(ok.status).toBe(200);
    expect((await ok.json()).user.mustChangePassword).toBe(false);
    expect(sb.tables.app_users[0].must_change_password).toBe(false);
    expect(sb.calls.signOut.some(c => c.scope === 'others')).toBe(true);
    cookie = cookieFrom(ok);

    expect((await call(me, '/api/auth', undefined, cookie)).status).toBe(200);
    expect((await call(login, '/api/auth?action=login', { username: 'agent', password: TEMP_PASSWORD })).status).toBe(401);
    expect(auditText()).not.toMatch(new RegExp(`${TEMP_PASSWORD}|${NEW_PASSWORD}`));
  });

  it('me is 401 without a session', async () => {
    expect((await call(me, '/api/auth')).status).toBe(401);
  });

  it('logout revokes the session and clears both cookies', async () => {
    seedUser();
    const cookie = cookieFrom(await call(login, '/api/auth?action=login', { username: 'agent', password: TEMP_PASSWORD }));
    const res = await call(logout, '/api/auth?action=logout', {}, cookie);
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().filter(c => c.includes('Max-Age=0'))).toHaveLength(2);
    expect(sb.calls.signOut.at(-1)?.scope).toBe('local');
  });
});

describe('password reset', () => {
  it('returns the same message whether or not the account exists, and only emails real accounts', async () => {
    seedUser();
    const known = await call(forgotPassword, '/api/auth?action=forgot-password', { identifier: 'agent' });
    const unknown = await call(forgotPassword, '/api/auth?action=forgot-password', { identifier: 'nobody' });
    expect(await known.json()).toEqual(await unknown.json());
    expect(sb.calls.resetPasswordForEmail).toEqual([{ email: 'agent@example.com', redirectTo: `${ORIGIN}/reset-password` }]);
  });

  it('completes a reset from the emailed token and signs the user in', async () => {
    const id = seedUser();
    const tokenHash = sb.issueEmailToken(id, 'recovery');
    const res = await call(complete, '/api/auth?action=complete', { tokenHash, type: 'recovery', newPassword: NEW_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie()).toHaveLength(2);
    expect((await call(login, '/api/auth?action=login', { username: 'agent', password: NEW_PASSWORD })).status).toBe(200);
  });

  it('rejects an invalid or reused token', async () => {
    const id = seedUser();
    const tokenHash = sb.issueEmailToken(id, 'recovery');
    expect((await call(complete, '/api/auth?action=complete', { tokenHash, type: 'recovery', newPassword: NEW_PASSWORD })).status).toBe(200);
    expect((await call(complete, '/api/auth?action=complete', { tokenHash, type: 'recovery', newPassword: NEW_PASSWORD })).status).toBe(400);
    expect((await call(complete, '/api/auth?action=complete', { tokenHash: 'made-up', type: 'invite', newPassword: NEW_PASSWORD })).status).toBe(400);
  });
});

describe('invitations', () => {
  async function adminCookie() {
    seedUser({ username: 'Manny', email: 'admin@example.com', role: 'admin' });
    return cookieFrom(await call(login, '/api/auth?action=login', { username: 'Manny', password: TEMP_PASSWORD }));
  }

  it('only admins can invite', async () => {
    seedUser();
    const cookie = cookieFrom(await call(login, '/api/auth?action=login', { username: 'agent', password: TEMP_PASSWORD }));
    const res = await call(invite, '/api/admin?action=invite', { username: 'newbie', email: 'new@example.com' }, cookie);
    expect(res.status).toBe(403);
    expect(sb.calls.inviteUserByEmail).toHaveLength(0);
  });

  it('an invited user sets their own password from the link and signs in', async () => {
    const cookie = await adminCookie();
    const res = await call(invite, '/api/admin?action=invite', { username: 'newbie', email: 'New@Example.com', role: 'user' }, cookie);
    expect(res.status).toBe(201);
    expect(sb.calls.inviteUserByEmail[0]).toEqual({ email: 'new@example.com', redirectTo: `${ORIGIN}/accept-invite` });

    const invited = sb.tables.app_users.find(u => u.username === 'newbie')!;
    expect(invited.role).toBe('user');
    const tokenHash = sb.issueEmailToken(invited.id, 'invite');
    expect((await call(complete, '/api/auth?action=complete', { tokenHash, type: 'invite', newPassword: NEW_PASSWORD })).status).toBe(200);
    expect((await call(login, '/api/auth?action=login', { username: 'newbie', password: NEW_PASSWORD })).status).toBe(200);
  });

  it('refuses a duplicate username', async () => {
    const cookie = await adminCookie();
    const res = await call(invite, '/api/admin?action=invite', { username: 'manny', email: 'other@example.com' }, cookie);
    expect(res.status).toBe(409);
  });

  it('rolls back the auth user when the profile cannot be saved', async () => {
    const cookie = await adminCookie();
    sb.failInsertOn.add('app_users');
    const res = await call(invite, '/api/admin?action=invite', { username: 'newbie', email: 'new@example.com' }, cookie);
    expect(res.status).toBe(500);
    expect(sb.calls.deleteUser).toHaveLength(1);
    expect(sb.authUsers.some(u => u.email === 'new@example.com')).toBe(false);
  });
});
