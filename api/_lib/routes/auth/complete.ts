import { clientIp, recordAudit } from '../../audit.js';
import { assertPassword, clearMustChangePassword, setPassword, signInWithPassword, toSessionUser } from '../../accounts.js';
import { assertSameOrigin, isSecureRequest, loadAppUser, sessionCookies, withCookies } from '../../auth.js';
import { handler, HttpError, json, readJson } from '../../http.js';
import { enforceRateLimit, RATE_LIMITS } from '../../rateLimit.js';
import { authClient, requireSupabase } from '../../supabase.js';

// POST /api/auth/complete   body: { tokenHash, type: 'invite' | 'recovery', newPassword }
// Finishes an invitation or a password reset from the emailed link. The one-time token is verified by
// Supabase Auth (verifyOtp); the user then chooses their own password and is signed in.

const LINK_ERROR = 'This link is invalid or has expired. Ask for a new one.';

export const POST = handler(async request => {
  assertSameOrigin(request);
  const body = await readJson<{ tokenHash?: unknown; type?: unknown; newPassword?: unknown }>(request);
  const tokenHash = typeof body.tokenHash === 'string' ? body.tokenHash.trim() : '';
  const type = body.type === 'invite' || body.type === 'recovery' ? body.type : null;
  if (!tokenHash || !type) throw new HttpError(400, LINK_ERROR);

  const ip = clientIp(request);
  await enforceRateLimit(RATE_LIMITS.resetPerIp, ip);

  const { data, error } = await authClient().auth.verifyOtp({ token_hash: tokenHash, type });
  if (error || !data.user || !data.session) {
    await recordAudit({ action: type === 'invite' ? 'auth.invite_accept' : 'auth.password_reset', outcome: 'failure', ip, metadata: { reason: 'invalid_or_expired_link' } });
    throw new HttpError(400, LINK_ERROR);
  }

  const account = await loadAppUser(data.user.id);
  if (!account || account.status !== 'active') {
    await requireSupabase().auth.admin.signOut(data.session.access_token, 'local');
    throw new HttpError(403, account ? 'This account has been deactivated.' : 'This sign-in has no NotifyEm account. Ask an administrator for an invitation.');
  }

  const password = assertPassword(body.newPassword, { username: account.username });
  await setPassword(account.id, password);
  await clearMustChangePassword(account.id);

  const session = await signInWithPassword(account.login_email, password);
  if (!session) throw new HttpError(500, 'Password saved. Please sign in with your new password.');
  await requireSupabase().auth.admin.signOut(session.access_token, 'others');

  await recordAudit({
    action: type === 'invite' ? 'auth.invite_accept' : 'auth.password_reset',
    outcome: 'success',
    actorId: account.id,
    actorLabel: account.username,
    targetUserId: account.id,
    ip
  });
  return withCookies(json({ user: toSessionUser({ ...account, must_change_password: false }) }), sessionCookies(session, isSecureRequest(request)));
});
