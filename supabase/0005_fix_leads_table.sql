-- Make public.leads match what /api/leads reads and writes.
--
-- Some projects already had a "leads" table from an earlier facility-outreach schema
-- (facility_name, category enum, status enum, ...). 0003 used "create table if not exists",
-- so that table was kept and only part of the NotifyEm columns were added: loading leads failed
-- with "column leads.first_name does not exist", and inserts failed on the required legacy columns.
--
-- Additive and safe to re-run: nothing is dropped, legacy columns just stop being required.

alter table public.leads add column if not exists first_name text;
alter table public.leads add column if not exists last_name text;
alter table public.leads add column if not exists email text;
alter table public.leads add column if not exists phone text;
alter table public.leads add column if not exists notes text;
alter table public.leads add column if not exists lead_source text not null default 'Manual Intake';
alter table public.leads add column if not exists verification_status text not null default 'unverified';
alter table public.leads add column if not exists brokerage_or_company text;
alter table public.leads add column if not exists lead_category text;
alter table public.leads add column if not exists lead_role text;
alter table public.leads add column if not exists pipeline_state text not null default 'New';
alter table public.leads add column if not exists target_budget_or_price numeric(18,2);
alter table public.leads add column if not exists street text;
alter table public.leads add column if not exists city text;
alter table public.leads add column if not exists state text;
alter table public.leads add column if not exists postal_code text;
alter table public.leads add column if not exists latitude double precision;
alter table public.leads add column if not exists longitude double precision;
alter table public.leads add column if not exists source_url text;
alter table public.leads add column if not exists confidence_score numeric(5,2);
alter table public.leads add column if not exists score_reason text;
alter table public.leads add column if not exists salesforce_sync_status text default 'Not Synced';
alter table public.leads add column if not exists collection_id uuid references public.collections(id) on delete set null;
alter table public.leads add column if not exists created_at timestamptz not null default now();
alter table public.leads add column if not exists updated_at timestamptz not null default now();

-- Legacy columns NotifyEm never sends: keep them, but stop requiring them.
do $$
declare
  col text;
begin
  foreach col in array array['facility_name', 'category', 'status', 'source', 'unsubscribed', 'lead_status'] loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'leads' and column_name = col and is_nullable = 'NO'
    ) then
      execute format('alter table public.leads alter column %I drop not null', col);
    end if;
  end loop;
end $$;

create index if not exists idx_leads_pipeline_state on public.leads (pipeline_state);

-- PostgREST caches the schema; reload it so the new columns are usable immediately.
notify pgrst, 'reload schema';
