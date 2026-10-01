import type { MapRecord, MapSearchResponse, SourceRunStatus } from '../src/types/index.js';
import { handler, HttpError, json, numberParam } from './_lib/http.js';
import { bboxAround, distanceMiles, isValidLatLng } from './_lib/geo.js';
import { fetchOsmBuildings, OSM_MAX_RADIUS_MILES } from './_lib/osm.js';
import { extentContains, queryParcelLayer } from './_lib/arcgis.js';
import { catalogLayers, ensureParcelSource, loadParcelLayers, PARCEL_CATALOG } from './_lib/parcelLayers.js';
import { getSupabase } from './_lib/supabase.js';
import { persistRecords, queryStoredRecords } from './_lib/store.js';

// GET /api/map-search?lat=30.27&lng=-97.74&radius=5
// Combines, in parallel:
//   1. properties already stored in Supabase (earlier searches, Overture/Kaggle imports, MLS)
//   2. live OpenStreetMap buildings with addresses (Overpass, mirrors)
//   3. live county / statewide ArcGIS parcel layers covering the point
// Live results are upserted into Supabase so the next search works even if a live source is down.

const STORED_MAX_RADIUS = 50;
const PARCEL_MAX_RADIUS = 2;
const MAX_PARCEL_LAYERS = 3;
const MAX_RECORDS = 1500;

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
  const radius = Math.max(0.25, Math.min(500, numberParam(url, 'radius', 5)));
  if (!isValidLatLng(lat, lng)) throw new HttpError(400, 'lat/lng are out of range.');
  const include = new Set((url.searchParams.get('sources') || 'stored,osm,parcels').split(','));

  const sb = getSupabase();
  const statuses: SourceRunStatus[] = [];

  const layers = (await loadParcelLayers(sb)).filter(l => extentContains(l.extent, lat, lng)).slice(0, MAX_PARCEL_LAYERS);
  const parcelBox = bboxAround(lat, lng, Math.min(radius, PARCEL_MAX_RADIUS));

  const [stored, osm, ...parcels] = await Promise.all([
    include.has('stored') && sb
      ? timed(() => queryStoredRecords(sb, bboxAround(lat, lng, Math.min(radius, STORED_MAX_RADIUS)), MAX_RECORDS))
      : Promise.resolve(null),
    include.has('osm') ? timed(() => fetchOsmBuildings(lat, lng, radius, 40000)) : Promise.resolve(null),
    ...(include.has('parcels') ? layers.map(layer => timed(() => queryParcelLayer(layer, parcelBox, 300, 20000))) : [])
  ]);

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

  // OpenStreetMap
  if (osm) {
    statuses.push(
      osm.error
        ? { slug: 'osm', label: 'OpenStreetMap', status: 'error', count: 0, message: osm.error, ms: osm.ms }
        : {
            slug: 'osm',
            label: 'OpenStreetMap',
            status: osm.value!.length ? 'ok' : 'empty',
            count: osm.value!.length,
            message: radius > OSM_MAX_RADIUS_MILES ? `Live OSM lookup limited to ${OSM_MAX_RADIUS_MILES} mi around the center.` : undefined,
            ms: osm.ms
          }
    );
  }

  // Parcels
  if (include.has('parcels')) {
    if (!layers.length) {
      statuses.push({
        slug: 'county-parcels',
        label: 'County parcels',
        status: 'skipped',
        count: 0,
        message: 'No parcel layer covers this location yet. Connect your county GIS parcel layer in the data sources panel.'
      });
    }
    layers.forEach((layer, i) => {
      const run = parcels[i];
      statuses.push(
        run.error
          ? { slug: layer.slug, label: layer.name, status: 'error', count: 0, message: run.error, ms: run.ms }
          : {
              slug: layer.slug,
              label: layer.name,
              status: run.value!.length ? 'ok' : 'empty',
              count: run.value!.length,
              message: radius > PARCEL_MAX_RADIUS ? `Parcels limited to ${PARCEL_MAX_RADIUS} mi around the center.` : undefined,
              ms: run.ms
            }
      );
    });
  }

  const live: MapRecord[] = [...(osm?.value ?? []), ...parcels.flatMap(p => p.value ?? [])];
  const merged = new Map<string, MapRecord>();
  for (const record of stored?.value ?? []) merged.set(record.id, record);
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
      const catalogSlugs = new Set(catalogLayers().map(l => l.slug));
      for (const layer of layers.filter(l => catalogSlugs.has(l.slug))) {
        const provider = PARCEL_CATALOG.find(c => c.url === layer.url)?.provider || 'State GIS';
        await ensureParcelSource(sb, layer, provider);
      }
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
