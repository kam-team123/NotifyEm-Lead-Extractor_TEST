-- Notifyem — 0003: complete schema used by the /api server functions.
--
-- Works on an EMPTY database (creates every table it needs), and is also safe when
-- 0001_init.sql and/or 0002_init.sql were applied before. Every statement is idempotent,
-- so the file can be re-run. Run in the Supabase SQL editor (paste the whole file).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Base tables (skipped when they already exist; missing columns are added below).
-- ---------------------------------------------------------------------------
create table if not exists public.data_sources (
  id uuid primary key default gen_random_uuid(),
  source_name text not null,
  source_type text not null,
  provider text,
  country text default 'US',
  state text,
  county text,
  cost text,
  license_type text,
  api_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references public.data_sources(id) on delete set null,
  status text not null default 'active',
  verification_status text default 'unverified',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references public.properties(id) on delete cascade,
  source_id uuid references public.data_sources(id) on delete set null,
  listing_source text,
  listing_id text,
  listing_status text not null default 'active',
  list_price numeric(18,2),
  beds integer,
  baths numeric(4,2),
  square_feet integer,
  market_days integer,
  listing_url text,
  original_listing_date timestamptz,
  sold_date timestamptz,
  sold_price numeric(18,2),
  is_active boolean not null default true,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references public.properties(id) on delete set null,
  source_id uuid references public.data_sources(id) on delete set null,
  first_name text,
  last_name text,
  email text,
  phone text,
  lead_source text not null default 'manual',
  notes text,
  verification_status text default 'unverified',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- data_sources: one row per connector, looked up by slug.
-- ---------------------------------------------------------------------------
alter table public.data_sources add column if not exists slug text;
alter table public.data_sources add column if not exists access_type text default 'public';
alter table public.data_sources add column if not exists is_connected boolean not null default false;
alter table public.data_sources add column if not exists is_live boolean not null default false;
alter table public.data_sources add column if not exists last_sync_at timestamptz;
alter table public.data_sources add column if not exists last_error text;
alter table public.data_sources add column if not exists record_count integer not null default 0;

-- 0001 declared data_category NOT NULL without a default; relax it so new connectors can be added.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'data_sources' and column_name = 'data_category'
  ) then
    execute 'alter table public.data_sources alter column data_category drop not null';
  end if;
end $$;

-- Replace the source_type check so every connector type used by the app is allowed.
alter table public.data_sources drop constraint if exists data_sources_source_type_check;
alter table public.data_sources add constraint data_sources_source_type_check check (
  source_type in (
    'county_assessor', 'gis_portal', 'overture_maps', 'kaggle', 'rpr', 'mls',
    'manual', 'salesforce', 'osm', 'other'
  )
);

create unique index if not exists data_sources_slug_uidx on public.data_sources (slug);

insert into public.data_sources (slug, source_name, source_type, provider, country, cost, license_type, api_url, access_type, metadata)
values
  ('osm', 'OpenStreetMap', 'osm', 'OpenStreetMap contributors', 'US', 'free', 'ODbL', 'https://overpass-api.de/api/interpreter', 'public',
    '{"best_for":"Address-tagged buildings near a map search"}'),
  ('overture', 'Overture Maps Foundation', 'overture_maps', 'Overture Maps Foundation', 'Global', 'free', 'CDLA-Permissive-2.0 / ODbL', 'https://docs.overturemaps.org', 'public',
    '{"best_for":"Address points imported with scripts/import-overture.mjs"}'),
  ('kaggle', 'Kaggle Real Estate Datasets', 'kaggle', 'Kaggle', 'US', 'free', 'Dataset license', 'https://www.kaggle.com/datasets?search=real+estate', 'public',
    '{"best_for":"Historical listing snapshots imported from CSV"}'),
  ('rpr', 'Realtors Property Resource (RPR)', 'rpr', 'National Association of REALTORS', 'US', 'free with membership', 'Member access', 'https://www.narrpr.com', 'member',
    '{"best_for":"Manual research; RPR has no public data API"}'),
  ('mls', 'MLS (RESO Web API)', 'mls', 'Configured with MLS_* environment variables', 'US', 'licensed', 'IDX/VOW data license', null, 'licensed',
    '{"best_for":"Active, pending and new listings"}')
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- properties: normalised columns + external id for idempotent upserts.
-- ---------------------------------------------------------------------------
alter table public.properties add column if not exists external_id text;
alter table public.properties add column if not exists street_address text;
alter table public.properties add column if not exists full_address text;
alter table public.properties add column if not exists owner_name text;
alter table public.properties add column if not exists parcel_id text;
alter table public.properties add column if not exists county text;
alter table public.properties add column if not exists city text;
alter table public.properties add column if not exists state text;
alter table public.properties add column if not exists zip_code text;
alter table public.properties add column if not exists latitude double precision;
alter table public.properties add column if not exists longitude double precision;
alter table public.properties add column if not exists property_type text;
alter table public.properties add column if not exists bedrooms integer;
alter table public.properties add column if not exists bathrooms numeric(4,2);
alter table public.properties add column if not exists square_feet integer;
alter table public.properties add column if not exists year_built integer;
alter table public.properties add column if not exists tax_assessed_value numeric(18,2);
alter table public.properties add column if not exists market_value numeric(18,2);
alter table public.properties add column if not exists confidence_score numeric(5,2);
alter table public.properties add column if not exists source_url text;
alter table public.properties add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.properties add column if not exists verification_status text default 'unverified';
alter table public.properties add column if not exists updated_at timestamptz not null default now();
alter table public.data_sources add column if not exists updated_at timestamptz not null default now();
alter table public.listings add column if not exists updated_at timestamptz not null default now();
alter table public.leads add column if not exists updated_at timestamptz not null default now();

create unique index if not exists properties_source_external_uidx
  on public.properties (source_id, external_id);
create index if not exists idx_properties_lat_lng on public.properties (latitude, longitude);

-- ---------------------------------------------------------------------------
-- listings: fields shown on the Listings page.
-- ---------------------------------------------------------------------------
alter table public.listings add column if not exists previous_price numeric(18,2);
alter table public.listings add column if not exists photo_url text;
alter table public.listings add column if not exists agent_name text;
alter table public.listings add column if not exists office_name text;
alter table public.listings add column if not exists description text;
alter table public.listings add column if not exists property_type text;
alter table public.listings add column if not exists lot_size_acres numeric(12,4);
alter table public.listings add column if not exists is_test_data boolean not null default false;
alter table public.listings add column if not exists synced_to_salesforce boolean not null default false;
alter table public.listings add column if not exists source_modified_at timestamptz;

create unique index if not exists listings_source_listing_uidx
  on public.listings (source_id, listing_id);
create index if not exists idx_listings_status on public.listings (listing_status);

-- ---------------------------------------------------------------------------
-- collections (0002 only) and leads (0002 columns, plus collection_id).
-- ---------------------------------------------------------------------------
create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  name text not null,
  description text,
  target_states text[] default '{}',
  color_tag text default 'cyan',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

create index if not exists idx_leads_pipeline_state on public.leads (pipeline_state);

-- ---------------------------------------------------------------------------
-- Row Level Security: the browser never talks to Supabase directly. All reads and
-- writes go through the Vercel /api functions using the service-role key, which
-- bypasses RLS. Enabling RLS with no policies blocks the public anon key.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'data_sources', 'properties', 'listings', 'leads', 'collections',
    'property_owners', 'assessor_records', 'building_footprints', 'address_points',
    'data_sync_jobs', 'profiles', 'collection_items', 'campaigns',
    'salesforce_sync_logs', 'source_status'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);
    end if;
  end loop;
end $$;
