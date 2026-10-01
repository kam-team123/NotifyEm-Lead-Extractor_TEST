import { handler, HttpError, json, readJson } from '../_lib/http.js';
import { markSourceStatus, requireSupabase, sourceIdBySlug } from '../_lib/supabase.js';
import { isValidLatLng, stateCode } from '../_lib/geo.js';

// POST /api/import/kaggle  { dataset: "usa-real-estate", rows: ImportRow[] }   (≤ 1000 rows per request)
// The browser streams the CSV (papaparse), maps columns, and sends batches here.

export interface ImportRow {
  rowKey: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  price?: number | null;
  beds?: number | null;
  baths?: number | null;
  sqft?: number | null;
  lotAcres?: number | null;
  status?: string;
  propertyType?: string;
  yearBuilt?: number | null;
  lat?: number | null;
  lng?: number | null;
  soldDate?: string;
  listDate?: string;
  broker?: string;
}

const MAX_ROWS = 1000;

function n(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const v = typeof value === 'number' ? value : Number(String(value).replace(/[$,\s]/g, ''));
  return Number.isFinite(v) ? v : null;
}

function int(value: unknown): number | null {
  const v = n(value);
  return v === null ? null : Math.round(v);
}

function text(value: unknown, max = 200): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s ? s.slice(0, max) : null;
}

function date(value: unknown): string | null {
  const s = text(value, 40);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function normaliseStatus(raw: string | null): { status: string; active: boolean } {
  const s = (raw || '').toLowerCase().replace(/[_-]+/g, ' ').trim();
  if (!s || s === 'for sale' || s === 'active') return { status: 'Active', active: true };
  if (s.includes('sold') || s.includes('closed')) return { status: 'Sold', active: false };
  if (s.includes('pending') || s.includes('contract')) return { status: 'Pending', active: true };
  if (s.includes('ready to build')) return { status: 'Ready to Build', active: true };
  return { status: raw!.slice(0, 40), active: true };
}

export const POST = handler(async request => {
  const body = await readJson<{ dataset?: string; rows?: ImportRow[] }>(request);
  const dataset = (body.dataset || '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(0, 60);
  if (!dataset) throw new HttpError(400, 'Missing "dataset" name.');
  if (!Array.isArray(body.rows) || !body.rows.length) throw new HttpError(400, 'No rows to import.');
  if (body.rows.length > MAX_ROWS) throw new HttpError(413, `Send at most ${MAX_ROWS} rows per request.`);

  const sb = requireSupabase();
  const sourceId = await sourceIdBySlug(sb, 'kaggle');
  const now = new Date().toISOString();

  const prepared = new Map<string, { property: Record<string, unknown>; listing: Record<string, unknown> }>();
  let skipped = 0;
  for (const row of body.rows) {
    const key = text(row.rowKey, 80);
    const price = n(row.price);
    const address = text(row.address);
    const city = text(row.city, 80);
    if (!key || (!address && !city) || price === null || price <= 0) {
      skipped++;
      continue;
    }
    const lat = n(row.lat);
    const lng = n(row.lng);
    const hasPoint = lat !== null && lng !== null && isValidLatLng(lat, lng) && !(lat === 0 && lng === 0);
    const externalId = `${dataset}:${key}`;
    const { status, active } = normaliseStatus(text(row.status, 40));
    const state = stateCode(row.state) || text(row.state, 20);
    const zip = text(row.zip, 10)?.replace(/\.0$/, '') ?? null;
    const sqft = int(row.sqft);
    const beds = int(row.beds);
    const baths = n(row.baths);
    const type = text(row.propertyType, 60);

    prepared.set(externalId, {
      property: {
        source_id: sourceId,
        external_id: externalId,
        street_address: address,
        full_address: [address, city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', '),
        city,
        state,
        zip_code: zip,
        latitude: hasPoint ? lat : null,
        longitude: hasPoint ? lng : null,
        property_type: type,
        bedrooms: beds,
        bathrooms: baths,
        square_feet: sqft,
        year_built: int(row.yearBuilt),
        confidence_score: 50,
        verification_status: 'dataset_snapshot',
        metadata: { dataset },
        updated_at: now
      },
      listing: {
        source_id: sourceId,
        listing_id: externalId,
        listing_source: 'Kaggle',
        listing_status: status,
        list_price: price,
        beds,
        baths,
        square_feet: sqft,
        lot_size_acres: n(row.lotAcres),
        property_type: type,
        original_listing_date: date(row.listDate),
        sold_date: date(row.soldDate),
        office_name: text(row.broker, 120),
        is_active: active,
        is_test_data: false,
        raw_payload: { dataset },
        updated_at: now
      }
    });
  }

  const items = [...prepared.values()];
  if (items.length) {
    const { data: props, error: propError } = await sb
      .from('properties')
      .upsert(items.map(i => i.property), { onConflict: 'source_id,external_id' })
      .select('id, external_id');
    if (propError) throw new HttpError(500, `Saving properties failed: ${propError.message}`);
    const ids = new Map((props ?? []).map(p => [p.external_id as string, p.id as string]));

    const { error: listError } = await sb.from('listings').upsert(
      items.map(i => ({ ...i.listing, property_id: ids.get(i.listing.listing_id as string) ?? null })),
      { onConflict: 'source_id,listing_id' }
    );
    if (listError) throw new HttpError(500, `Saving listings failed: ${listError.message}`);
  }

  const { count } = await sb.from('listings').select('id', { count: 'exact', head: true }).eq('source_id', sourceId);
  await markSourceStatus(sb, 'kaggle', { is_connected: true, last_sync_at: now, last_error: null, record_count: count ?? 0 });

  return json({ imported: items.length, skipped, totalKaggleListings: count ?? null });
});
