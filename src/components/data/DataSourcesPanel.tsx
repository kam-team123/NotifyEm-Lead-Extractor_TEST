import React, { useEffect, useState } from 'react';
import { AlertTriangle, ChevronDown, ExternalLink, RefreshCw } from 'lucide-react';
import type { DataSourceStatus, SourcesResponse } from '../../types';
import { apiGet } from '../../services/apiClient';
import { KaggleImportModal } from './KaggleImportModal';

interface Props {
  /** Bumped by the parent after a search so record counts refresh. */
  refreshKey: number;
  onOpenListings: () => void;
}

const OPEN_KEY = 'notifyem.dataSourcesOpen';

const DESCRIPTIONS: Record<string, { type: string; coverage: string; detail: string }> = {
  osm: { type: 'Open map data', coverage: 'Global', detail: 'Address-tagged buildings near each search, fetched live and cached in Supabase.' },
  realtor: {
    type: 'Live listing search · paid API',
    coverage: 'US listing coverage',
    detail: 'For-sale listings searched live in the Lead Finder through RealtyAPI. Requires a RealtyAPI key and paid credits; results are cached in Supabase.'
  },
  overture: {
    type: 'Open base map data',
    coverage: 'Global',
    detail: 'Address points loaded into Supabase with scripts/import-overture.mjs (DuckDB over Overture S3).'
  },
  kaggle: { type: 'Dataset downloads', coverage: 'National and state sample sets', detail: 'Historical listing snapshots imported from CSV.' },
  rpr: {
    type: 'Licensed realtor access',
    coverage: 'US national',
    detail: 'RPR has no public data API. Research properties on narrpr.com with a REALTOR® login.'
  },
  mls: { type: 'Licensed listing feed', coverage: 'Your MLS', detail: 'Active and pending listings from a RESO Web API feed, synced daily.' }
};

function badge(source: DataSourceStatus, mls: SourcesResponse['mls'], realtyConfigured: boolean): { text: string; tone: string } {
  if (source.slug === 'rpr') return { text: 'Members only', tone: 'neutral' };
  if (source.slug === 'realtor') {
    return realtyConfigured
      ? { text: 'Live search ready', tone: 'ok' }
      : { text: 'API key needed', tone: 'neutral' };
  }
  if (source.slug === 'mls') {
    if (!mls.configured) return { text: 'Not configured', tone: 'neutral' };
    if (source.lastError) return { text: 'Sync error', tone: 'error' };
    return { text: mls.isTestData ? 'Sandbox feed' : 'Connected', tone: mls.isTestData ? 'warn' : 'ok' };
  }
  if (source.lastError) return { text: 'Error', tone: 'error' };
  if (source.recordCount > 0) return { text: `${source.recordCount.toLocaleString()} in Supabase`, tone: 'ok' };
  if (source.slug === 'osm') return { text: 'Live', tone: 'ok' };
  return { text: 'Empty', tone: 'neutral' };
}

const TONES: Record<string, string> = {
  ok: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30',
  warn: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  error: 'bg-rose-500/10 text-rose-300 border-rose-500/30',
  neutral: 'bg-neutral-800 text-neutral-400 border-neutral-700'
};

export const DataSourcesPanel: React.FC<Props> = ({ refreshKey, onOpenListings }) => {
  const [data, setData] = useState<SourcesResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showKaggle, setShowKaggle] = useState(false);
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(OPEN_KEY) === '1';
    } catch {
      return false;
    }
  });

  const load = async () => {
    setLoading(true);
    try {
      setData(await apiGet<SourcesResponse>('/api/sources', 30000));
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not load data sources.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [refreshKey]);

  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(OPEN_KEY, next ? '1' : '0');
    } catch {
      // Storage unavailable; the panel just won't remember its state.
    }
  };

  const sources = data?.sources ?? [];
  const totalRecords = sources.reduce((sum, source) => sum + (source.recordCount || 0), 0);
  const hasProblem = Boolean(loadError || data?.supabaseError || (data && !data.supabaseConfigured) || sources.some(s => s.lastError));

  return (
    <div className="px-4 py-3 border-b border-neutral-800 bg-neutral-950/60 shrink-0">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={toggleOpen}
          aria-expanded={open}
          className="flex-1 min-w-0 flex items-center gap-2 text-left cursor-pointer group"
        >
          <div className="w-2 h-2 shrink-0 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.6)]" />
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-200 group-hover:text-cyan-300">
              Real Estate Data Sources
            </div>
            {!open && (
              <div className="mt-0.5 text-[10px] text-neutral-500 truncate">
                {data
                  ? `${sources.length} sources · ${totalRecords.toLocaleString()} records`
                  : loading ? 'Loading…' : 'Click to view sources'}
                {hasProblem && <span className="text-amber-300"> · needs attention</span>}
              </div>
            )}
          </div>
          <ChevronDown className={`w-4 h-4 ml-auto shrink-0 text-neutral-500 group-hover:text-cyan-300 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        <button onClick={() => void load()} title="Refresh status" className="p-1 text-neutral-500 hover:text-cyan-300 cursor-pointer">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {open && (
      <div className="mt-2">
      {(loadError || data?.supabaseError || (data && !data.supabaseConfigured)) && (
        <div className="mb-2 p-2 rounded border border-amber-500/30 bg-amber-500/5 text-[11px] text-amber-200 flex gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            {loadError ||
              data?.supabaseError ||
              'Supabase is not configured on the server. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel → Settings → Environment Variables, then redeploy. Live OSM search still works.'}
          </span>
        </div>
      )}

      <div className="space-y-2">
        {sources.map(source => {
          const info = DESCRIPTIONS[source.slug];
          const b = badge(source, data!.mls, data!.realty.configured);
          return (
            <div key={source.slug} className="rounded-md border border-neutral-800 bg-neutral-900/70 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[12px] font-semibold text-neutral-100">{source.name}</div>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border whitespace-nowrap ${TONES[b.tone]}`}>{b.text}</span>
              </div>
              {info && (
                <>
                  <div className="mt-1 text-[10px] text-neutral-400">
                    <span className="text-neutral-300">{info.type}</span> · {info.coverage}
                  </div>
                  <div className="mt-1 text-[10px] text-neutral-400 leading-relaxed">{info.detail}</div>
                </>
              )}
              {source.slug === 'realtor' && source.recordCount > 0 && (
                <div className="mt-1 text-[10px] text-neutral-500">{source.recordCount.toLocaleString()} listings cached in Supabase</div>
              )}
              {source.lastError && <div className="mt-1 text-[10px] text-rose-300 break-words">Last error: {source.lastError}</div>}
              {source.lastSyncAt && (
                <div className="mt-1 text-[10px] text-neutral-500">Last update {new Date(source.lastSyncAt).toLocaleString()}</div>
              )}

              {source.slug === 'overture' && (
                <div className="mt-1.5 text-[10px] text-neutral-500">
                  Load an area: <span className="font-mono text-neutral-300">npm run import:overture -- --place "Austin, TX" --radius 5</span>
                </div>
              )}
              {source.slug === 'kaggle' && (
                <button onClick={() => setShowKaggle(true)} disabled={!data?.supabaseConfigured}
                  className="mt-1.5 text-[11px] text-cyan-300 hover:underline cursor-pointer disabled:opacity-50">
                  Import a Kaggle CSV…
                </button>
              )}
              {source.slug === 'rpr' && (
                <a href="https://www.narrpr.com" target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-cyan-300 hover:underline">
                  Open RPR <ExternalLink className="w-3 h-3" />
                </a>
              )}
              {source.slug === 'realtor' && (
                <a href="https://realtyapi.io" target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-cyan-300 hover:underline">
                  Get a RealtyAPI key <ExternalLink className="w-3 h-3" />
                </a>
              )}
              {source.slug === 'mls' && (
                <button onClick={onOpenListings} className="mt-1.5 text-[11px] text-cyan-300 hover:underline cursor-pointer">
                  {data!.mls.configured ? `${data!.mls.name} → open Listings` : 'How to connect your MLS → Listings'}
                </button>
              )}
            </div>
          );
        })}
      </div>
      </div>
      )}

      {showKaggle && (
        <KaggleImportModal onClose={() => setShowKaggle(false)} onImported={() => void load()} />
      )}
    </div>
  );
};
