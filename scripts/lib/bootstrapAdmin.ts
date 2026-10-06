import type { SupabaseClient } from '@supabase/supabase-js';

// Core of `npm run bootstrap:admin`, separated from the CLI so its idempotency can be tested.
// Never logs, returns or stores the password: it is only handed to Supabase Auth (which hashes it).

export const INITIAL_ADMIN = { publicUid: '001', username: 'Manny', role: 'admin' } as const;

export type BootstrapStatus = 'already_exists' | 'created' | 'linked_existing_auth_user';

export interface BootstrapResult {
  status: BootstrapStatus;
  userId: string;
  username: string;
}

export class BootstrapError extends Error {}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function findAuthUserByEmail(sb: SupabaseClient, email: string) {
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new BootstrapError(`Could not list Supabase Auth users: ${error.message}`);
    const match = data.users.find(u => (u.email || '').toLowerCase() === email);
    if (match) return match;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function audit(sb: SupabaseClient, outcome: 'success' | 'failure', targetUserId: string | null, metadata: Record<string, unknown>) {
  await sb.from('audit_events').insert({ action: 'bootstrap.admin', outcome, actor_label: 'bootstrap script', target_user_id: targetUserId, metadata });
}

export async function bootstrapAdmin(sb: SupabaseClient, input: { email: string; password: string }): Promise<BootstrapResult> {
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw new BootstrapError("Set BOOTSTRAP_ADMIN_EMAIL to the administrator's real email.");

  // 1. Already bootstrapped: change nothing, never touch the password.
  const { data: existing, error: lookupError } = await sb
    .from('app_users')
    .select('id, username, role')
    .eq('public_uid', INITIAL_ADMIN.publicUid)
    .maybeSingle();
  if (lookupError) {
    throw new BootstrapError(
      /does not exist|Could not find the table/i.test(lookupError.message)
        ? 'Table app_users is missing. Run supabase/0008_auth_foundation.sql in the Supabase SQL editor first.'
        : `Could not read app_users: ${lookupError.message}`
    );
  }
  if (existing) return { status: 'already_exists', userId: existing.id, username: existing.username };

  const { data: nameTaken } = await sb.from('app_users').select('public_uid').eq('username', INITIAL_ADMIN.username).maybeSingle();
  if (nameTaken) throw new BootstrapError(`Username "${INITIAL_ADMIN.username}" already belongs to UID ${nameTaken.public_uid}. Resolve that manually first.`);

  // 2. Reuse an auth user left by an interrupted run (password untouched), or create one.
  let authUser = await findAuthUserByEmail(sb, email);
  let created = false;
  if (!authUser) {
    if (input.password.length < 12) throw new BootstrapError('Set BOOTSTRAP_ADMIN_PASSWORD to a temporary password of at least 12 characters.');
    const { data, error } = await sb.auth.admin.createUser({
      email,
      password: input.password,
      email_confirm: true,
      user_metadata: { username: INITIAL_ADMIN.username }
    });
    if (error || !data.user) throw new BootstrapError(`Supabase Auth refused to create the user: ${error?.message ?? 'no user returned'}`);
    authUser = data.user;
    created = true;
  }

  // 3. Profile row with the reserved UID. The admin must replace the temporary password at first login.
  const { error: insertError } = await sb.from('app_users').insert({
    id: authUser.id,
    public_uid: INITIAL_ADMIN.publicUid,
    username: INITIAL_ADMIN.username,
    login_email: email,
    role: INITIAL_ADMIN.role,
    must_change_password: true
  });
  if (insertError) {
    if (created) await sb.auth.admin.deleteUser(authUser.id);
    await audit(sb, 'failure', null, { username: INITIAL_ADMIN.username, reason: insertError.message });
    throw new BootstrapError(`Could not create the admin profile: ${insertError.message}${created ? ' (the new auth user was removed again)' : ''}`);
  }

  await audit(sb, 'success', authUser.id, { username: INITIAL_ADMIN.username, publicUid: INITIAL_ADMIN.publicUid, createdAuthUser: created });
  return { status: created ? 'created' : 'linked_existing_auth_user', userId: authUser.id, username: INITIAL_ADMIN.username };
}
