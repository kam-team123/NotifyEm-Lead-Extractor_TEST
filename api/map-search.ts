import type { MapRecord, MapSearchResponse, SourceRunStatus } from '../src/types/index.js';
import { handler, HttpError, json, numberParam } from './_lib/http.js';
import { bboxAround, distanceMiles, isValidLatLng } from './_lib/geo.js';
import { fetchOsmBuildings, OSM_MAX_RADIUS_MILES } from './_lib/osm.js';
import { fetchRealtyListings, REALTY_MAX_RADIUS_MILES, realtyConfigured } from './_lib/realty.js';
import { getSupabase } from './_lib/supabase.js';
import { persistRecords, queryStoredRecords } from './_lib/store.js';

// GET /api/map-search?lat=30.27&lng=-97.74&radius=5[&sources=stored,realty,osm]
// Combines:
//   1. properties already stored in Supabase (earlier searches, Overture/Kaggle imports, MLS)
//   2. live Realtor.com for-sale listings via RealtyAPI (primary live source, needs REALTYAPI_KEY)
//   3. live OpenStreetMap buildings (Overpass) — when requested, or as a fallback when RealtyAPI
//      is not configured, fails or returns nothing
// Live results are upserted into Supabase so the next search works even if a live source is down.

/** Largest search the Lead Finder offers; keep in sync with MAX_RADIUS_MILES in HeatmapLeadFinder.tsx. */
const MAX_RADIUS_MILES = 50;
const STORED_MAX_RADIUS = 50;
const MAX_RECORDS = 1500;
const REALTY_BUDGET_MS = 25000;
const OSM_BUDGET_MS = 30000;

async function timed<T>(fn: () => Promise<T>): Promise<{ value?: T; error?: string; ms: number }> {
  const start = Date.now();
  try {
    return { value: await fn(), ms: Date.now() - start };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), ms: Date.now() - start };
  }
}

export const GET = handler(async request => {
  const url = new URL(request.url);
  const lat = numberParam(url, 'lat');
  const lng = numberParam(url, 'lng');
  const radius = Math.max(0.25, Math.min(MAX_RADIUS_MILES, numberParam(url, 'radius', 5)));
  if (!isValidLatLng(lat, lng)) throw new HttpError(400, 'lat/lng are out of range.');
  // An explicit `sources` list (the Lead Finder's source toggle) is honoured as-is: no OSM fallback.
  const explicitSources = url.searchParams.has('sources');
  const include = new Set((url.searchParams.get('sources') || 'stored,realty').split(','));

  const sb = getSupabase();
  const statuses: SourceRunStatus[] = [];

  const [stored, realty] = await Promise.all([
    include.has('stored') && sb
      ? timed(() => queryStoredRecords(sb, bboxAround(lat, lng, Math.min(radius, STORED_MAX_RADIUS)), MAX_RECORDS))
      : Promise.resolve(null),
    include.has('realty') && realtyConfigured()
      ? timed(() => fetchRealtyListings(lat, lng, radius, REALTY_BUDGET_MS))
      : Promise.resolve(null)
  ]);

  // OSM only runs when asked for, or when Realtor.com gave us nothing (no key, error, or empty area).
  const osmIsFallback = !explicitSources && !include.has('osm') && !realty?.value?.records.length;
  const osm = include.has('osm') || osmIsFallback ? await timed(() => fetchOsmBuildings(lat, lng, radius, OSM_BUDGET_MS)) : null;

  // Supabase
  if (!sb) {
    statuses.push({ slug: 'stored', label: 'Supabase', status: 'skipped', count: 0, message: 'Supabase env vars are not set on the server.' });
  } else if (stored) {
    statuses.push(
      stored.error
        ? { slug: 'stored', label: 'Supabase', status: 'error', count: 0, message: stored.error, ms: stored.ms }
        : {
            slug: 'stored',
            label: 'Supabase',
            status: stored.value!.length ? 'ok' : 'empty',
            count: stored.value!.length,
            message: radius > STORED_MAX_RADIUS ? `Stored records limited to ${STORED_MAX_RADIUS} mi.` : undefined,
            ms: stored.ms
          }
    );
  }

  // RealtyAPI (Realtor.com)
  if (include.has('realty')) {
    if (!realtyConfigured()) {
      statuses.push({ slug: 'realtor', label: 'Realtor.com', status: 'skipped', count: 0, message: 'REALTYAPI_KEY is not set on the server.' });
    } else if (realty?.error) {
      statuses.push({ slug: 'realtor', label: 'Realtor.com', status: 'error', count: 0, message: realty.error, ms: realty.ms });
    } else if (realty?.value) {
      const { records: listings, total, truncated } = realty.value;
      const notes = [
        radius > REALTY_MAX_RADIUS_MILES ? `For-sale listings limited to ${REALTY_MAX_RADIUS_MILES} mi around the center.` : '',
        truncated ? `Showing ${listings.length} of ${total} listings.` : ''
      ].filter(Boolean);
      statuses.push({
        slug: 'realtor',
        label: 'Realtor.com',
        status: listings.length ? 'ok' : 'empty',
        count: listings.length,
        message: notes.join(' ') || undefined,
        ms: realty.ms
      });
    }
  }

  // OpenStreetMap
  if (osm) {
    const notes = [
      osmIsFallback ? 'Fallback: Realtor.com returned no listings.' : '',
      osm.error ?? '',
      osm.value?.fellBack
        ? `OSM was busy, so the live lookup fell back to ${osm.value.radiusMiles} mi around the center. Retry for the full ${Math.min(radius, OSM_MAX_RADIUS_MILES)} mi.`
        : osm.value && radius > OSM_MAX_RADIUS_MILES
          ? `Live OSM lookup limited to ${OSM_MAX_RADIUS_MILES} mi around the center.`
          : ''
    ].filter(Boolean);
    statuses.push({
      slug: 'osm',
      label: 'OpenStreetMap',
      status: osm.error ? 'error' : osm.value!.records.length ? 'ok' : 'empty',
      count: osm.value?.records.length ?? 0,
      message: notes.join(' ') || undefined,
      ms: osm.ms
    });
  }

  const live: MapRecord[] = [...(realty?.value?.records ?? []), ...(osm?.value?.records ?? [])];
  const merged = new Map<string, MapRecord>();
  for (const record of stored?.value ?? []) {
    if (record.sourceSlug === 'county-parcels' || record.sourceSlug.startsWith('parcel-layer:')) continue;
    // Saved copies of a live source follow the same toggle as the live source itself.
    if (explicitSources && record.sourceSlug === 'osm' && !include.has('osm')) continue;
    if (explicitSources && record.sourceSlug === 'realtor' && !include.has('realty')) continue;
    merged.set(record.id, record);
  }
  for (const record of live) merged.set(record.id, record);

  const records = [...merged.values()]
    .map(r => ({ r, d: distanceMiles(lat, lng, r.lat, r.lng) }))
    .filter(({ d }) => d <= radius)
    .sort((a, b) => a.d - b.d)
    .slice(0, MAX_RECORDS)
    .map(({ r }) => r);

  let persisted = false;
  if (sb && live.length) {
    try {
      await persistRecords(sb, live);
      persisted = true;
    } catch (error) {
      statuses.push({
        slug: 'stored',
        label: 'Supabase save',
        status: 'error',
        count: 0,
        message: `Live results were not saved: ${error instanceof Error ? error.message : error}`
      });
    }
  }

  const body: MapSearchResponse = { records, sources: statuses, persisted };
  return json(body);
});
