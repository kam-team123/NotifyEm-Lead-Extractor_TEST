-- Assigns every existing record that has no owner to the initial administrator (public UID 001),
-- then makes owner_id required. Review before running. Run ONCE, AFTER:
--   1. supabase/0008_auth_foundation.sql
--   2. the admin bootstrap (npm run bootstrap:admin, see docs/AUTH_SETUP.md)
--
-- Nothing is deleted. Only rows where owner_id IS NULL are updated, so re-running is harmless and
-- never moves a record that already belongs to someone.

do $$
declare
  admin_id uuid;
  t text;
  moved integer;
begin
  select id into admin_id from public.app_users where public_uid = '001' and role = 'admin';
  if admin_id is null then
    raise exception 'No admin with public UID 001 found. Run the admin bootstrap first.';
  end if;

  foreach t in array array['leads', 'collections', 'campaign_drafts', 'salesforce_sync_events'] loop
    if to_regclass('public.' || t) is not null then
      execute format('update public.%I set owner_id = $1 where owner_id is null', t) using admin_id;
      get diagnostics moved = row_count;
      raise notice '%: % record(s) assigned to admin 001', t, moved;
      execute format('alter table public.%I alter column owner_id set not null', t);
    end if;
  end loop;

  -- The old global Salesforce settings become the admin's own settings. The original row stays in
  -- app_settings untouched (nothing reads it after Phase 4); remove it manually once verified.
  if to_regclass('public.app_settings') is not null then
    insert into public.user_settings (owner_id, key, value)
    select admin_id, key, value from public.app_settings
    on conflict (owner_id, key) do nothing;
  end if;
end $$;
