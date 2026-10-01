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

/** Overpass gets expensive fast; larger radii are served from Supabase instead. Override with OSM_MAX_RADIUS_MILES. */
export const OSM_MAX_RADIUS_MILES = Math.max(1, Math.min(25, Number(process.env.OSM_MAX_RADIUS_MILES) || 10));

/** Inside this radius every addressed feature is requested; beyond it the outer ring is sampled. */
const OSM_DENSE_RADIUS_MILES = 3;
const DENSE_LIMIT = 1200;
const OUTER_LIMIT = 1800;
const METERS_PER_MILE = 1609.34;

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export interface OsmResult {
  records: MapRecord[];
  /** Radius actually covered: smaller than requested when the cap applied or the wide query fell back. */
  radiusMiles: number;
  fellBack: boolean;
}

export async function fetchOsmBuildings(lat: number, lng: number, radiusMiles: number, budgetMs: number): Promise<OsmResult> {
  const radius = Math.min(radiusMiles, OSM_MAX_RADIUS_MILES);
  const dense = Math.min(radius, OSM_DENSE_RADIUS_MILES);
  if (radius <= dense) {
    return { records: await runQuery(buildQuery(lat, lng, dense, dense), budgetMs), radiusMiles: dense, fellBack: false };
  }

  // A wide query can time out on a busy Overpass server; keep part of the budget to retry the dense ring alone.
  const deadline = Date.now() + budgetMs;
  try {
    return { records: await runQuery(buildQuery(lat, lng, radius, dense), Math.round(budgetMs * 0.6)), radiusMiles: radius, fellBack: false };
  } catch (error) {
    const remaining = deadline - Date.now();
    if (remaining < 5000) throw error;
    return { records: await runQuery(buildQuery(lat, lng, dense, dense), remaining), radiusMiles: dense, fellBack: true };
  }
}

function buildQuery(lat: number, lng: number, radius: number, dense: number): string {
  const b = bboxAround(lat, lng, radius);
  // Any addressed feature counts: buildings, standalone address points and businesses (which carry contact tags).
  // Overpass output is capped per statement, so the near ring is fetched first and fully, then the wider area.
  const around = (miles: number) => `(around:${Math.round(miles * METERS_PER_MILE)},${lat.toFixed(6)},${lng.toFixed(6)})`;
  return (
    `[out:json][timeout:25][bbox:${b.south.toFixed(5)},${b.west.toFixed(5)},${b.north.toFixed(5)},${b.east.toFixed(5)}];` +
    `nwr${around(dense)}["addr:housenumber"]["addr:street"];out center tags ${DENSE_LIMIT};` +
    (radius > dense ? `nwr${around(radius)}["addr:housenumber"]["addr:street"];out center tags ${OUTER_LIMIT};` : '')
  );
}

async function runQuery(query: string, budgetMs: number): Promise<MapRecord[]> {
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
    return await attempt(primary, Math.min(12000, Math.round(budgetMs * 0.5)));
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

const BUSINESS_KEYS = ['shop', 'amenity', 'office', 'craft', 'tourism', 'healthcare', 'leisure'];

function category(tags: Record<string, string>): string {
  for (const key of BUSINESS_KEYS) {
    if (tags[key] && tags[key] !== 'yes') return `${key}: ${tags[key].replace(/_/g, ' ')}`;
  }
  if (tags.building) return tags.building !== 'yes' ? tags.building : 'Building';
  return 'Address point';
}

const firstTag = (tags: Record<string, string>, ...keys: string[]) => {
  for (const key of keys) {
    const value = tags[key]?.split(';')[0].trim();
    if (value) return value;
  }
  return undefined;
};

function toRecords(elements: OverpassElement[]): MapRecord[] {
  const retrievedAt = new Date().toISOString();
  const byKey = new Map<string, MapRecord>();

  for (const el of elements) {
    const tags = el.tags ?? {};
    const address = `${tags['addr:housenumber'] ?? ''} ${tags['addr:street'] ?? ''}`.trim();
    const point = el.type === 'node' ? { lat: el.lat, lon: el.lon } : el.center;
    const lat = Number(point?.lat);
    const lng = Number(point?.lon);
    if (!address || !isValidLatLng(lat, lng)) continue;

    const contact = {
      name: firstTag(tags, 'name', 'operator', 'brand'),
      phone: firstTag(tags, 'phone', 'contact:phone', 'contact:mobile'),
      email: firstTag(tags, 'email', 'contact:email'),
      website: firstTag(tags, 'website', 'contact:website', 'url')
    };

    // The same address often appears as a building plus a business node inside it: keep one, merge contacts.
    const key = `${address.toLowerCase().replace(/\s+/g, ' ')}|${tags['addr:postcode'] ?? ''}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.name ??= contact.name;
      existing.phone ??= contact.phone;
      existing.email ??= contact.email;
      existing.website ??= contact.website;
      continue;
    }

    const completeness = [tags['addr:city'], tags['addr:state'], tags['addr:postcode']].filter(Boolean).length;
    const externalId = `${el.type}/${el.id}`;
    byKey.set(key, {
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
      category: category(tags),
      yearBuilt: Number(tags.start_date) || undefined,
      ...contact,
      sourceUrl: `https://www.openstreetmap.org/${externalId}`,
      retrievedAt,
      fromStore: false,
      confidenceScore: Math.round((0.7 + completeness * 0.1) * 100)
    });
  }
  return [...byKey.values()];
}
