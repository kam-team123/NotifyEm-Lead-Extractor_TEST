import type { MapRecord } from '../../src/types/index.js';
import { fetchWithTimeout, HttpError } from './http.js';
import { BBox, isValidLatLng, stateCode } from './geo.js';

// Connector for county / statewide parcel layers published as ArcGIS REST Feature or Map services.
// Most US county assessor + GIS portals publish parcels this way, free and without an API key.

export interface ParcelFieldMap {
  parcelId: string | null;
  address: string | null;
  city: string | null;
  zip: string | null;
  owner: string | null;
  assessedValue: string | null;
  landUse: string | null;
  yearBuilt: string | null;
  lotAcres: string | null;
}

export interface ParcelLayerConfig {
  slug: string;
  name: string;
  url: string;
  state: string;
  fieldMap: ParcelFieldMap;
  extent: BBox | null;
}

interface ArcGisField {
  name: string;
  alias?: string;
  type: string;
}

const FIELD_PATTERNS: Record<keyof ParcelFieldMap, RegExp[]> = {
  parcelId: [/^(parcel_?id|parcelid|parcel_?no|parcel_?num(ber)?|parno|pin|apn|pid|parcel)$/i, /parcel|^pin|apn/i],
  address: [
    /^(site|situs|prop|property|loc|location|phys|physical|full)_?(addr|address|adr)(ess)?(_?full|_?1)?$/i,
    /^(address|siteaddress|situsaddr|siteadd|addr_full|fulladdr|full_address)$/i,
    /situs|site_?add|prop_?add|loc_?add/i
  ],
  city: [/^(site|situs|prop|phy|loc)_?(city|cty)$/i, /^(city|municipality|muni_?name|pstlcity|postal_?city)$/i, /city/i],
  zip: [/^(site|situs|prop|phy|loc)_?zip(_?code)?$/i, /^(zip|zip_?code|zipcode|postal_?code|pstlzip5?)$/i, /zip/i],
  owner: [/^(owner|owner_?name|ownername|own_?name|ownernme1?|owner1|own1|ownname)$/i, /owner|^own_/i],
  assessedValue: [
    /^(tot_?val|total_?value|totalvalue|tot_?assess|total_?assessed|just_?val|jv|cntassdval|assessed_?value|appraised_?value|market_?value|mkt_?val|totvalue|parval|tot_?appr)$/i,
    /(total|tot|just|assess|appr|market|mkt).*(val|value)/i
  ],
  landUse: [/^(land_?use|landuse|use_?code|usecode|prop_?class|propclass|class|luc|dor_?uc|land_?use_?code|usedesc|use_?desc)$/i, /land_?use|use_?code|prop_?class/i],
  yearBuilt: [/^(yr_?blt|year_?built|yearbuilt|act_?yr_?blt|eff_?yr_?blt|yrblt)$/i, /year_?built|yr_?bu?i?lt/i],
  lotAcres: [/^(acres|gis_?acres|gisacres|deed_?acres|calc_?acres|calcacres|acreage|ll_gisacre)$/i, /acre/i]
};

export function guessFieldMap(fields: ArcGisField[]): ParcelFieldMap {
  const map = {} as ParcelFieldMap;
  const used = new Set<string>();
  for (const key of Object.keys(FIELD_PATTERNS) as (keyof ParcelFieldMap)[]) {
    map[key] = null;
    for (const pattern of FIELD_PATTERNS[key]) {
      const hit = fields.find(f => !used.has(f.name) && (pattern.test(f.name) || (f.alias ? pattern.test(f.alias) : false)));
      if (hit) {
        map[key] = hit.name;
        used.add(hit.name);
        break;
      }
    }
  }
  return map;
}

function webMercatorToLngLat(x: number, y: number): [number, number] {
  const lng = (x / 20037508.34) * 180;
  const lat = (Math.atan(Math.exp((y / 20037508.34) * Math.PI)) * 360) / Math.PI - 90;
  return [lng, lat];
}

/** Normalises a pasted URL to a single layer endpoint (…/FeatureServer/0 or …/MapServer/3). */
export function normaliseLayerUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new HttpError(400, 'Enter a full https:// ArcGIS REST layer URL.');
  }
  if (url.protocol !== 'https:') throw new HttpError(400, 'Only https:// layer URLs are supported.');
  url.search = '';
  url.hash = '';
  let path = url.pathname.replace(/\/+$/, '').replace(/\/query$/i, '');
  if (/\/(FeatureServer|MapServer)$/i.test(path)) path += '/0';
  if (!/\/(FeatureServer|MapServer)\/\d+$/i.test(path)) {
    throw new HttpError(400, 'URL must point to an ArcGIS REST layer, e.g. https://…/arcgis/rest/services/Parcels/FeatureServer/0');
  }
  url.pathname = path;
  return url.toString();
}

export async function inspectParcelLayer(rawUrl: string): Promise<{
  url: string;
  name: string;
  fields: ArcGisField[];
  fieldMap: ParcelFieldMap;
  extent: BBox | null;
}> {
  const url = normaliseLayerUrl(rawUrl);
  const response = await fetchWithTimeout(`${url}?f=json`, {}, 20000);
  if (!response.ok) throw new HttpError(400, `Layer returned HTTP ${response.status}.`);
  const info = (await response.json()) as {
    error?: { message?: string };
    name?: string;
    type?: string;
    capabilities?: string;
    fields?: ArcGisField[];
    extent?: { xmin: number; ymin: number; xmax: number; ymax: number; spatialReference?: { wkid?: number; latestWkid?: number } };
  };
  if (info.error) throw new HttpError(400, `ArcGIS error: ${info.error.message || 'unknown'}`);
  if (!info.fields?.length) throw new HttpError(400, 'This URL is not a queryable feature layer (no fields). Pick a specific layer number.');
  if (info.capabilities && !/query/i.test(info.capabilities)) throw new HttpError(400, 'This layer does not allow queries.');

  const fieldMap = guessFieldMap(info.fields);
  if (!fieldMap.address && !fieldMap.parcelId) {
    throw new HttpError(400, 'Could not find an address or parcel-id field in this layer. Is it a parcel layer?');
  }

  // Prefer a server-projected WGS84 extent; fall back to the layer's own extent when it is 4326/3857.
  let extent: BBox | null = null;
  try {
    const ext = await fetchWithTimeout(`${url}/query?where=1%3D1&returnExtentOnly=true&outSR=4326&f=json`, {}, 20000);
    const body = (await ext.json()) as { extent?: { xmin: number; ymin: number; xmax: number; ymax: number } };
    if (body.extent && isValidLatLng(body.extent.ymin, body.extent.xmin) && isValidLatLng(body.extent.ymax, body.extent.xmax)) {
      extent = { west: body.extent.xmin, south: body.extent.ymin, east: body.extent.xmax, north: body.extent.ymax };
    }
  } catch {
    // ignore; handled below
  }
  if (!extent && info.extent) {
    const wkid = info.extent.spatialReference?.latestWkid || info.extent.spatialReference?.wkid;
    if (wkid === 4326) {
      extent = { west: info.extent.xmin, south: info.extent.ymin, east: info.extent.xmax, north: info.extent.ymax };
    } else if (wkid === 3857 || wkid === 102100) {
      const [w, s] = webMercatorToLngLat(info.extent.xmin, info.extent.ymin);
      const [e, n] = webMercatorToLngLat(info.extent.xmax, info.extent.ymax);
      extent = { west: w, south: s, east: e, north: n };
    }
  }

  return { url, name: info.name || 'Parcel layer', fields: info.fields, fieldMap, extent };
}

export function extentContains(extent: BBox | null, lat: number, lng: number): boolean {
  if (!extent) return true; // unknown extent: try it
  return lat >= extent.south && lat <= extent.north && lng >= extent.west && lng <= extent.east;
}

interface ArcGisFeature {
  attributes: Record<string, unknown>;
  geometry?: { x?: number; y?: number; rings?: number[][][] };
}

function centroid(geometry: ArcGisFeature['geometry']): [number, number] | null {
  if (!geometry) return null;
  if (typeof geometry.x === 'number' && typeof geometry.y === 'number') return [geometry.y, geometry.x];
  const ring = geometry.rings?.[0];
  if (!ring?.length) return null;
  let sx = 0;
  let sy = 0;
  for (const [x, y] of ring) {
    sx += x;
    sy += y;
  }
  return [sy / ring.length, sx / ring.length];
}

function pick(attributes: Record<string, unknown>, field: string | null): unknown {
  if (!field) return undefined;
  if (!field.includes('+')) return attributes[field];
  return field.split('+').map(f => str(attributes[f])).filter(Boolean).join(' ');
}

function str(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function num(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[$,]/g, ''));
  return Number.isFinite(n) && n !== 0 ? n : undefined;
}

export async function queryParcelLayer(layer: ParcelLayerConfig, box: BBox, limit: number, timeoutMs: number): Promise<MapRecord[]> {
  const fm = layer.fieldMap;
  // A mapped field may join several columns with '+', e.g. 'HOUSE_NO+STREET_NM'.
  const outFields = Array.from(new Set((Object.values(fm).filter(Boolean) as string[]).flatMap(f => f.split('+'))));
  const params = new URLSearchParams({
    where: '1=1',
    geometry: `${box.west},${box.south},${box.east},${box.north}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: outFields.join(',') || '*',
    returnGeometry: 'true',
    outSR: '4326',
    geometryPrecision: '6',
    maxAllowableOffset: '0.00005',
    resultRecordCount: String(limit),
    f: 'json'
  });

  let response = await fetchWithTimeout(`${layer.url}/query?${params}`, {}, timeoutMs);
  let body = (await response.json()) as { features?: ArcGisFeature[]; error?: { message?: string } };
  if (body.error) {
    // Older MapServers reject resultRecordCount / maxAllowableOffset; retry with the basics.
    params.delete('resultRecordCount');
    params.delete('maxAllowableOffset');
    response = await fetchWithTimeout(`${layer.url}/query?${params}`, {}, timeoutMs);
    body = (await response.json()) as typeof body;
    if (body.error) throw new Error(body.error.message || 'ArcGIS query failed');
  }

  const retrievedAt = new Date().toISOString();
  const records: MapRecord[] = [];
  for (const feature of (body.features ?? []).slice(0, limit)) {
    const a = feature.attributes ?? {};
    const point = centroid(feature.geometry);
    if (!point || !isValidLatLng(point[0], point[1])) continue;
    const parcelId = fm.parcelId ? str(pick(a, fm.parcelId)) : '';
    const address = fm.address ? str(pick(a, fm.address)) : '';
    if (!address && !parcelId) continue;
    const externalId = parcelId || `${point[0].toFixed(6)},${point[1].toFixed(6)}`;
    const filled = [address, fm.owner && pick(a, fm.owner), fm.assessedValue && pick(a, fm.assessedValue), parcelId].filter(Boolean).length;

    records.push({
      id: `${layer.slug}:${externalId}`,
      sourceSlug: layer.slug,
      sourceLabel: layer.name,
      externalId,
      address: address || `Parcel ${parcelId}`,
      city: fm.city ? str(pick(a, fm.city)) : '',
      state: stateCode(layer.state) || layer.state,
      postalCode: fm.zip ? str(pick(a, fm.zip)).slice(0, 10) : '',
      lat: point[0],
      lng: point[1],
      category: (fm.landUse && str(pick(a, fm.landUse))) || 'Parcel',
      ownerName: fm.owner ? str(pick(a, fm.owner)) || undefined : undefined,
      parcelId: parcelId || undefined,
      assessedValue: fm.assessedValue ? num(pick(a, fm.assessedValue)) : undefined,
      yearBuilt: fm.yearBuilt ? num(pick(a, fm.yearBuilt)) : undefined,
      lotAcres: fm.lotAcres ? num(pick(a, fm.lotAcres)) : undefined,
      sourceUrl: parcelId && fm.parcelId
        ? `${layer.url}/query?where=${encodeURIComponent(`${fm.parcelId}='${parcelId.replace(/'/g, "''")}'`)}&outFields=*&f=html`
        : layer.url,
      retrievedAt,
      fromStore: false,
      confidenceScore: 60 + filled * 10
    });
  }
  return records;
}
