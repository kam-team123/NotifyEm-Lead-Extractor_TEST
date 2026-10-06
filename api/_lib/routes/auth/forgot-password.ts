import { clientIp, recordAudit } from '../../audit.js';
import { findUserByEmail, findUserByUsername } from '../../accounts.js';
import { assertSameOrigin } from '../../auth.js';
import { handler, HttpError, json, readJson } from '../../http.js';
import { enforceRateLimit, RATE_LIMITS } from '../../rateLimit.js';
import { authClient } from '../../supabase.js';
import { USERNAME_PATTERN } from '../../../../src/lib/passwordPolicy.js';

// POST /api/auth/forgot-password   body: { identifier }  (username or email)
// Asks Supabase Auth to email a reset link. The answer is the same whether or not the account exists,
// so this endpoint cannot be used to discover usernames or emails.

const GENERIC_RESET_MESSAGE = 'If that account exists, a password reset link has been sent to its email address.';

export const POST = handler(async request => {
  assertSameOrigin(request);
  const body = await readJson<{ identifier?: unknown }>(request);
  const identifier = typeof body.identifier === 'string' ? body.identifier.trim() : '';
  if (!identifier) throw new HttpError(400, 'Enter your username or email.');

  const ip = clientIp(request);
  await enforceRateLimit(RATE_LIMITS.resetPerIp, ip);
  await enforceRateLimit(RATE_LIMITS.resetPerIp, `id:${identifier}`);

  const account = identifier.includes('@')
    ? await findUserByEmail(identifier)
    : USERNAME_PATTERN.test(identifier)
      ? await findUserByUsername(identifier)
      : null;

  if (account && account.status === 'active') {
    const redirectTo = `${new URL(request.url).origin}/reset-password`;
    const { error } = await authClient().auth.resetPasswordForEmail(account.login_email, { redirectTo });
    await recordAudit({
      action: 'auth.password_reset_request',
      outcome: error ? 'failure' : 'success',
      actorLabel: account.username,
      targetUserId: account.id,
      ip,
      metadata: error ? { reason: error.message, initiatedBy: 'self' } : { initiatedBy: 'self' }
    });
    if (error) console.error(`Password reset email failed: ${error.message}`);
  } else {
    await recordAudit({ action: 'auth.password_reset_request', outcome: 'failure', actorLabel: identifier.slice(0, 64), ip, metadata: { reason: account ? 'deactivated' : 'unknown_account' } });
  }

  return json({ message: GENERIC_RESET_MESSAGE });
});
