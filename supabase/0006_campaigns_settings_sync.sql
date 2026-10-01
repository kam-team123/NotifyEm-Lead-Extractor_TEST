-- Persistence for AI Campaigns, Salesforce settings and the Salesforce audit trail.
--
-- New table names on purpose: "campaigns" and "salesforce_sync_logs" already exist in some
-- projects with unrelated shapes (see 0002 / the legacy schema fixed in 0005), and
-- "create table if not exists" would silently keep those.

-- ---------------------------------------------------------------------------
-- campaign_drafts: one row per AI Campaign draft and its review state.
-- ---------------------------------------------------------------------------
create table if not exists public.campaign_drafts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  campaign_type text not null,
  target_audience text not null default '',
  subject text not null default '',
  body_content text not null default '',
  status text not null default 'Pending Approval' check (
    status in ('Pending Approval', 'Needs Edit', 'Approved', 'Delivered', 'Rejected')
  ),
  approver_notes text,
  test_send_address text not null default '',
  recipient_lead_ids uuid[] not null default '{}',
  scheduled_date timestamptz,
  sent_at timestamptz,
  salesforce_campaign_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_campaign_drafts_status on public.campaign_drafts (status);

-- ---------------------------------------------------------------------------
-- app_settings: small key/value store (key 'salesforce' holds the non-secret
-- Connected App settings; secrets stay in server env vars, never here).
-- ---------------------------------------------------------------------------
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- salesforce_sync_events: audit trail of every Salesforce sync attempt.
-- ---------------------------------------------------------------------------
create table if not exists public.salesforce_sync_events (
  id uuid primary key default gen_random_uuid(),
  operation text not null,
  status text not null check (status in ('SUCCESS', 'WARNING', 'FAILED')),
  records_processed integer not null default 0,
  records_succeeded integer not null default 0,
  records_failed integer not null default 0,
  salesforce_ids text[] not null default '{}',
  message text not null default '',
  duration_ms integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_salesforce_sync_events_created on public.salesforce_sync_events (created_at desc);

-- Same policy as 0003: only the server (service role) reads and writes these tables.
alter table public.campaign_drafts enable row level security;
alter table public.app_settings enable row level security;
alter table public.salesforce_sync_events enable row level security;

notify pgrst, 'reload schema';
