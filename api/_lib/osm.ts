import type { MapRecord } from '../../src/types/index.js';
import { fetchWithTimeout } from './http.js';
import { bboxAround, isValidLatLng, stateCode } from './geo.js';

// overpass-api.de answers 406 to clients without a descriptive User-Agent and 504 when overloaded.
// Browser requests also fail CORS on those error pages ("Failed to fetch"), so we query server-side
// and fall through a list of public mirrors. Override with OVERPASS_ENDPOINTS (comma separated).
const OVERPASS_ENDPOINTS = (process.env.OVERPASS_ENDPOINTS ||
  'https://overpass-api.de/api/interpreter,https://overpass.private.coffee/api/interpreter,https://maps.mail.ru/osm/tools/overpass/api/interpreter')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

/** Overpass gets expensive fast; larger radii are served from Supabase instead. */
export const OSM_MAX_RADIUS_MILES = 3;

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export async function fetchOsmBuildings(lat: number, lng: number, radiusMiles: number, budgetMs: number): Promise<MapRecord[]> {
  const radius = Math.min(radiusMiles, OSM_MAX_RADIUS_MILES);
  const b = bboxAround(lat, lng, radius);
  const query =
    `[out:json][timeout:20][bbox:${b.south.toFixed(5)},${b.west.toFixed(5)},${b.north.toFixed(5)},${b.east.toFixed(5)}];` +
    `nwr["building"]["addr:housenumber"]["addr:street"];out center tags 300;`;

  const deadline = Date.now() + budgetMs;
  const failures: string[] = [];

  const attempt = async (endpoint: string, timeoutMs: number): Promise<MapRecord[]> => {
    const host = new URL(endpoint).host;
    try {
      const response = await fetchWithTimeout(
        endpoint,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          body: new URLSearchParams({ data: query }).toString()
        },
        timeoutMs
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as { elements?: OverpassElement[]; remark?: string };
      if (payload.remark && !payload.elements?.length) throw new Error(payload.remark.slice(0, 80));
      return toRecords(payload.elements ?? []);
    } catch (error) {
      failures.push(`${host} ${error instanceof Error ? error.message : 'failed'}`);
      throw error;
    }
  };

  // Primary endpoint first (fails fast when overloaded), then race the mirrors for the remaining budget.
  const [primary, ...mirrors] = OVERPASS_ENDPOINTS;
  try {
    return await attempt(primary, Math.min(10000, budgetMs));
  } catch {
    const remaining = deadline - Date.now();
    if (mirrors.length && remaining > 3000) {
      try {
        return await Promise.any(mirrors.map(endpoint => attempt(endpoint, remaining)));
      } catch {
        // fall through with collected failures
      }
    }
  }

  throw new Error(`OpenStreetMap Overpass is unavailable (${failures.join('; ') || 'time budget exhausted'}).`);
}

function toRecords(elements: OverpassElement[]): MapRecord[] {
  const retrievedAt = new Date().toISOString();
  const seen = new Set<string>();
  const out: MapRecord[] = [];

  for (const el of elements) {
    const tags = el.tags ?? {};
    const address = `${tags['addr:housenumber'] ?? ''} ${tags['addr:street'] ?? ''}`.trim();
    const point = el.type === 'node' ? { lat: el.lat, lon: el.lon } : el.center;
    const lat = Number(point?.lat);
    const lng = Number(point?.lon);
    if (!address || !isValidLatLng(lat, lng)) continue;

    const key = `${address.toLowerCase().replace(/\s+/g, ' ')}|${tags['addr:postcode'] ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const completeness = [tags['addr:city'], tags['addr:state'], tags['addr:postcode']].filter(Boolean).length;
    const externalId = `${el.type}/${el.id}`;
    out.push({
      id: `osm:${externalId}`,
      sourceSlug: 'osm',
      sourceLabel: 'OpenStreetMap',
      externalId,
      address,
      city: tags['addr:city'] || '',
      state: stateCode(tags['addr:state']) || tags['addr:state'] || '',
      postalCode: tags['addr:postcode'] || '',
      lat,
      lng,
      category: tags.building && tags.building !== 'yes' ? tags.building : 'Building',
      yearBuilt: Number(tags.start_date) || undefined,
      sourceUrl: `https://www.openstreetmap.org/${externalId}`,
      retrievedAt,
      fromStore: false,
      confidenceScore: Math.round((0.7 + completeness * 0.1) * 100)
    });
  }
  return out;
}
