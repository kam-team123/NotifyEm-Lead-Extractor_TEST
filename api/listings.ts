import type { PropertyListing } from '../src/types/index.js';
import { handler, json } from './_lib/http.js';
import { requireSupabase } from './_lib/supabase.js';
import { readMlsConfig } from './_lib/reso.js';
import { stateCode } from './_lib/geo.js';

// GET /api/listings?state=TX&source=mls|kaggle&includeInactive=1&limit=200&offset=0

interface ListingRow {
  id: string;
  listing_id: string | null;
  listing_status: string;
  list_price: number | null;
  previous_price: number | null;
  beds: number | null;
  baths: number | null;
  square_feet: number | null;
  lot_size_acres: number | null;
  market_days: number | null;
  listing_url: string | null;
  original_listing_date: string | null;
  photo_url: string | null;
  agent_name: string | null;
  office_name: string | null;
  description: string | null;
  property_type: string | null;
  is_test_data: boolean;
  synced_to_salesforce: boolean;
  raw_payload: Record<string, unknown> | null;
  updated_at: string;
  properties: {
    street_address: string | null;
    full_address: string | null;
    city: string | null;
    state: string | null;
    zip_code: string | null;
    latitude: number | null;
    longitude: number | null;
    property_type: string | null;
  } | null;
  data_sources: { slug: string | null; source_name: string | null } | null;
}

function deriveStatus(row: ListingRow): string {
  const today = new Date().toISOString().slice(0, 10);
  const active = /^active$/i.test(row.listing_status);
  if (active && row.original_listing_date?.slice(0, 10) === today) return 'New Today';
  if (active && row.previous_price && row.list_price && row.previous_price > row.list_price) return 'Price Reduced';
  return row.listing_status;
}

export const GET = handler(async request => {
  const url = new URL(request.url);
  const sb = requireSupabase();
  const state = stateCode(url.searchParams.get('state'));
  const source = url.searchParams.get('source');
  const includeInactive = url.searchParams.get('includeInactive') === '1';
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit')) || 200));
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);

  const propertyJoin = state ? 'properties!inner' : 'properties';
  const sourceJoin = source ? 'data_sources!inner' : 'data_sources';
  let query = sb
    .from('listings')
    .select(
      `id, listing_id, listing_status, list_price, previous_price, beds, baths, square_feet, lot_size_acres, market_days,
       listing_url, original_listing_date, photo_url, agent_name, office_name, description, property_type, is_test_data,
       synced_to_salesforce, raw_payload, updated_at,
       ${propertyJoin} ( street_address, full_address, city, state, zip_code, latitude, longitude, property_type ),
       ${sourceJoin} ( slug, source_name )`,
      { count: 'exact' }
    )
    .order('updated_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (!includeInactive) query = query.eq('is_active', true);
  if (state) query = query.eq('properties.state', state);
  if (source) query = query.eq('data_sources.slug', source);

  const { data, error, count } = await query;
  if (error) throw new Error(error.message);

  const mlsName = readMlsConfig()?.name ?? 'MLS';
  const listings: PropertyListing[] = ((data ?? []) as unknown as ListingRow[]).map(row => {
    const p = row.properties;
    const slug = row.data_sources?.slug ?? 'unknown';
    const dataset = typeof row.raw_payload?.dataset === 'string' ? row.raw_payload.dataset : '';
    const address = p?.street_address || p?.full_address?.split(',')[0] || 'Address not provided';
    const type = row.property_type || p?.property_type || 'Unspecified';
    return {
      id: row.id,
      mlsId: row.listing_id ?? row.id,
      title: `${type} · ${p?.city || 'Unknown city'}`,
      address,
      city: p?.city ?? '',
      state: p?.state ?? '',
      postalCode: p?.zip_code ?? '',
      price: Number(row.list_price ?? 0),
      previousPrice: row.previous_price ? Number(row.previous_price) : undefined,
      beds: Number(row.beds ?? 0),
      baths: Number(row.baths ?? 0),
      squareFeet: Number(row.square_feet ?? 0),
      lotSizeAcres: row.lot_size_acres ? Number(row.lot_size_acres) : undefined,
      propertyType: type,
      daysOnMarket: row.market_days,
      listingDate: row.original_listing_date?.slice(0, 10) ?? '',
      status: deriveStatus(row),
      photoUrl: row.photo_url ?? '',
      latitude: p?.latitude ?? null,
      longitude: p?.longitude ?? null,
      listingAgentName: row.agent_name ?? '',
      listingAgentBrokerage: row.office_name ?? '',
      syncedToSalesforce: row.synced_to_salesforce,
      matchedLeadIds: [],
      description: row.description ?? '',
      sourceSlug: slug,
      sourceLabel: slug === 'mls' ? mlsName : slug === 'kaggle' ? `Kaggle${dataset ? ` · ${dataset}` : ''} (historical snapshot)` : row.data_sources?.source_name ?? slug,
      isTestData: row.is_test_data,
      listingUrl: row.listing_url ?? undefined,
      updatedAt: row.updated_at
    };
  });

  return json({ listings, total: count ?? listings.length, limit, offset });
});
