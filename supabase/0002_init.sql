-- Notifyem — schema aligned to actual app structure
-- Use in Supabase SQL editor or: supabase db push

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.data_sources (
  id uuid primary key default gen_random_uuid(),
  source_name text not null,
  source_type text not null check (
    source_type in (
      'county_assessor',
      'gis_portal',
      'overture_maps',
      'kaggle',
      'rpr',
      'mls',
      'manual',
      'salesforce',
      'other'
    )
  ),
  provider text,
  country text default 'US',
  state text,
  county text,
  access_type text not null default 'public',
  cost text not null default 'free',
  license_type text,
  api_url text,
  is_connected boolean not null default false,
  is_live boolean not null default false,
  last_sync_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references public.data_sources(id) on delete set null,
  owner_name text,
  parcel_id text,
  county text,
  city text,
  state text,
  zip_code text,
  street_address text,
  latitude double precision,
  longitude double precision,
  property_type text,
  bedrooms integer,
  bathrooms numeric(4,2),
  square_feet integer,
  lot_size_sqft integer,
  year_built integer,
  tax_assessed_value numeric(18,2),
  market_value numeric(18,2),
  status text not null default 'active',
  verification_status text not null default 'unverified',
  confidence_score numeric(5,2),
  source_url text,
  metadata jsonb not null default '{}'::jsonb,
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
  user_id uuid references public.profiles(id) on delete set null,
  property_id uuid references public.properties(id) on delete set null,
  source_id uuid references public.data_sources(id) on delete set null,
  first_name text,
  last_name text,
  email text,
  phone text,
  brokerage_or_company text,
  lead_category text,
  lead_role text,
  lead_source text not null default 'manual',
  pipeline_state text not null default 'New',
  target_budget_or_price numeric(18,2),
  street text,
  city text,
  state text,
  postal_code text,
  latitude double precision,
  longitude double precision,
  notes text,
  source_url text,
  verification_status text not null default 'unverified',
  confidence_score numeric(5,2),
  score_reason text,
  salesforce_sync_status text default 'Not Synced',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  name text not null,
  description text,
  target_states text[] default '{}',
  color_tag text default 'cyan',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.collection_items (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid references public.collections(id) on delete cascade,
  property_id uuid references public.properties(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (collection_id, property_id),
  unique (collection_id, lead_id)
);

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  name text not null,
  objective text,
  budget numeric(18,2),
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.salesforce_sync_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  sync_type text not null,
  status text not null default 'pending',
  payload jsonb default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists idx_properties_state_city
on public.properties (state, city);

create index if not exists idx_properties_lat_lng
on public.properties (latitude, longitude);

create index if not exists idx_listings_property_id
on public.listings (property_id);

create index if not exists idx_leads_pipeline_state
on public.leads (pipeline_state);

create index if not exists idx_leads_state_city
on public.leads (state, city);

create index if not exists idx_data_sources_connected
on public.data_sources (is_connected, is_live);

create table if not exists public.source_status (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references public.data_sources(id) on delete cascade,
  status text not null default 'not_connected',
  last_success_at timestamptz,
  last_error_at timestamptz,
  error_message text,
  records_processed integer default 0,
  created_at timestamptz not null default now()
);