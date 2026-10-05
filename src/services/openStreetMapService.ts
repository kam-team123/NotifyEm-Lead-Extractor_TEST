import type { GeocodeResponse, MapRecord, MapSearchResponse } from '../types';
import { ApiError, apiGet } from './apiClient';

// All OpenStreetMap / parcel / Supabase lookups run server-side in /api. Calling Overpass and Nominatim
// straight from the browser failed on Vercel ("Failed to fetch"): Overpass answers 406/504 error pages
// without CORS headers, which the browser can only report as a network failure.

export type GeocodingResult = GeocodeResponse;
export type MappedBuilding = MapRecord;

/** Returns null when nothing matched; throws when the geocoding services are unavailable. */
export async function geocodeAddress(query: string): Promise<GeocodingResult | null> {
  const clean = query.trim();
  if (!clean) return null;
  try {
    return await apiGet<GeocodeResponse>(`/api/geocode?q=${encodeURIComponent(clean)}`, 20000);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404 && !/not found\. Deploy/.test(error.message)) return null;
    throw error;
  }
}

/** Which live source the Lead Finder searches; saved Supabase records are always included. */
export type LiveSource = 'realty' | 'osm' | 'both';

const SOURCE_PARAM: Record<LiveSource, string> = { realty: 'stored,realty', osm: 'stored,osm', both: 'stored,realty,osm' };

export async function searchMapRecords(lat: number, lng: number, radiusMiles: number, source: LiveSource): Promise<MapSearchResponse> {
  const params = new URLSearchParams({ lat: lat.toFixed(6), lng: lng.toFixed(6), radius: String(radiusMiles), sources: SOURCE_PARAM[source] });
  return apiGet<MapSearchResponse>(`/api/map-search?${params}`, 65000);
}
