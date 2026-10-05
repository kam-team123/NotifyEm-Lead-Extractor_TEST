-- Registers Realtor.com (via RealtyAPI) as a data source so /api/map-search can save its listings
-- into public.properties. Run once in the Supabase SQL editor after 0003_app_api.sql.
insert into public.data_sources (slug, source_name, source_type, provider, country, cost, license_type, api_url, access_type, metadata)
values
  ('realtor', 'Realtor.com (RealtyAPI)', 'other', 'RealtyAPI', 'US', 'paid credits', 'RealtyAPI terms', 'https://realtor.realtyapi.io', 'licensed',
    '{"best_for":"Live for-sale listings with price, beds/baths and listing agent around a map search"}')
on conflict (slug) do nothing;
