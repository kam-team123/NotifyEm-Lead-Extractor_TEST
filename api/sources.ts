import type { DataSourceStatus, SourcesResponse } from '../src/types/index.js';
import { handler, HttpError, json, readJson } from './_lib/http.js';
import { getSupabase, isSupabaseConfigured, requireSupabase } from './_lib/supabase.js';
import { readMlsConfig } from './_lib/reso.js';
import { inspectParcelLayer } from './_lib/arcgis.js';
import { catalogLayers, PARCEL_CATALOG, parcelSlug } from './_lib/parcelLayers.js';
import { stateCode } from './_lib/geo.js';

// GET    /api/sources                      — status of every data source (+ server config flags)
// POST   /api/sources  { url, state, name? } — connect a county/state ArcGIS parcel layer
// DELETE /api/sources?slug=parcel-layer:…   — disconnect a parcel layer

const CORE_SLUGS = ['county-parcels', 'osm', 'overture', 'kaggle', 'rpr', 'mls'];

interface SourceRow {
  id: string;
  slug: string;
  source_name: string;
  source_type: string;
  provider: string | null;
  access_type: string | null;
  cost: string | null;
  api_url: string | null;
  state: string | null;
  is_connected: boolean;
  is_live: boolean;
  last_sync_at: string | null;
  last_error: string | null;
  record_count: number | null;
  metadata: Record<string, unknown> | null;
}

function toStatus(row: SourceRow, recordCount: number): DataSourceStatus {
  return {
    slug: row.slug,
    name: row.source_name,
    sourceType: row.source_type,
    provider: row.provider ?? '',
    accessType: row.access_type ?? 'public',
    cost: row.cost ?? 'free',
    apiUrl: row.api_url,
    isConnected: row.is_connected,
    isLive: row.is_live,
    lastSyncAt: row.last_sync_at,
    lastError: row.last_error,
    recordCount,
    metadata: { ...(row.metadata ?? {}), state: row.state }
  };
}

export const GET = handler(async () => {
  const mls = readMlsConfig();
  const response: SourcesResponse = {
    supabaseConfigured: isSupabaseConfigured(),
    mls: {
      configured: Boolean(mls),
      name: mls?.name ?? '',
      isTestData: mls?.isTestData ?? false,
      cronEnabled: Boolean(process.env.CRON_SECRET)
    },
    sources: [],
    parcelLayers: []
  };

  const sb = getSupabase();
  if (!sb) {
    // Still list the connectors (live OSM and parcel layers work without Supabase).
    const names: Record<string, string> = {
      'county-parcels': 'County Tax Assessor / GIS Parcel Layers',
      osm: 'OpenStreetMap',
      overture: 'Overture Maps Foundation',
      kaggle: 'Kaggle Real Estate Datasets',
      rpr: 'Realtors Property Resource (RPR)',
      mls: 'MLS (RESO Web API)'
    };
    response.sources = CORE_SLUGS.map(slug => ({
      slug,
      name: names[slug],
      sourceType: slug,
      provider: '',
      accessType: 'public',
      cost: 'free',
      apiUrl: null,
      isConnected: slug === 'osm' || slug === 'county-parcels',
      isLive: slug === 'osm' || slug === 'county-parcels',
      lastSyncAt: null,
      lastError: null,
      recordCount: 0,
      metadata: {}
    }));
    response.parcelLayers = catalogLayers().map(layer => ({
      slug: layer.slug,
      name: layer.name,
      sourceType: 'gis_portal',
      provider: '',
      accessType: 'public',
      cost: 'free',
      apiUrl: layer.url,
      isConnected: true,
      isLive: true,
      lastSyncAt: null,
      lastError: null,
      recordCount: 0,
      metadata: { state: layer.state, builtIn: true }
    }));
    return json(response);
  }

  const { data, error } = await sb
    .from('data_sources')
    .select('id, slug, source_name, source_type, provider, access_type, cost, api_url, state, is_connected, is_live, last_sync_at, last_error, record_count, metadata')
    .not('slug', 'is', null);
  if (error) {
    response.supabaseError = /slug|column/i.test(error.message)
      ? `Supabase schema is out of date (${error.message}). Run supabase/0003_app_api.sql in the SQL editor.`
      : error.message;
    return json(response);
  }

  const rows = (data ?? []) as SourceRow[];
  const counts = await Promise.all(
    rows.map(async row => {
      const table = row.slug === 'mls' || row.slug === 'kaggle' ? 'listings' : 'properties';
      const { count } = await sb.from(table).select('id', { count: 'exact', head: true }).eq('source_id', row.id);
      return count ?? 0;
    })
  );
  const statuses = rows.map((row, i) => toStatus(row, counts[i]));

  response.sources = CORE_SLUGS.map(slug => statuses.find(s => s.slug === slug)).filter(Boolean) as DataSourceStatus[];
  if (!response.sources.length) {
    response.supabaseError = 'No data sources found. Run supabase/0003_app_api.sql in the Supabase SQL editor.';
  }

  // Parcel layers: verified catalog + layers connected from the app.
  const catalogSlugs = new Set(catalogLayers().map(l => l.slug));
  const layerStatuses = statuses.filter(s => s.slug.startsWith('parcel-layer:') && (s.isConnected || catalogSlugs.has(s.slug)));
  for (const s of layerStatuses) if (catalogSlugs.has(s.slug)) s.metadata.builtIn = true;
  for (const layer of catalogLayers()) {
    if (layerStatuses.some(s => s.slug === layer.slug)) continue;
    layerStatuses.push({
      slug: layer.slug,
      name: layer.name,
      sourceType: 'gis_portal',
      provider: PARCEL_CATALOG.find(c => c.url === layer.url)?.provider ?? 'State GIS',
      accessType: 'public',
      cost: 'free',
      apiUrl: layer.url,
      isConnected: true,
      isLive: true,
      lastSyncAt: null,
      lastError: null,
      recordCount: 0,
      metadata: { state: layer.state, builtIn: true }
    });
  }
  response.parcelLayers = layerStatuses.sort((a, b) => String(a.metadata.state).localeCompare(String(b.metadata.state)));
  return json(response);
});

export const POST = handler(async request => {
  const body = await readJson<{ url?: string; state?: string; name?: string }>(request);
  if (!body.url) throw new HttpError(400, 'Paste the ArcGIS REST URL of the parcel layer.');
  const state = stateCode(body.state);
  if (!state) throw new HttpError(400, 'Choose the state this parcel layer covers.');

  const sb = requireSupabase();
  const layer = await inspectParcelLayer(body.url);
  const slug = parcelSlug(layer.url);
  const name = (body.name?.trim() || `${layer.name} (${state})`).slice(0, 120);

  const { error } = await sb.from('data_sources').upsert(
    {
      slug,
      source_name: name,
      source_type: 'gis_portal',
      provider: new URL(layer.url).host,
      country: 'US',
      state,
      cost: 'free',
      license_type: 'Public',
      access_type: 'public',
      api_url: layer.url,
      is_connected: true,
      is_live: true,
      last_error: null,
      metadata: { fieldMap: layer.fieldMap, extent: layer.extent, layerName: layer.name },
      updated_at: new Date().toISOString()
    },
    { onConflict: 'slug' }
  );
  if (error) throw new HttpError(500, `Saving the parcel layer failed: ${error.message}`);

  return json({ slug, name, url: layer.url, fieldMap: layer.fieldMap, extent: layer.extent }, 201);
});

export const DELETE = handler(async request => {
  const slug = new URL(request.url).searchParams.get('slug') ?? '';
  if (!slug.startsWith('parcel-layer:')) throw new HttpError(400, 'Only parcel layers can be disconnected.');
  const sb = requireSupabase();
  const { error } = await sb.from('data_sources').update({ is_connected: false }).eq('slug', slug);
  if (error) throw new HttpError(500, error.message);
  return json({ ok: true });
});
