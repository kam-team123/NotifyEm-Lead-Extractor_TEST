import { clientIp, recordAudit } from '../../audit.js';
import { assertPassword, clearMustChangePassword, setPassword, signInWithPassword, toSessionUser } from '../../accounts.js';
import { isSecureRequest, sessionCookies, withAuth, withCookies } from '../../auth.js';
import { HttpError, json, readJson } from '../../http.js';
import { enforceRateLimit, RATE_LIMITS } from '../../rateLimit.js';
import { requireSupabase } from '../../supabase.js';

// POST /api/auth/change-password   body: { currentPassword, newPassword }
// Used for the forced first-login change and for normal changes. Re-checks the current password with
// Supabase Auth, sets the new one, signs out every other session and issues fresh cookies.

export const POST = withAuth(
  async (request, ctx) => {
    const ip = clientIp(request);
    const body = await readJson<{ currentPassword?: unknown; newPassword?: unknown }>(request);
    const current = typeof body.currentPassword === 'string' ? body.currentPassword : '';
    if (!current) throw new HttpError(400, 'Enter your current password.');
    await enforceRateLimit(RATE_LIMITS.loginPerUsername, ctx.user.username);

    if (!(await signInWithPassword(ctx.user.login_email, current))) {
      await recordAudit({ action: 'auth.password_change', outcome: 'failure', actorId: ctx.user.id, actorLabel: ctx.user.username, targetUserId: ctx.user.id, ip, metadata: { reason: 'wrong_current_password' } });
      throw new HttpError(400, 'Your current password is incorrect.');
    }

    const next = assertPassword(body.newPassword, { username: ctx.user.username, previous: current });
    await setPassword(ctx.user.id, next);
    await clearMustChangePassword(ctx.user.id);

    const session = await signInWithPassword(ctx.user.login_email, next);
    if (!session) throw new HttpError(500, 'Password changed. Please sign in again with your new password.');
    await requireSupabase().auth.admin.signOut(session.access_token, 'others');

    await recordAudit({
      action: 'auth.password_change',
      outcome: 'success',
      actorId: ctx.user.id,
      actorLabel: ctx.user.username,
      targetUserId: ctx.user.id,
      ip,
      metadata: { wasTemporary: ctx.user.must_change_password }
    });
    const user = toSessionUser({ ...ctx.user, must_change_password: false });
    return withCookies(json({ user }), sessionCookies(session, isSecureRequest(request)));
  },
  { allowPasswordChangeRequired: true }
);
