import type { DataSourceStatus, SourcesResponse } from '../src/types/index.js';
import { handler, json } from './_lib/http.js';
import { getSupabase, isSupabaseConfigured } from './_lib/supabase.js';
import { readMlsConfig } from './_lib/reso.js';
import { realtyConfigured } from './_lib/realty.js';
// GET /api/sources — status of every supported data source (+ server config flags)

const CORE_SLUGS = ['osm', 'realtor', 'overture', 'kaggle', 'rpr', 'mls'];

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
    realty: {
      configured: realtyConfigured()
    },
    mls: {
      configured: Boolean(mls),
      name: mls?.name ?? '',
      isTestData: mls?.isTestData ?? false,
      cronEnabled: Boolean(process.env.CRON_SECRET)
    },
    sources: []
  };

  const sb = getSupabase();
  if (!sb) {
    // Still list sources that can operate without Supabase.
    const names: Record<string, string> = {
      osm: 'OpenStreetMap',
      realtor: 'Realtor.com (via RealtyAPI)',
      overture: 'Overture Maps Foundation',
      kaggle: 'Kaggle Real Estate Datasets',
      rpr: 'Realtors Property Resource (RPR)',
      mls: 'MLS (RESO Web API)'
    };
    response.sources = CORE_SLUGS.map(slug => ({
      slug,
      name: names[slug],
      sourceType: slug,
      provider: slug === 'realtor' ? 'RealtyAPI' : '',
      accessType: slug === 'realtor' ? 'licensed' : 'public',
      cost: slug === 'realtor' ? 'paid credits' : 'free',
      apiUrl: slug === 'realtor' ? 'https://realtor.realtyapi.io' : null,
      isConnected: slug === 'osm' || (slug === 'realtor' && response.realty.configured),
      isLive: slug === 'osm' || slug === 'realtor',
      lastSyncAt: null,
      lastError: null,
      recordCount: 0,
      metadata: {}
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
  if (!statuses.some(source => source.slug === 'realtor')) {
    statuses.push({
      slug: 'realtor',
      name: 'Realtor.com (via RealtyAPI)',
      sourceType: 'other',
      provider: 'RealtyAPI',
      accessType: 'licensed',
      cost: 'paid credits',
      apiUrl: 'https://realtor.realtyapi.io',
      isConnected: response.realty.configured,
      isLive: true,
      lastSyncAt: null,
      lastError: null,
      recordCount: 0,
      metadata: {}
    });
  }

  response.sources = CORE_SLUGS.map(slug => statuses.find(s => s.slug === slug)).filter(Boolean) as DataSourceStatus[];
  if (!response.sources.length) {
    response.supabaseError = 'No data sources found. Run supabase/0003_app_api.sql in the Supabase SQL editor.';
  }

  return json(response);
});
