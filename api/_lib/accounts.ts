import type { SessionUser } from '../../src/types/index.js';
import { passwordProblems, USERNAME_PATTERN } from '../../src/lib/passwordPolicy.js';
import type { AppUser } from './auth.js';
import { HttpError } from './http.js';
import { authClient, requireSupabase } from './supabase.js';

// Account operations shared by the /api/auth and /api/admin endpoints. Passwords are only ever handed
// to Supabase Auth; they are never stored, logged or returned by NotifyEm.

export const GENERIC_LOGIN_ERROR = 'Incorrect username or password.';

export function toSessionUser(user: AppUser): SessionUser {
  return {
    id: user.id,
    publicUid: user.public_uid,
    username: user.username,
    role: user.role,
    fullName: user.full_name,
    email: user.login_email,
    mustChangePassword: user.must_change_password
  };
}

export function assertUsername(username: unknown): string {
  if (typeof username !== 'string' || !USERNAME_PATTERN.test(username.trim())) {
    throw new HttpError(400, 'Usernames are 3–32 characters: letters, numbers, dot, dash or underscore, starting with a letter or number.');
  }
  return username.trim();
}

export function assertPassword(password: unknown, context: { username?: string; previous?: string } = {}): string {
  if (typeof password !== 'string') throw new HttpError(400, 'Enter a password.');
  const problems = passwordProblems(password, context);
  if (problems.length) throw new HttpError(400, problems.join(' '));
  return password;
}

export async function findUserByUsername(username: string): Promise<AppUser | null> {
  const { data, error } = await requireSupabase().from('app_users').select('*').eq('username', username).maybeSingle();
  if (error) throw new HttpError(500, 'Could not look up the account.');
  return (data as AppUser | null) ?? null;
}

export async function findUserByEmail(email: string): Promise<AppUser | null> {
  const { data, error } = await requireSupabase().from('app_users').select('*').eq('login_email', email.trim()).maybeSingle();
  if (error) throw new HttpError(500, 'Could not look up the account.');
  return (data as AppUser | null) ?? null;
}

/** Checks a password with Supabase Auth. Returns the new session, or null when the password is wrong. */
export async function signInWithPassword(email: string, password: string) {
  const { data, error } = await authClient().auth.signInWithPassword({ email, password });
  if (error || !data.session) return null;
  return data.session;
}

/** Sets a user's password through the Supabase Auth admin API (Supabase hashes it). */
export async function setPassword(userId: string, password: string): Promise<void> {
  const { error } = await requireSupabase().auth.admin.updateUserById(userId, { password });
  if (error) throw new HttpError(400, `Could not update the password: ${error.message}`);
}

export async function clearMustChangePassword(userId: string): Promise<void> {
  const { error } = await requireSupabase()
    .from('app_users')
    .update({ must_change_password: false, updated_at: new Date().toISOString() })
    .eq('id', userId);
  if (error) throw new HttpError(500, 'Password changed, but the account flag could not be cleared. Try signing in again.');
}
