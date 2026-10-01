import { fetchWithTimeout, HttpError } from './http.js';
import { stateCode } from './geo.js';

// RESO Web API (OData) client. Every major MLS vendor exposes this standard:
//   Bridge Interactive  MLS_RESO_URL=https://api.bridgedataoutput.com/api/v2/OData/<dataset>   MLS_ACCESS_TOKEN=<server token>
//   Trestle (CoreLogic) MLS_RESO_URL=https://api-trestle.corelogic.com/trestle/odata
//                       MLS_OAUTH_TOKEN_URL=https://api-trestle.corelogic.com/trestle/oidc/connect/token
//                       MLS_CLIENT_ID / MLS_CLIENT_SECRET, MLS_OAUTH_SCOPE=api
//   MLS Grid            MLS_RESO_URL=https://api.mlsgrid.com/v2   MLS_ACCESS_TOKEN=<token>
//                       MLS_FILTER=OriginatingSystemName eq '<mls>' and MlgCanView eq true   MLS_EXPAND=Media
//   Spark / Flexmls     MLS_RESO_URL=https://replication.sparkapi.com/Reso/OData   MLS_ACCESS_TOKEN=<token>
// MLS_PROVIDER=bridge-test uses Bridge's public sandbox dataset (synthetic records, flagged as test data).

const BRIDGE_TEST_URL = 'https://api.bridgedataoutput.com/api/v2/OData/test';
// Public demo token published in Bridge Interactive's API documentation for the "test" dataset.
const BRIDGE_TEST_TOKEN = '6baca547742c6f96a6ff71b138424f21';

export interface MlsConfig {
  baseUrl: string;
  name: string;
  isTestData: boolean;
  accessToken?: string;
  oauth?: { tokenUrl: string; clientId: string; clientSecret: string; scope?: string };
  filter?: string;
  expand?: string;
  select?: string;
  statuses: string[];
  maxRecords: number;
  pageSize: number;
}

export function readMlsConfig(): MlsConfig | null {
  const env = process.env;
  const isBridgeTest = env.MLS_PROVIDER === 'bridge-test';
  const baseUrl = (env.MLS_RESO_URL || (isBridgeTest ? BRIDGE_TEST_URL : '')).replace(/\/+$/, '');
  if (!baseUrl) return null;

  const accessToken = env.MLS_ACCESS_TOKEN || (isBridgeTest ? BRIDGE_TEST_TOKEN : undefined);
  const oauth =
    env.MLS_OAUTH_TOKEN_URL && env.MLS_CLIENT_ID && env.MLS_CLIENT_SECRET
      ? { tokenUrl: env.MLS_OAUTH_TOKEN_URL, clientId: env.MLS_CLIENT_ID, clientSecret: env.MLS_CLIENT_SECRET, scope: env.MLS_OAUTH_SCOPE }
      : undefined;
  if (!accessToken && !oauth) return null;

  return {
    baseUrl,
    name: env.MLS_NAME || (isBridgeTest ? 'Bridge Interactive sandbox (test data)' : 'MLS feed'),
    isTestData: isBridgeTest || env.MLS_TEST_DATA === 'true',
    accessToken,
    oauth,
    filter: env.MLS_FILTER || undefined,
    expand: env.MLS_EXPAND || undefined,
    select: env.MLS_SELECT || undefined,
    statuses: (env.MLS_STATUSES || 'Active,Active Under Contract,Coming Soon,Pending')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
    maxRecords: Math.max(50, Math.min(5000, Number(env.MLS_MAX_RECORDS) || 1000)),
    pageSize: Math.max(10, Math.min(200, Number(env.MLS_PAGE_SIZE) || 200))
  };
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function bearerToken(config: MlsConfig): Promise<string> {
  if (config.accessToken) return config.accessToken;
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const o = config.oauth!;
  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: o.clientId, client_secret: o.clientSecret });
  if (o.scope) body.set('scope', o.scope);
  const response = await fetchWithTimeout(
    o.tokenUrl,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() },
    15000
  );
  if (!response.ok) throw new HttpError(502, `MLS OAuth token request failed (HTTP ${response.status}). Check MLS_CLIENT_ID / MLS_CLIENT_SECRET.`);
  const token = (await response.json()) as { access_token: string; expires_in?: number };
  cachedToken = { value: token.access_token, expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000 };
  return token.access_token;
}

/** Raw RESO Property records, newest modifications last, starting after `since`. */
export async function* fetchResoProperties(config: MlsConfig, since: string | null, budgetMs: number): AsyncGenerator<Record<string, any>[]> {
  const token = await bearerToken(config);
  const deadline = Date.now() + budgetMs;

  const clauses: string[] = [];
  if (config.statuses.length) clauses.push(`(${config.statuses.map(s => `StandardStatus eq '${s.replace(/'/g, "''")}'`).join(' or ')})`);
  if (since) clauses.push(`ModificationTimestamp gt ${since}`);
  if (config.filter) clauses.push(`(${config.filter})`);

  const params = new URLSearchParams({ $top: String(config.pageSize), $orderby: 'ModificationTimestamp asc' });
  if (clauses.length) params.set('$filter', clauses.join(' and '));
  if (config.expand) params.set('$expand', config.expand);
  if (config.select) params.set('$select', config.select);

  let next: string | null = `${config.baseUrl}/Property?${params.toString().replace(/\+/g, '%20')}`;
  let fetched = 0;

  while (next && fetched < config.maxRecords && Date.now() < deadline) {
    const response = await fetchWithTimeout(next, { headers: { Authorization: `Bearer ${token}` } }, 30000);
    if (response.status === 401 || response.status === 403) {
      throw new HttpError(502, `MLS feed rejected the credentials (HTTP ${response.status}). Check MLS_ACCESS_TOKEN or OAuth settings.`);
    }
    if (!response.ok) {
      const text = await response.text();
      throw new HttpError(502, `MLS feed HTTP ${response.status}: ${text.slice(0, 300)}`);
    }
    const page = (await response.json()) as { value?: Record<string, any>[]; '@odata.nextLink'?: string };
    const rows = page.value ?? [];
    fetched += rows.length;
    if (rows.length) yield rows;
    next = rows.length ? page['@odata.nextLink'] ?? null : null;
  }
}

function n(value: unknown): number | null {
  const v = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(v) ? v : null;
}

function pickPhoto(record: Record<string, any>): string | null {
  const media = Array.isArray(record.Media) ? record.Media : [];
  const photo = media
    .filter((m: any) => m?.MediaURL && (!m.MediaCategory || /photo/i.test(m.MediaCategory)))
    .sort((a: any, b: any) => (a.Order ?? 999) - (b.Order ?? 999))[0];
  return photo?.MediaURL ?? null;
}

/** Maps a RESO Property record to rows for public.properties and public.listings. */
export function mapResoRecord(record: Record<string, any>, isTestData: boolean) {
  const listingKey = String(record.ListingKey ?? record.ListingKeyNumeric ?? record.ListingId ?? '');
  const street =
    [record.StreetNumber, record.StreetDirPrefix, record.StreetName, record.StreetSuffix, record.StreetDirSuffix]
      .filter(Boolean)
      .join(' ')
      .trim() || String(record.UnparsedAddress ?? '').split(',')[0];
  const unit = record.UnitNumber ? ` ${String(record.UnitNumber).startsWith('#') ? '' : '#'}${record.UnitNumber}` : '';
  const lat = n(record.Latitude);
  const lng = n(record.Longitude);
  const baths = n(record.BathroomsTotalDecimal) ?? n(record.BathroomsTotalInteger) ?? ((n(record.BathroomsFull) ?? 0) + (n(record.BathroomsHalf) ?? 0) * 0.5 || null);

  const property = {
    external_id: listingKey,
    street_address: `${street}${unit}`.trim() || null,
    full_address: record.UnparsedAddress ?? null,
    parcel_id: record.ParcelNumber ?? null,
    county: record.CountyOrParish ?? null,
    city: record.City ?? null,
    state: stateCode(record.StateOrProvince) || record.StateOrProvince || null,
    zip_code: record.PostalCode ? String(record.PostalCode).slice(0, 10) : null,
    latitude: lat !== null && Math.abs(lat) <= 90 && lat !== 0 ? lat : null,
    longitude: lng !== null && Math.abs(lng) <= 180 && lng !== 0 ? lng : null,
    property_type: record.PropertySubType || record.PropertyType || null,
    bedrooms: n(record.BedroomsTotal),
    bathrooms: baths,
    square_feet: n(record.LivingArea) !== null ? Math.round(n(record.LivingArea)!) : null,
    year_built: n(record.YearBuilt),
    confidence_score: 95,
    source_url: record.ListingURL ?? null,
    verification_status: isTestData ? 'test_data' : 'mls_feed',
    updated_at: new Date().toISOString()
  };

  const listPrice = n(record.ListPrice);
  const previous = n(record.PreviousListPrice) ?? n(record.OriginalListPrice);
  const listing = {
    listing_id: listingKey,
    listing_source: 'MLS',
    listing_status: record.StandardStatus ?? record.MlsStatus ?? 'Active',
    list_price: listPrice,
    previous_price: previous && listPrice && previous !== listPrice ? previous : null,
    beds: n(record.BedroomsTotal),
    baths,
    square_feet: property.square_feet,
    market_days: n(record.DaysOnMarket) ?? n(record.CumulativeDaysOnMarket),
    listing_url: record.ListingURL ?? null,
    original_listing_date: record.OnMarketDate || record.ListingContractDate || null,
    sold_date: record.CloseDate ?? null,
    sold_price: n(record.ClosePrice) || null,
    is_active: !/closed|expired|withdrawn|canceled|cancelled|delete/i.test(String(record.StandardStatus ?? '')),
    photo_url: pickPhoto(record),
    agent_name: record.ListAgentFullName ?? null,
    office_name: record.ListOfficeName ?? null,
    description: record.PublicRemarks ? String(record.PublicRemarks).slice(0, 4000) : null,
    property_type: property.property_type,
    lot_size_acres: n(record.LotSizeAcres),
    is_test_data: isTestData,
    source_modified_at: record.ModificationTimestamp ?? null,
    raw_payload: {
      ListingId: record.ListingId ?? null,
      MlsStatus: record.MlsStatus ?? null,
      OriginatingSystemName: record.OriginatingSystemName ?? null,
      PhotosCount: record.PhotosCount ?? null
    },
    updated_at: new Date().toISOString()
  };

  return { listingKey, property, listing, modifiedAt: record.ModificationTimestamp as string | undefined };
}
