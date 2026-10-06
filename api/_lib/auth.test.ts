import { beforeEach, describe, expect, it, vi } from 'vitest';

// Supabase is mocked: these tests cover NotifyEm's own authorization decisions (cookies, CSRF, roles,
// deactivation, forced password change). Row-level security itself needs a real database; see
// docs/AUTH_SETUP.md "Verifying tenant isolation".

const getUser = vi.fn();
const refreshSession = vi.fn();
let appUserRow: Record<string, unknown> | null = null;

vi.mock('./supabase.js', () => ({
  authClient: () => ({ auth: { getUser, refreshSession } }),
  userClient: (token: string) => ({ token }),
  getSupabase: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: appUserRow, error: null }) }) })
    })
  })
}));

const { assertSameOrigin, authenticate, clearedSessionCookies, cookieNames, parseCookies, serializeCookie, withAuth } = await import('./auth.js');

const baseUser = {
  id: 'u-1',
  public_uid: '002',
  username: 'agent',
  login_email: 'agent@example.com',
  role: 'user',
  status: 'active',
  must_change_password: false
};

function req(method = 'GET', headers: Record<string, string> = {}, url = 'https://notifyem.test/api/leads') {
  return new Request(url, { method, headers });
}

const signedIn = (extra: Record<string, string> = {}) => ({ cookie: `${cookieNames(true).access}=good-token`, ...extra });

beforeEach(() => {
  getUser.mockReset();
  refreshSession.mockReset();
  appUserRow = { ...baseUser };
  getUser.mockImplementation(async (token: string) =>
    token === 'good-token' ? { data: { user: { id: 'u-1' } }, error: null } : { data: { user: null }, error: new Error('expired') }
  );
});

describe('cookies', () => {
  it('serializes HttpOnly, SameSite=Lax, Secure cookies on HTTPS', () => {
    const cookie = serializeCookie('__Host-nem_at', 'abc', 3600, true);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Max-Age=3600');
  });

  it('omits Secure and the __Host- prefix on plain-HTTP local dev', () => {
    expect(cookieNames(false).access).toBe('nem_at');
    expect(serializeCookie('nem_at', 'abc', 10, false)).not.toContain('Secure');
  });

  it('clears both session cookies with Max-Age=0', () => {
    const cleared = clearedSessionCookies(true);
    expect(cleared).toHaveLength(2);
    for (const cookie of cleared) expect(cookie).toContain('Max-Age=0');
  });

  it('parses a Cookie header', () => {
    expect(parseCookies('a=1; nem_at=x%20y; broken')).toEqual({ a: '1', nem_at: 'x y' });
  });
});

describe('CSRF origin check', () => {
  it('allows safe methods without an Origin', () => {
    expect(() => assertSameOrigin(req('GET'))).not.toThrow();
  });

  it('allows same-origin writes', () => {
    expect(() => assertSameOrigin(req('POST', { origin: 'https://notifyem.test' }))).not.toThrow();
  });

  it('blocks writes from another origin', () => {
    expect(() => assertSameOrigin(req('POST', { origin: 'https://evil.example' }))).toThrow(/did not come from NotifyEm/);
  });

  it('blocks cross-site writes signalled only by Sec-Fetch-Site', () => {
    expect(() => assertSameOrigin(req('DELETE', { 'sec-fetch-site': 'cross-site' }))).toThrow();
  });
});

describe('authenticate', () => {
  it('rejects a request with no session (401)', async () => {
    await expect(authenticate(req())).rejects.toMatchObject({ status: 401 });
  });

  it('accepts a valid session and returns a user-scoped db client', async () => {
    const { ctx } = await authenticate(req('GET', signedIn()));
    expect(ctx.user.username).toBe('agent');
    expect(ctx.db).toEqual({ token: 'good-token' });
  });

  it('refreshes an expired access token and returns rotated cookies', async () => {
    refreshSession.mockResolvedValue({
      data: { user: { id: 'u-1' }, session: { access_token: 'good-token', refresh_token: 'new-rt', expires_in: 3600 } },
      error: null
    });
    const names = cookieNames(true);
    const { cookies } = await authenticate(req('GET', { cookie: `${names.access}=stale; ${names.refresh}=old-rt` }));
    expect(refreshSession).toHaveBeenCalledWith({ refresh_token: 'old-rt' });
    expect(cookies.join('\n')).toContain('new-rt');
  });

  it('blocks deactivated accounts and clears their cookies', async () => {
    appUserRow = { ...baseUser, status: 'deactivated' };
    const response = await withAuth(async () => new Response('ok'))(req('GET', signedIn()));
    expect(response.status).toBe(403);
    expect(response.headers.getSetCookie().join('\n')).toContain('Max-Age=0');
  });

  it('blocks an auth user without a NotifyEm account', async () => {
    appUserRow = null;
    await expect(authenticate(req('GET', signedIn()))).rejects.toMatchObject({ status: 403 });
  });

  it('enforces the admin role server-side', async () => {
    await expect(authenticate(req('GET', signedIn()), { role: 'admin' })).rejects.toMatchObject({ status: 403 });
    appUserRow = { ...baseUser, role: 'admin' };
    await expect(authenticate(req('GET', signedIn()), { role: 'admin' })).resolves.toBeTruthy();
  });

  it('forces a password change before anything else', async () => {
    appUserRow = { ...baseUser, must_change_password: true };
    await expect(authenticate(req('GET', signedIn()))).rejects.toMatchObject({ status: 403, message: 'PASSWORD_CHANGE_REQUIRED' });
    await expect(authenticate(req('GET', signedIn()), { allowPasswordChangeRequired: true })).resolves.toBeTruthy();
  });

  it('rejects cross-site writes even with a valid session', async () => {
    await expect(authenticate(req('POST', signedIn({ origin: 'https://evil.example' })))).rejects.toMatchObject({ status: 403 });
  });
});
