import { clientIp, recordAudit } from '../../audit.js';
import { findUserByUsername, GENERIC_LOGIN_ERROR, signInWithPassword, toSessionUser } from '../../accounts.js';
import { assertSameOrigin, isSecureRequest, sessionCookies, withCookies } from '../../auth.js';
import { handler, HttpError, json, readJson } from '../../http.js';
import { enforceRateLimit, RATE_LIMITS } from '../../rateLimit.js';
import { requireSupabase } from '../../supabase.js';
import { USERNAME_PATTERN } from '../../../../src/lib/passwordPolicy.js';

// POST /api/auth/login   body: { username, password }
// Username → account email → Supabase Auth password check → HttpOnly session cookies.
// Unknown usernames and wrong passwords get the same message and a similar response time.

const FAILURE_FLOOR_MS = 600;

export const POST = handler(async request => {
  const started = Date.now();
  assertSameOrigin(request);
  const body = await readJson<{ username?: unknown; password?: unknown }>(request);
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!username || !password) throw new HttpError(400, 'Enter your username and password.');

  const ip = clientIp(request);
  await enforceRateLimit(RATE_LIMITS.loginPerIp, ip);
  await enforceRateLimit(RATE_LIMITS.loginPerUsername, username);

  const account = USERNAME_PATTERN.test(username) ? await findUserByUsername(username) : null;
  const session = account ? await signInWithPassword(account.login_email, password) : null;

  if (!account || !session) {
    await recordAudit({
      action: 'auth.login',
      outcome: 'failure',
      actorId: account?.id ?? null,
      actorLabel: username,
      targetUserId: account?.id ?? null,
      ip,
      metadata: { reason: account ? 'wrong_password' : 'unknown_username' }
    });
    const wait = FAILURE_FLOOR_MS - (Date.now() - started);
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    throw new HttpError(401, GENERIC_LOGIN_ERROR);
  }

  if (account.status !== 'active') {
    await requireSupabase().auth.admin.signOut(session.access_token, 'local');
    await recordAudit({ action: 'auth.login', outcome: 'denied', actorId: account.id, actorLabel: account.username, targetUserId: account.id, ip, metadata: { reason: 'deactivated' } });
    throw new HttpError(403, 'This account has been deactivated. Contact your NotifyEm administrator.');
  }

  await recordAudit({
    action: 'auth.login',
    outcome: 'success',
    actorId: account.id,
    actorLabel: account.username,
    targetUserId: account.id,
    ip,
    metadata: { mustChangePassword: account.must_change_password }
  });
  return withCookies(json({ user: toSessionUser(account) }), sessionCookies(session, isSecureRequest(request)));
});
