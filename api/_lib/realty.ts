import type { MapRecord } from '../../src/types/index.js';
import { fetchWithTimeout } from './http.js';
import { isValidLatLng } from './geo.js';

// RealtyAPI (realtor.realtyapi.io) proxies Realtor.com: GET /search/bycoordinates returns up to 50 for-sale
// listings per page around a point. The key is server-only (REALTYAPI_KEY) and sent as x-realtyapi-key.
// Wide radii regularly time out upstream, so the radius is capped (override with REALTY_MAX_RADIUS_MILES).

const BASE_URL = process.env.REALTYAPI_BASE_URL || 'https://realtor.realtyapi.io';
export const REALTY_MAX_RADIUS_MILES = Math.max(0.5, Math.min(25, Number(process.env.REALTY_MAX_RADIUS_MILES) || 5));
/** Each page costs credits; 4 pages = up to 200 listings per search. Override with REALTY_MAX_PAGES. */
const MAX_PAGES = Math.max(1, Math.min(10, Number(process.env.REALTY_MAX_PAGES) || 4));
const CACHE_TTL_MS = 15 * 60 * 1000;

export const realtyConfigured = () => Boolean(process.env.REALTYAPI_KEY);

interface RealtyListing {
  property_id?: string;
  listing_id?: string;
  status?: string;
  href?: string;
  list_price?: number | null;
  estimate?: number | null;
  beds?: number | null;
  baths?: string | number | null;
  sqft?: number | null;
  lot_sqft?: number | null;
  year_built?: number | null;
  property_type?: string | null;
  primary_photo?: string | null;
  address?: {
    line?: string | null;
    unit?: string | null;
    city?: string | null;
    state_code?: string | null;
    postal_code?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  };
  advertisers?: { name?: string | null; office?: string | null; type?: string | null }[];
}

interface RealtySearchPage {
  message?: string;
  total?: number;
  nextPage?: boolean;
  searchResults?: RealtyListing[];
}

export interface RealtyResult {
  records: MapRecord[];
  total: number;
  radiusMiles: number;
  /** true when more listings exist upstream than MAX_PAGES fetched. */
  truncated: boolean;
}

const cache = new Map<string, { at: number; value: RealtyResult }>();

/** Upstream requests either answer in ~2s or hang for a minute+, so a slow one gets a hedged duplicate. */
const HEDGE_AFTER_MS = 7000;

async function fetchPage(lat: number, lng: number, radius: number, page: number, timeoutMs: number): Promise<RealtySearchPage> {
  const deadline = Date.now() + timeoutMs;
  const first = fetchPageOnce(lat, lng, radius, page, timeoutMs);
  const hedge = new Promise<RealtySearchPage>((resolve, reject) => {
    const timer = setTimeout(() => {
      const remaining = deadline - Date.now();
      if (remaining < 3000) return reject(new Error('no time left to retry'));
      fetchPageOnce(lat, lng, radius, page, remaining).then(resolve, reject);
    }, HEDGE_AFTER_MS);
    // An early answer or a fast HTTP error (bad key, no credits) from the first request cancels the hedge.
    first.then(
      () => clearTimeout(timer),
      error => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
  try {
    return await Promise.any([first, hedge]);
  } catch (error) {
    throw (error as AggregateError).errors?.[0] ?? error;
  }
}

async function fetchPageOnce(lat: number, lng: number, radius: number, page: number, timeoutMs: number): Promise<RealtySearchPage> {
  const params = new URLSearchParams({ latitude: lat.toFixed(6), longitude: lng.toFixed(6), radius: String(radius), page: String(page) });
  const response = await fetchWithTimeout(
    `${BASE_URL}/search/bycoordinates?${params}`,
    { headers: { 'x-realtyapi-key': process.env.REALTYAPI_KEY! } },
    timeoutMs
  );
  if (response.status === 401 || response.status === 403) throw new Error(`RealtyAPI rejected the key (HTTP ${response.status}). Check REALTYAPI_KEY.`);
  if (response.status === 429) throw new Error('RealtyAPI rate limit or credit limit reached (HTTP 429).');
  if (!response.ok) throw new Error(`RealtyAPI HTTP ${response.status}`);
  const body = (await response.json()) as RealtySearchPage;
  if (body.message && body.message !== 'Success' && !body.searchResults) throw new Error(`RealtyAPI: ${body.message}`);
  return body;
}

export async function fetchRealtyListings(lat: number, lng: number, radiusMiles: number, budgetMs: number): Promise<RealtyResult> {
  const radius = Math.min(radiusMiles, REALTY_MAX_RADIUS_MILES);
  const key = `${lat.toFixed(3)},${lng.toFixed(3)},${radius}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const deadline = Date.now() + budgetMs;
  const first = await fetchPage(lat, lng, radius, 1, budgetMs);
  const pages = [first];
  const total = first.total ?? first.searchResults?.length ?? 0;
  const perPage = first.searchResults?.length || 50;
  const pageCount = Math.min(MAX_PAGES, Math.ceil(total / perPage));

  // Remaining pages in parallel; a failed extra page only shrinks the result, it never fails the search.
  const remaining = deadline - Date.now();
  if (first.nextPage && pageCount > 1 && remaining > 3000) {
    const extra = await Promise.allSettled(
      Array.from({ length: pageCount - 1 }, (_, i) => fetchPage(lat, lng, radius, i + 2, remaining))
    );
    for (const result of extra) if (result.status === 'fulfilled') pages.push(result.value);
  }

  const records = toRecords(pages.flatMap(p => p.searchResults ?? []));
  const value: RealtyResult = { records, total, radiusMiles: radius, truncated: total > records.length };
  cache.set(key, { at: Date.now(), value });
  return value;
}

const titleCase = (value: string) => value.replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());

function toRecords(listings: RealtyListing[]): MapRecord[] {
  const retrievedAt = new Date().toISOString();
  const byId = new Map<string, MapRecord>();

  for (const item of listings) {
    const a = item.address ?? {};
    const lat = Number(a.latitude);
    const lng = Number(a.longitude);
    const externalId = item.property_id || item.listing_id;
    const address = [a.line, a.unit].filter(Boolean).join(' ').trim();
    if (!externalId || !address || !isValidLatLng(lat, lng) || byId.has(externalId)) continue;

    const agent = item.advertisers?.find(ad => ad.type === 'seller') ?? item.advertisers?.[0];
    const baths = item.baths === null || item.baths === undefined ? undefined : Number(item.baths);
    const completeness = [a.city, a.state_code, a.postal_code].filter(Boolean).length;

    byId.set(externalId, {
      id: `realtor:${externalId}`,
      sourceSlug: 'realtor',
      sourceLabel: 'Realtor.com (RealtyAPI)',
      externalId,
      address,
      city: a.city || '',
      state: a.state_code || '',
      postalCode: a.postal_code || '',
      lat,
      lng,
      category: item.property_type ? titleCase(item.property_type) : 'Listing',
      yearBuilt: item.year_built || undefined,
      lotAcres: item.lot_sqft ? Math.round((item.lot_sqft / 43560) * 100) / 100 : undefined,
      listPrice: item.list_price ?? undefined,
      estimatedValue: item.estimate ?? undefined,
      beds: item.beds ?? undefined,
      baths: Number.isFinite(baths) ? baths : undefined,
      sqft: item.sqft ?? undefined,
      listingStatus: item.status ? titleCase(item.status) : undefined,
      photoUrl: item.primary_photo?.replace(/^http:\/\//, 'https://') || undefined,
      agentName: agent?.name || undefined,
      agentOffice: agent?.office || undefined,
      sourceUrl: item.href || `https://www.realtor.com/realestateandhomes-detail/M${externalId}`,
      retrievedAt,
      fromStore: false,
      confidenceScore: Math.round((0.7 + completeness * 0.1) * 100)
    });
  }
  return [...byId.values()];
}
