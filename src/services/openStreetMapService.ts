export interface GeocodingResult {
  displayName: string;
  lat: number;
  lng: number;
  sourceUrl: string;
  streetAddress?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
}

export interface MappedBuilding {
  id: string;
  name: string;
  type: 'OSM-mapped building';
  category: string;
  address: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  source: 'OpenStreetMap';
  sourceUrl: string;
  retrievedAt: string;
  verificationStatus: 'Source record validated';
  confidenceScore: number;
}

export async function geocodeAddress(query: string): Promise<GeocodingResult | null> {
  const clean = query.trim();
  if (!clean) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(clean)}&countrycodes=us&format=jsonv2&addressdetails=1&limit=1`;
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) return null;

    const results = await response.json();
    const item = results[0];
    if (!item) return null;
    const lat = Number(item.lat);
    const lng = Number(item.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

    return {
      displayName: item.display_name,
      lat,
      lng,
      sourceUrl: item.osm_type && item.osm_id
        ? `https://www.openstreetmap.org/${item.osm_type}/${item.osm_id}`
        : `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`,
      streetAddress: item.address?.house_number && item.address?.road
        ? `${item.address.house_number} ${item.address.road}`
        : undefined,
      city: item.address?.city || item.address?.town || item.address?.village || item.address?.municipality,
      state: item.address?.state,
      country: item.address?.country,
      postalCode: item.address?.postcode
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export async function findMappedBuildings(lat: number, lng: number, radiusMiles: number): Promise<MappedBuilding[]> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || radiusMiles <= 0) return [];
  const radiusMeters = Math.min(radiusMiles * 1609.34, 40000);
  const query = `[out:json][timeout:25];(nwr(around:${radiusMeters},${lat},${lng})[building]["addr:housenumber"]["addr:street"];);out center tags 100;`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: new URLSearchParams({ data: query }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`OpenStreetMap query failed (${response.status}).`);

    const payload: { elements?: OverpassElement[] } = await response.json();
    const retrievedAt = new Date().toISOString();
    const seenAddresses = new Set<string>();
    const buildings: MappedBuilding[] = [];

    for (const element of payload.elements ?? []) {
      const tags = element.tags ?? {};
      const address = `${tags['addr:housenumber'] ?? ''} ${tags['addr:street'] ?? ''}`.trim();
      const point = element.type === 'node' ? { lat: element.lat, lon: element.lon } : element.center;
      const pointLat = Number(point?.lat);
      const pointLng = Number(point?.lon);
      if (!address || !Number.isFinite(pointLat) || !Number.isFinite(pointLng)) continue;
      if (pointLat < -90 || pointLat > 90 || pointLng < -180 || pointLng > 180) continue;

      const normalizedAddress = address.toLowerCase().replace(/\s+/g, ' ');
      if (seenAddresses.has(normalizedAddress)) continue;
      seenAddresses.add(normalizedAddress);

      const completeness = [tags['addr:city'], tags['addr:state'], tags['addr:postcode']].filter(Boolean).length;
      buildings.push({
        id: `${element.type}/${element.id}`,
        name: address,
        type: 'OSM-mapped building',
        category: tags.building || 'Building',
        address,
        city: tags['addr:city'] || '',
        state: tags['addr:state'] || '',
        lat: pointLat,
        lng: pointLng,
        source: 'OpenStreetMap',
        sourceUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
        retrievedAt,
        verificationStatus: 'Source record validated',
        confidenceScore: Math.round((0.7 + completeness * 0.1) * 100)
      });
    }

    return buildings;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('OpenStreetMap query timed out. Try a smaller radius and retry.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}