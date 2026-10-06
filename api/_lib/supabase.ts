import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from './http.js';

let client: SupabaseClient | null = null;

export function supabaseUrl(): string | undefined {
  return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
}

function serviceKey(): string | undefined {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl() && serviceKey());
}

export function getSupabase(): SupabaseClient | null {
  if (client) return client;
  const url = supabaseUrl();
  const key = serviceKey();
  if (!url || !key) return null;
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

/** The public anon key: safe to hold server-side, grants nothing without a user JWT (RLS). */
function anonKey(): string | undefined {
  return process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
}

export function isAuthConfigured(): boolean {
  return Boolean(supabaseUrl() && serviceKey() && anonKey());
}

function requireAuthConfig(): { url: string; key: string } {
  const url = supabaseUrl();
  const key = anonKey();
  if (!url || !key || !serviceKey()) {
    throw new HttpError(
      503,
      'Sign-in is not configured on the server. Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY in the Vercel environment variables.'
    );
  }
  return { url, key };
}

/** Client for Supabase Auth calls made on a user's behalf (sign-in, refresh, token checks). Never holds a session. */
export function authClient(): SupabaseClient {
  const { url, key } = requireAuthConfig();
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

/**
 * Database client that acts AS the signed-in user: every query runs under row-level security, so a user
 * can only touch rows the policies in 0008_auth_foundation.sql allow. Use this for all user-owned data.
 */
export function userClient(accessToken: string): SupabaseClient {
  const { url, key } = requireAuthConfig();
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } }
  });
}

export function requireSupabase(): SupabaseClient {
  const sb = getSupabase();
  if (!sb) {
    throw new HttpError(
      503,
      'Supabase is not configured on the server. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the Vercel project environment variables.'
    );
  }
  return sb;
}

const sourceIdCache = new Map<string, string>();

/** Resolves a data_sources row id by slug (rows are seeded by supabase/0003_app_api.sql). */
export async function sourceIdBySlug(sb: SupabaseClient, slug: string): Promise<string> {
  const cached = sourceIdCache.get(slug);
  if (cached) return cached;
  const { data, error } = await sb.from('data_sources').select('id').eq('slug', slug).maybeSingle();
  if (error) throw new HttpError(500, `Could not read data_sources: ${error.message}. Did you run supabase/0003_app_api.sql?`);
  if (!data) throw new HttpError(500, `Data source "${slug}" is missing. Run supabase/0003_app_api.sql in the Supabase SQL editor.`);
  sourceIdCache.set(slug, data.id);
  return data.id;
}

export async function markSourceStatus(
  sb: SupabaseClient,
  slug: string,
  patch: { is_connected?: boolean; is_live?: boolean; last_sync_at?: string; last_error?: string | null; record_count?: number }
): Promise<void> {
  await sb.from('data_sources').update({ ...patch, updated_at: new Date().toISOString() }).eq('slug', slug);
}
