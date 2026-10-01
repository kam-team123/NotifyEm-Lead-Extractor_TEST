import type { GeocodeResponse } from '../src/types/index.js';
import { fetchWithTimeout, handler, HttpError, json } from './_lib/http.js';
import { isValidLatLng, stateCode } from './_lib/geo.js';

// GET /api/geocode?q=Austin, TX
// Nominatim (OSM) server-side with a proper User-Agent, falling back to Photon (komoot) when Nominatim
// rate-limits or blocks the shared Vercel egress IP.

const cache = new Map<string, GeocodeResponse>();

async function nominatim(q: string): Promise<GeocodeResponse | null> {
  const params = new URLSearchParams({ q, countrycodes: 'us', format: 'jsonv2', addressdetails: '1', limit: '1' });
  if (process.env.NOMINATIM_EMAIL) params.set('email', process.env.NOMINATIM_EMAIL);
  const response = await fetchWithTimeout(`https://nominatim.openstreetmap.org/search?${params}`, {}, 8000);
  if (!response.ok) throw new Error(`Nominatim HTTP ${response.status}`);
  const [item] = (await response.json()) as any[];
  if (!item) return null;
  const lat = Number(item.lat);
  const lng = Number(item.lon);
  if (!isValidLatLng(lat, lng)) return null;
  const addr = item.address ?? {};
  return {
    displayName: item.display_name,
    lat,
    lng,
    streetAddress: addr.house_number && addr.road ? `${addr.house_number} ${addr.road}` : undefined,
    city: addr.city || addr.town || addr.village || addr.municipality || addr.county,
    state: stateCode(addr.state) || addr.state,
    postalCode: addr.postcode,
    provider: 'Nominatim (OpenStreetMap)',
    sourceUrl: item.osm_type && item.osm_id
      ? `https://www.openstreetmap.org/${item.osm_type}/${item.osm_id}`
      : `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`
  };
}

async function photon(q: string): Promise<GeocodeResponse | null> {
  // Bias to the contiguous US; filter to US results below.
  const params = new URLSearchParams({ q, limit: '5', lang: 'en', bbox: '-179.9,18.0,-66.0,71.5' });
  const response = await fetchWithTimeout(`https://photon.komoot.io/api/?${params}`, {}, 8000);
  if (!response.ok) throw new Error(`Photon HTTP ${response.status}`);
  const body = (await response.json()) as { features?: any[] };
  const feature = (body.features ?? []).find(f => f.properties?.countrycode === 'US');
  if (!feature) return null;
  const [lng, lat] = feature.geometry.coordinates as [number, number];
  if (!isValidLatLng(lat, lng)) return null;
  const p = feature.properties;
  const name = [p.housenumber && p.street ? `${p.housenumber} ${p.street}` : p.name, p.city, p.state, p.postcode, 'United States']
    .filter(Boolean)
    .join(', ');
  return {
    displayName: name,
    lat,
    lng,
    streetAddress: p.housenumber && p.street ? `${p.housenumber} ${p.street}` : undefined,
    city: p.city || p.county,
    state: stateCode(p.state) || p.state,
    postalCode: p.postcode,
    provider: 'Photon (OpenStreetMap)',
    sourceUrl: p.osm_type && p.osm_id
      ? `https://www.openstreetmap.org/${({ N: 'node', W: 'way', R: 'relation' } as Record<string, string>)[p.osm_type] || 'node'}/${p.osm_id}`
      : `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`
  };
}

export const GET = handler(async request => {
  const q = new URL(request.url).searchParams.get('q')?.trim() ?? '';
  if (!q) throw new HttpError(400, 'Missing ?q= search text.');
  if (q.length > 200) throw new HttpError(400, 'Search text is too long.');

  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit) return json(hit, 200, { 'cache-control': 'public, s-maxage=86400' });

  const errors: string[] = [];
  for (const provider of [nominatim, photon]) {
    try {
      const result = await provider(q);
      if (result) {
        if (cache.size > 500) cache.clear();
        cache.set(key, result);
        return json(result, 200, { 'cache-control': 'public, s-maxage=86400' });
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (errors.length === 2) throw new HttpError(502, `Geocoding services are unavailable (${errors.join('; ')}).`);
  throw new HttpError(404, `No US location matched "${q}".`);
});
