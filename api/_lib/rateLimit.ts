import { HttpError } from './http.js';
import { getSupabase } from './supabase.js';

// Sliding-window limits for sign-in, password reset and invitation endpoints, stored in
// public.auth_attempts so they hold across Vercel function instances. Bucket keys are SHA-256 hashed
// so usernames and IPs are not stored in clear text. Supabase Auth applies its own limits as well.

export interface RateLimitRule {
  /** e.g. 'login:ip' */
  name: string;
  limit: number;
  windowSeconds: number;
}

export const RATE_LIMITS = {
  loginPerIp: { name: 'login:ip', limit: 20, windowSeconds: 15 * 60 },
  loginPerUsername: { name: 'login:user', limit: 8, windowSeconds: 15 * 60 },
  resetPerIp: { name: 'reset:ip', limit: 5, windowSeconds: 60 * 60 },
  invitePerAdmin: { name: 'invite:admin', limit: 30, windowSeconds: 60 * 60 }
} satisfies Record<string, RateLimitRule>;

export async function bucketKey(rule: RateLimitRule, subject: string): Promise<string> {
  const data = new TextEncoder().encode(`${rule.name}|${subject.trim().toLowerCase()}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${rule.name}:${hex}`;
}

/**
 * Counts this attempt and throws 429 when the subject is over the limit. Fails closed: if the attempt
 * cannot be recorded, the request is refused rather than allowed through unlimited.
 */
export async function enforceRateLimit(rule: RateLimitRule, subject: string | null | undefined): Promise<void> {
  if (!subject) return;
  const sb = getSupabase();
  if (!sb) throw new HttpError(503, 'Sign-in is temporarily unavailable.');

  const bucket = await bucketKey(rule, subject);
  const since = new Date(Date.now() - rule.windowSeconds * 1000).toISOString();

  const { error: insertError } = await sb.from('auth_attempts').insert({ bucket });
  if (insertError) throw new HttpError(503, 'Sign-in is temporarily unavailable.');

  const { count, error } = await sb
    .from('auth_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('bucket', bucket)
    .gte('attempted_at', since);
  if (error) throw new HttpError(503, 'Sign-in is temporarily unavailable.');

  // Occasional cleanup keeps the table small; failures here don't matter.
  if (Math.random() < 0.02) {
    void sb.from('auth_attempts').delete().lt('attempted_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString());
  }

  if ((count ?? 0) > rule.limit) {
    const minutes = Math.ceil(rule.windowSeconds / 60);
    throw new HttpError(429, `Too many attempts. Please wait up to ${minutes} minutes and try again.`);
  }
}
