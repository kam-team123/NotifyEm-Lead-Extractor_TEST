import React, { useEffect, useState } from 'react';
import { AlertTriangle, ExternalLink, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { DataSourceStatus, SourcesResponse } from '../../types';
import { US_STATES } from '../../data/referenceData';
import { apiGet, apiSend } from '../../services/apiClient';
import { KaggleImportModal } from './KaggleImportModal';

interface Props {
  /** Bumped by the parent after a search so record counts refresh. */
  refreshKey: number;
  onOpenListings: () => void;
}

const DESCRIPTIONS: Record<string, { type: string; coverage: string; detail: string }> = {
  'county-parcels': {
    type: 'Public records · ArcGIS REST',
    coverage: 'Per county / statewide',
    detail: 'Parcel ids, site addresses, owners and assessed values, queried live on each map search.'
  },
  osm: { type: 'Open map data', coverage: 'Global', detail: 'Address-tagged buildings near each search, fetched live and cached in Supabase.' },
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

function badge(source: DataSourceStatus, mls: SourcesResponse['mls'], parcelCount: number): { text: string; tone: string } {
  if (source.slug === 'rpr') return { text: 'Members only', tone: 'neutral' };
  if (source.slug === 'mls') {
    if (!mls.configured) return { text: 'Not configured', tone: 'neutral' };
    if (source.lastError) return { text: 'Sync error', tone: 'error' };
    return { text: mls.isTestData ? 'Sandbox feed' : 'Connected', tone: mls.isTestData ? 'warn' : 'ok' };
  }
  if (source.slug === 'county-parcels') {
    return parcelCount ? { text: `${parcelCount} layer${parcelCount === 1 ? '' : 's'}`, tone: 'ok' } : { text: 'Add a county', tone: 'neutral' };
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
  const [showParcelForm, setShowParcelForm] = useState(false);
  const [showLayers, setShowLayers] = useState(false);
  const [parcelUrl, setParcelUrl] = useState('');
  const [parcelState, setParcelState] = useState('');
  const [parcelName, setParcelName] = useState('');
  const [parcelBusy, setParcelBusy] = useState(false);
  const [parcelMessage, setParcelMessage] = useState<{ ok: boolean; text: string } | null>(null);

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

  const connectParcelLayer = async (e: React.FormEvent) => {
    e.preventDefault();
    setParcelBusy(true);
    setParcelMessage(null);
    try {
      const res = await apiSend<{ name: string; fieldMap: Record<string, string | null> }>(
        'POST',
        '/api/sources',
        { url: parcelUrl, state: parcelState, name: parcelName },
        45000
      );
      const found = Object.entries(res.fieldMap).filter(([, v]) => v).map(([k]) => k).join(', ');
      setParcelMessage({ ok: true, text: `Connected "${res.name}". Detected fields: ${found}.` });
      setParcelUrl('');
      setParcelName('');
      await load();
    } catch (error) {
      setParcelMessage({ ok: false, text: error instanceof Error ? error.message : 'Could not connect layer.' });
    } finally {
      setParcelBusy(false);
    }
  };

  const disconnect = async (slug: string) => {
    try {
      await apiSend('DELETE', `/api/sources?slug=${encodeURIComponent(slug)}`);
      await load();
    } catch (error) {
      setParcelMessage({ ok: false, text: error instanceof Error ? error.message : 'Could not disconnect layer.' });
    }
  };

  const sources = data?.sources ?? [];

  return (
    <div className="p-4 border-b border-neutral-800 bg-neutral-950/60">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.6)]" />
          <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-200">Free Real Estate Data Sources</div>
        </div>
        <button onClick={() => void load()} title="Refresh status" className="p-1 text-neutral-500 hover:text-cyan-300 cursor-pointer">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

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
          const b = badge(source, data!.mls, data!.parcelLayers.length);
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
              {source.lastError && <div className="mt-1 text-[10px] text-rose-300 break-words">Last error: {source.lastError}</div>}
              {source.lastSyncAt && (
                <div className="mt-1 text-[10px] text-neutral-500">Last update {new Date(source.lastSyncAt).toLocaleString()}</div>
              )}

              {source.slug === 'county-parcels' && (
                <div className="mt-2 space-y-1.5">
                  {data!.parcelLayers.length > 0 && (
                    <div className="text-[10px] text-neutral-400">
                      Covers{' '}
                      <span className="font-mono text-cyan-300">
                        {Array.from(new Set(data!.parcelLayers.map(l => String(l.metadata.state ?? '')))).filter(Boolean).sort().join(' ')}
                      </span>{' '}
                      <button onClick={() => setShowLayers(v => !v)} className="text-cyan-300 hover:underline cursor-pointer">
                        {showLayers ? 'hide layers' : 'show layers'}
                      </button>
                    </div>
                  )}
                  {showLayers && data!.parcelLayers.map(layer => (
                    <div key={layer.slug} className="flex items-center justify-between gap-2 text-[10px]">
                      <span className="text-neutral-300 truncate" title={layer.apiUrl ?? ''}>
                        <span className="font-mono text-cyan-300">{String(layer.metadata.state ?? '')}</span> {layer.name}
                        {layer.recordCount > 0 && <span className="text-neutral-500"> · {layer.recordCount.toLocaleString()} saved</span>}
                      </span>
                      {!layer.metadata.builtIn && (
                        <button onClick={() => void disconnect(layer.slug)} className="text-neutral-500 hover:text-rose-300 cursor-pointer" title="Disconnect">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  ))}
                  {!showParcelForm ? (
                    <button
                      onClick={() => setShowParcelForm(true)}
                      disabled={!data?.supabaseConfigured}
                      className="flex items-center gap-1 text-[11px] text-cyan-300 hover:underline cursor-pointer disabled:opacity-50"
                    >
                      <Plus className="w-3 h-3" /> Connect a county parcel layer
                    </button>
                  ) : (
                    <form onSubmit={connectParcelLayer} className="space-y-1.5 pt-1">
                      <p className="text-[10px] text-neutral-400 leading-relaxed">
                        Find your county's parcel layer on its GIS portal or{' '}
                        <a className="text-cyan-300 hover:underline" href="https://hub.arcgis.com/search?q=parcels" target="_blank" rel="noreferrer">ArcGIS Hub</a>,
                        open "I want to use this → View API resources", and paste the URL ending in <span className="font-mono">/FeatureServer/0</span> or <span className="font-mono">/MapServer/N</span>.
                      </p>
                      <input value={parcelUrl} onChange={e => setParcelUrl(e.target.value)} required placeholder="https://…/arcgis/rest/services/Parcels/FeatureServer/0"
                        className="w-full px-2 py-1 bg-neutral-950 border border-neutral-700 rounded text-[11px] text-neutral-100 focus:outline-none focus:border-cyan-400" />
                      <div className="flex gap-1.5">
                        <select value={parcelState} onChange={e => setParcelState(e.target.value)} required
                          className="w-24 px-1.5 py-1 bg-neutral-950 border border-neutral-700 rounded text-[11px] text-neutral-100 focus:outline-none focus:border-cyan-400">
                          <option value="">State</option>
                          {US_STATES.map(s => <option key={s.code} value={s.code}>{s.code}</option>)}
                        </select>
                        <input value={parcelName} onChange={e => setParcelName(e.target.value)} placeholder="Name, e.g. Travis County parcels"
                          className="flex-1 px-2 py-1 bg-neutral-950 border border-neutral-700 rounded text-[11px] text-neutral-100 focus:outline-none focus:border-cyan-400" />
                      </div>
                      <div className="flex justify-end gap-1.5">
                        <button type="button" onClick={() => { setShowParcelForm(false); setParcelMessage(null); }} className="px-2 py-0.5 text-[11px] bg-neutral-800 text-neutral-300 rounded cursor-pointer">Cancel</button>
                        <button type="submit" disabled={parcelBusy} className="px-2.5 py-0.5 text-[11px] bg-cyan-600 hover:bg-cyan-500 text-white font-semibold rounded cursor-pointer disabled:opacity-50">
                          {parcelBusy ? 'Checking layer…' : 'Connect'}
                        </button>
                      </div>
                    </form>
                  )}
                  {parcelMessage && (
                    <div className={`text-[10px] break-words ${parcelMessage.ok ? 'text-emerald-300' : 'text-rose-300'}`}>{parcelMessage.text}</div>
                  )}
                </div>
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
              {source.slug === 'mls' && (
                <button onClick={onOpenListings} className="mt-1.5 text-[11px] text-cyan-300 hover:underline cursor-pointer">
                  {data!.mls.configured ? `${data!.mls.name} → open Listings` : 'How to connect your MLS → Listings'}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {showKaggle && (
        <KaggleImportModal onClose={() => setShowKaggle(false)} onImported={() => void load()} />
      )}
    </div>
  );
};
