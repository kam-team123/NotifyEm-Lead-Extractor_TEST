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

export async function searchMapRecords(lat: number, lng: number, radiusMiles: number): Promise<MapSearchResponse> {
  const params = new URLSearchParams({ lat: lat.toFixed(6), lng: lng.toFixed(6), radius: String(radiusMiles) });
  return apiGet<MapSearchResponse>(`/api/map-search?${params}`, 65000);
}
