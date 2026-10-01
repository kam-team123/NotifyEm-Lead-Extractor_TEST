import type { SupabaseClient } from '@supabase/supabase-js';
import type { MapRecord } from '../../src/types/index.js';
import { BBox } from './geo.js';
import { sourceIdBySlug } from './supabase.js';

const PROPERTY_COLUMNS =
  'id, external_id, street_address, full_address, owner_name, parcel_id, city, state, zip_code, latitude, longitude, ' +
  'property_type, year_built, tax_assessed_value, confidence_score, source_url, metadata, updated_at, ' +
  'data_sources ( slug, source_name )';

interface StoredPropertyRow {
  id: string;
  external_id: string | null;
  street_address: string | null;
  full_address: string | null;
  owner_name: string | null;
  parcel_id: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  latitude: number | null;
  longitude: number | null;
  property_type: string | null;
  year_built: number | null;
  tax_assessed_value: number | null;
  confidence_score: number | null;
  source_url: string | null;
  metadata: Record<string, unknown> | null;
  updated_at: string;
  data_sources: { slug: string | null; source_name: string | null } | null;
}

function normalizeSourceUrl(value: string | null): string {
  if (!value) return '';
  try {
    const url = new URL(value);
    if (/\/query$/i.test(url.pathname) && url.searchParams.get('f')?.toLowerCase() === 'html') {
      url.searchParams.set('f', 'json');
    }
    return url.toString();
  } catch {
    return value;
  }
}

/** Properties already in Supabase (from earlier searches, Overture/Kaggle imports, MLS syncs) inside a bbox. */
export async function queryStoredRecords(sb: SupabaseClient, box: BBox, limit: number): Promise<MapRecord[]> {
  const { data, error } = await sb
    .from('properties')
    .select(PROPERTY_COLUMNS)
    .gte('latitude', box.south)
    .lte('latitude', box.north)
    .gte('longitude', box.west)
    .lte('longitude', box.east)
    .limit(limit);
  if (error) throw new Error(error.message);

  return ((data ?? []) as unknown as StoredPropertyRow[])
    .filter(row => row.latitude !== null && row.longitude !== null)
    .map(row => {
      const slug = row.data_sources?.slug || 'stored';
      const externalId = row.external_id || row.id;
      return {
        id: `${slug}:${externalId}`,
        sourceSlug: slug,
        sourceLabel: row.data_sources?.source_name || 'Supabase',
        externalId,
        address: row.street_address || row.full_address || (row.parcel_id ? `Parcel ${row.parcel_id}` : 'Unknown address'),
        city: row.city || '',
        state: row.state || '',
        postalCode: row.zip_code || '',
        lat: Number(row.latitude),
        lng: Number(row.longitude),
        category: row.property_type || 'Property',
        ownerName: row.owner_name || undefined,
        parcelId: row.parcel_id || undefined,
        assessedValue: row.tax_assessed_value ? Number(row.tax_assessed_value) : undefined,
        yearBuilt: row.year_built || undefined,
        lotAcres: typeof row.metadata?.lotAcres === 'number' ? row.metadata.lotAcres : undefined,
        sourceUrl: normalizeSourceUrl(row.source_url),
        retrievedAt: row.updated_at,
        fromStore: true,
        confidenceScore: row.confidence_score ? Number(row.confidence_score) : 70
      } satisfies MapRecord;
    });
}

/** Upserts live map records into public.properties keyed by (source_id, external_id). */
export async function persistRecords(sb: SupabaseClient, records: MapRecord[]): Promise<number> {
  // One row per (source, external id): a batch upsert may not touch the same row twice.
  const unique = new Map(records.map(r => [r.id, r]));
  const bySlug = new Map<string, MapRecord[]>();
  for (const record of unique.values()) {
    const list = bySlug.get(record.sourceSlug) ?? [];
    list.push(record);
    bySlug.set(record.sourceSlug, list);
  }

  let saved = 0;
  for (const [slug, list] of bySlug) {
    const sourceId = await sourceIdBySlug(sb, slug);
    const rows = list.map(r => ({
      source_id: sourceId,
      external_id: r.externalId,
      street_address: r.address,
      full_address: [r.address, r.city, [r.state, r.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', '),
      owner_name: r.ownerName ?? null,
      parcel_id: r.parcelId ?? null,
      city: r.city || null,
      state: r.state || null,
      zip_code: r.postalCode || null,
      latitude: r.lat,
      longitude: r.lng,
      property_type: r.category,
      year_built: r.yearBuilt && r.yearBuilt > 1600 && r.yearBuilt < 2100 ? Math.round(r.yearBuilt) : null,
      tax_assessed_value: r.assessedValue ?? null,
      confidence_score: r.confidenceScore,
      source_url: r.sourceUrl,
      verification_status: 'source_record',
      metadata: r.lotAcres ? { lotAcres: r.lotAcres } : {},
      updated_at: new Date().toISOString()
    }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await sb.from('properties').upsert(rows.slice(i, i + 500), { onConflict: 'source_id,external_id' });
      if (error) throw new Error(error.message);
      saved += Math.min(500, rows.length - i);
    }
  }
  return saved;
}
