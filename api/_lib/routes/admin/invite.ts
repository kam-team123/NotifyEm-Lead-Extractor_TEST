import { clientIp, recordAudit } from '../../audit.js';
import { assertUsername, findUserByEmail, findUserByUsername } from '../../accounts.js';
import { withAuth } from '../../auth.js';
import { HttpError, json, readJson } from '../../http.js';
import { enforceRateLimit, RATE_LIMITS } from '../../rateLimit.js';
import { requireSupabase } from '../../supabase.js';

// POST /api/admin/invite   body: { username, email, role?, fullName? }   (admins only)
// Creates the account through Supabase Auth's invitation flow: the person gets an email link and
// chooses their own password. Admins never see or set it.

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST = withAuth(
  async (request, ctx) => {
    const ip = clientIp(request);
    await enforceRateLimit(RATE_LIMITS.invitePerAdmin, ctx.user.id);

    const body = await readJson<{ username?: unknown; email?: unknown; role?: unknown; fullName?: unknown }>(request);
    const username = assertUsername(body.username);
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!EMAIL_PATTERN.test(email)) throw new HttpError(400, 'Enter a valid email address.');
    const role = body.role === 'admin' ? 'admin' : 'user';
    const fullName = typeof body.fullName === 'string' ? body.fullName.trim().slice(0, 120) : '';

    if (await findUserByUsername(username)) throw new HttpError(409, `The username "${username}" is already taken.`);
    if (await findUserByEmail(email)) throw new HttpError(409, 'An account with that email already exists.');

    const sb = requireSupabase();
    const redirectTo = `${new URL(request.url).origin}/accept-invite`;
    const { data, error } = await sb.auth.admin.inviteUserByEmail(email, { redirectTo, data: { username } });
    if (error || !data.user) {
      await recordAudit({ action: 'admin.invite', outcome: 'failure', actorId: ctx.user.id, actorLabel: ctx.user.username, ip, metadata: { username, role, reason: error?.message ?? 'no user returned' } });
      throw new HttpError(400, `Could not send the invitation: ${error?.message ?? 'unknown error'}`);
    }

    const { data: row, error: insertError } = await sb
      .from('app_users')
      .insert({ id: data.user.id, username, login_email: email, role, full_name: fullName, created_by: ctx.user.id })
      .select('public_uid, username, role, login_email')
      .single();
    if (insertError || !row) {
      // Roll back the auth user so a retry can reuse the same email.
      await sb.auth.admin.deleteUser(data.user.id);
      await recordAudit({ action: 'admin.invite', outcome: 'failure', actorId: ctx.user.id, actorLabel: ctx.user.username, ip, metadata: { username, role, reason: insertError?.message } });
      throw new HttpError(500, 'The invitation could not be saved. Nothing was created; please try again.');
    }

    await recordAudit({ action: 'admin.invite', outcome: 'success', actorId: ctx.user.id, actorLabel: ctx.user.username, targetUserId: data.user.id, ip, metadata: { username, role } });
    return json({ user: { publicUid: row.public_uid, username: row.username, role: row.role, email: row.login_email } }, 201);
  },
  { role: 'admin' }
);
