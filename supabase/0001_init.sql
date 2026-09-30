-- Notifyem — real property + source-aware schema
-- Run with: supabase db push
-- or paste directly into the Supabase SQL editor

create extension if not exists pgcrypto;
create extension if not exists postgis;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

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
      'other'
    )
  ),
  data_category text not null check (
    data_category in (
      'property_record',
      'parcel_geometry',
      'building_footprint',
      'address_point',
      'listing',
      'owner_record',
      'lead',
      'market_data'
    )
  ),
  provider text,
  country text default 'US',
  state text,
  county text,
  cost text,
  license_type text,
  api_url text,
  update_frequency text,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger data_sources_set_updated_at
before update on public.data_sources
for each row
execute function public.set_updated_at();

create table if not exists public.property_owners (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references public.data_sources(id) on delete set null,
  owner_name text,
  owner_type text,
  mailing_address text,
  city text,
  state text,
  postal_code text,
  country text default 'US',
  tax_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger property_owners_set_updated_at
before update on public.property_owners
for each row
execute function public.set_updated_at();

create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references public.data_sources(id) on delete set null,
  owner_id uuid references public.property_owners(id) on delete set null,

  parcel_id text,
  county_fips text,
  state text,
  county text,
  city text,
  zip_code text,
  neighborhood text,

  street_number text,
  street_name text,
  street_suffix text,
  unit text,
  full_address text,

  latitude double precision,
  longitude double precision,
  geom geometry(Point, 4326),

  property_type text,
  bedrooms integer,
  bathrooms numeric(4,2),
  square_feet integer,
  lot_size_sqft integer,
  year_built integer,
  legal_description text,
  subdivision text,
  tax_assessed_value numeric(18,2),
  market_value numeric(18,2),
  tax_amount numeric(18,2),

  status text not null default 'active',
  last_seen_at timestamptz,
  verification_status text default 'unverified',
  confidence_score numeric(5,2),
  source_notes text,
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger properties_set_updated_at
before update on public.properties
for each row
execute function public.set_updated_at();

create table if not exists public.assessor_records (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references public.properties(id) on delete cascade,
  source_id uuid references public.data_sources(id) on delete set null,

  parcel_number text,
  legal_description text,
  tax_year integer,
  assessed_value numeric(18,2),
  taxable_value numeric(18,2),
  owner_name text,
  deed_book text,
  deed_page text,
  land_use_code text,
  zoning text,
  tax_status text,
  county_gis_url text,
  raw_payload jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger assessor_records_set_updated_at
before update on public.assessor_records
for each row
execute function public.set_updated_at();

create table if not exists public.building_footprints (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references public.properties(id) on delete cascade,
  source_id uuid references public.data_sources(id) on delete set null,

  footprint_geom geometry(Geometry, 4326),
  building_area_sqft integer,
  building_height_ft numeric(8,2),
  footprint_type text,
  source_url text,
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger building_footprints_set_updated_at
before update on public.building_footprints
for each row
execute function public.set_updated_at();

create table if not exists public.address_points (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references public.properties(id) on delete cascade,
  source_id uuid references public.data_sources(id) on delete set null,

  address_text text,
  latitude double precision,
  longitude double precision,
  geom geometry(Point, 4326),
  address_confidence numeric(5,2),
  source_url text,
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger address_points_set_updated_at
before update on public.address_points
for each row
execute function public.set_updated_at();

create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references public.properties(id) on delete set null,
  source_id uuid references public.data_sources(id) on delete set null,

  listing_id text,
  listing_source text,
  listing_status text not null default 'active',
  list_price numeric(18,2),
  beds integer,
  baths numeric(4,2),
  square_feet integer,
  lot_size_sqft integer,
  market_days integer,
  mls_name text,
  listing_url text,
  original_listing_date timestamptz,
  sold_date timestamptz,
  sold_price numeric(18,2),
  is_active boolean not null default true,
  raw_payload jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger listings_set_updated_at
before update on public.listings
for each row
execute function public.set_updated_at();

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references public.properties(id) on delete set null,
  source_id uuid references public.data_sources(id) on delete set null,

  first_name text,
  last_name text,
  email text,
  phone text,
  lead_source text not null default 'manual',
  lead_status text not null default 'new',
  score numeric(5,2),
  confidence numeric(5,2),
  verification_status text default 'unverified',
  notes text,
  provenance text,
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger leads_set_updated_at
before update on public.leads
for each row
execute function public.set_updated_at();

create table if not exists public.data_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references public.data_sources(id) on delete set null,
  job_name text not null,
  status text not null default 'pending',
  started_at timestamptz,
  finished_at timestamptz,
  records_processed integer default 0,
  records_inserted integer default 0,
  records_updated integer default 0,
  records_failed integer default 0,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger data_sync_jobs_set_updated_at
before update on public.data_sync_jobs
for each row
execute function public.set_updated_at();

create index if not exists idx_properties_state_county_city
on public.properties (state, county, city);

create index if not exists idx_properties_lat_lng
on public.properties (latitude, longitude);

create index if not exists idx_properties_source_id
on public.properties (source_id);

create index if not exists idx_assessor_records_property_id
on public.assessor_records (property_id);

create index if not exists idx_listings_property_id
on public.listings (property_id);

create index if not exists idx_listings_status
on public.listings (listing_status);

create index if not exists idx_leads_status
on public.leads (lead_status);

create index if not exists idx_data_sources_type
on public.data_sources (source_type);

-- Example source seed data
insert into public.data_sources (
  source_name,
  source_type,
  data_category,
  provider,
  country,
  state,
  county,
  cost,
  license_type,
  api_url,
  update_frequency,
  is_active,
  metadata
) values
  ('County Tax Assessor / GIS Portals', 'county_assessor', 'property_record', 'County Assessor Offices', 'US', null, null, 'Free', 'Public', null, 'Daily to Weekly', true, '{"coverage":"All 50 states","best_for":"Public property records, ownership details, tax history, parcel geometry","notes":"Available through county tax assessor and GIS portals across the U.S."}'),
  ('County GIS Parcel Layers', 'gis_portal', 'parcel_geometry', 'County GIS / Open Data Portals', 'US', null, null, 'Free', 'Public', null, 'Daily to Weekly', true, '{"coverage":"All 50 states","best_for":"Parcel boundaries, zoning, lot lines, geojson shapefiles","notes":"Useful for boundary mapping and parcel-level property analysis."}'),
  ('Overture Maps Foundation', 'overture_maps', 'building_footprint', 'Overture Maps Foundation', 'Global', null, null, 'Free', 'Open', 'https://overturemaps.org', 'Regularly updated', true, '{"coverage":"Global","best_for":"Building footprints, address points, POI, base map context","notes":"Open-source global base data used for mapping, footprint context, and address validation."}'),
  ('Kaggle Real Estate Datasets', 'kaggle', 'market_data', 'Kaggle', 'US', null, null, 'Free', 'Dataset License', null, 'Variable', true, '{"coverage":"National and state-level sample datasets","best_for":"Historical listings, property specs, geography, heatmap prototyping","notes":"Ideal for testing, initial dashboards, and early market analysis before production data integration."}'),
  ('Realtors Property Resource (RPR)', 'rpr', 'property_record', 'National Association of REALTORS® / RPR', 'US', null, null, 'Free', 'Member Access', null, 'Daily', true, '{"coverage":"All 50 states","best_for":"Nationwide property records, active listing data, tax assessments, neighborhood demographics","notes":"Free to licensed Realtors through RPR membership and useful for US-wide lead and property research."}'),
  ('US County Open Property Data', 'other', 'property_record', 'County Open Data Portals', 'US', null, null, 'Free', 'Public', null, 'Variable', true, '{"coverage":"All 50 states","best_for":"Public assessments, parcel records, owner info, local property history","notes":"This is the public data layer used for state-by-state property discovery and local validation."}')
on conflict do nothing;