-- Authentication, roles, per-user ownership and audit log (Phase 2 of the auth work).
--
-- Identity lives in Supabase Auth (auth.users): password hashing, sessions, resets and invitations are
-- handled there. This migration only adds NotifyEm's profile/role layer and row-level security.
--
-- Safe to re-run. It deletes nothing and does not change existing rows: owner_id is added as a nullable
-- column, and existing records are assigned to the first admin later by 0009_assign_existing_records.sql
-- (run only after the admin bootstrap, see docs/AUTH_SETUP.md).
--
-- Access model:
--   * /api functions query user-owned tables AS THE SIGNED-IN USER (anon key + the user's JWT), so the
--     policies below are what actually isolate one user's data from another's.
--   * The service-role key (bypasses RLS) is used only for admin actions, audit writes, the bootstrap
--     script and the shared property cache.

create extension if not exists citext;

-- ---------------------------------------------------------------------------
-- app_users: one row per Supabase Auth user. id = auth.users.id (immutable; used for all
-- relationships and authorization). public_uid is display-only ("001", "002", ...).
-- ---------------------------------------------------------------------------
-- Starts at 2: UID 001 is reserved for the initial administrator created by the bootstrap script.
create sequence if not exists public.app_user_uid_seq start with 2;

create table if not exists public.app_users (
  id uuid primary key references auth.users (id) on delete cascade,
  public_uid text not null unique default lpad(nextval('public.app_user_uid_seq')::text, 3, '0'),
  username citext not null unique check (username ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$'),
  -- Copy of the auth email, used server-side to turn a username into a sign-in. Never sent to other users.
  login_email citext not null unique,
  role text not null default 'user' check (role in ('admin', 'user')),
  status text not null default 'active' check (status in ('active', 'deactivated')),
  must_change_password boolean not null default false,
  -- Agent profile (editable by the user)
  full_name text not null default '',
  brokerage text not null default '',
  job_title text not null default '',
  contact_email text not null default '',
  phone text not null default '',
  service_area text not null default '',
  brand_voice text not null default '',
  marketing_preferences jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter sequence public.app_user_uid_seq owned by public.app_users.public_uid;

/** True when the calling user is an active admin. SECURITY DEFINER so policies can call it without recursion. */
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.app_users
    where id = auth.uid() and role = 'admin' and status = 'active'
  );
$$;

/** True when the calling user exists and is not deactivated (a deactivated user's JWT stays valid until it expires). */
create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.app_users where id = auth.uid() and status = 'active');
$$;

revoke all on function public.is_admin() from public, anon;
revoke all on function public.is_active_user() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;
grant execute on function public.is_active_user() to authenticated, service_role;

alter table public.app_users enable row level security;

drop policy if exists app_users_select_self_or_admin on public.app_users;
create policy app_users_select_self_or_admin on public.app_users
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists app_users_update_self on public.app_users;
create policy app_users_update_self on public.app_users
  for update to authenticated
  using (id = auth.uid() and status = 'active')
  with check (id = auth.uid() and status = 'active');

-- Users may only edit their own profile fields. role, status, username, public_uid, login_email and
-- must_change_password have no UPDATE grant, so a user cannot promote or reactivate themselves even
-- with a hand-crafted request. Those columns change only through the server (service role).
revoke all on public.app_users from anon, authenticated;
grant select on public.app_users to authenticated;
grant update (full_name, brokerage, job_title, contact_email, phone, service_area, brand_voice, marketing_preferences, updated_at)
  on public.app_users to authenticated;

-- ---------------------------------------------------------------------------
-- audit_events: append-only security log. Readable by admins only; written only by the server.
-- Never contains passwords, tokens, API keys or session values (the server strips them).
-- ---------------------------------------------------------------------------
create table if not exists public.audit_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  actor_label text not null default '',
  target_user_id uuid,
  action text not null,
  outcome text not null check (outcome in ('success', 'failure', 'denied')),
  ip text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_audit_events_occurred on public.audit_events (occurred_at desc);
create index if not exists idx_audit_events_target on public.audit_events (target_user_id, occurred_at desc);

create or replace function public.audit_events_block_changes()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_events is append-only';
end;
$$;

drop trigger if exists audit_events_append_only on public.audit_events;
create trigger audit_events_append_only
  before update or delete on public.audit_events
  for each row execute function public.audit_events_block_changes();

alter table public.audit_events enable row level security;

drop policy if exists audit_events_admin_read on public.audit_events;
create policy audit_events_admin_read on public.audit_events
  for select to authenticated
  using (public.is_admin());

revoke all on public.audit_events from anon, authenticated;
grant select on public.audit_events to authenticated;

-- ---------------------------------------------------------------------------
-- auth_attempts: sliding-window rate limiting for login / reset / invitation endpoints.
-- Server-only (no grants to anon/authenticated). Keys are hashed by the server, never raw usernames.
-- ---------------------------------------------------------------------------
create table if not exists public.auth_attempts (
  id bigint generated always as identity primary key,
  bucket text not null,
  attempted_at timestamptz not null default now()
);

create index if not exists idx_auth_attempts_bucket on public.auth_attempts (bucket, attempted_at desc);

alter table public.auth_attempts enable row level security;
revoke all on public.auth_attempts from anon, authenticated;

-- ---------------------------------------------------------------------------
-- user_settings: per-user key/value settings (replaces the global app_settings rows per user).
-- ---------------------------------------------------------------------------
create table if not exists public.user_settings (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  key text not null,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (owner_id, key)
);

-- ---------------------------------------------------------------------------
-- user_integrations: each user's provider connections. The secret is stored encrypted by the server
-- (secret_ciphertext) and is never readable by the browser or by the user's own database session.
-- ---------------------------------------------------------------------------
create table if not exists public.user_integrations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  provider text not null,
  config jsonb not null default '{}'::jsonb,
  secret_ciphertext text,
  secret_hint text,
  status text not null default 'not_configured' check (status in ('not_configured', 'connected', 'error')),
  last_tested_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, provider)
);

-- ---------------------------------------------------------------------------
-- owner_id on existing user-owned tables. Nullable for now; 0009 backfills and sets NOT NULL.
-- Existing user_id columns (from 0002/0003, not linked to auth.users) are left untouched.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['leads', 'collections', 'campaign_drafts', 'salesforce_sync_events'] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I add column if not exists owner_id uuid default auth.uid() references auth.users (id) on delete restrict', t);
      execute format('create index if not exists %I on public.%I (owner_id)', 'idx_' || t || '_owner', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Owner-only policies on every user-owned table.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['leads', 'collections', 'campaign_drafts', 'salesforce_sync_events', 'user_settings', 'user_integrations'] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);
      execute format('drop policy if exists %I on public.%I', t || '_owner_all', t);
      execute format(
        'create policy %I on public.%I for all to authenticated using (owner_id = auth.uid() and public.is_active_user()) with check (owner_id = auth.uid() and public.is_active_user())',
        t || '_owner_all', t
      );
      execute format('revoke all on public.%I from anon', t);
      execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    end if;
  end loop;
end $$;

-- The encrypted secret never leaves the server: the owner's own session cannot select it.
revoke select on public.user_integrations from authenticated;
grant select (id, owner_id, provider, config, secret_hint, status, last_tested_at, last_error, created_at, updated_at)
  on public.user_integrations to authenticated;

-- ---------------------------------------------------------------------------
-- Shared reference data (map-search cache, imports, MLS): any signed-in user may read; only the
-- server writes. Anonymous visitors get nothing.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['properties', 'listings', 'data_sources'] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);
      execute format('drop policy if exists %I on public.%I', t || '_authenticated_read', t);
      execute format('create policy %I on public.%I for select to authenticated using (public.is_active_user())', t || '_authenticated_read', t);
      execute format('revoke all on public.%I from anon', t);
      execute format('revoke insert, update, delete on public.%I from authenticated', t);
      execute format('grant select on public.%I to authenticated', t);
    end if;
  end loop;
end $$;
