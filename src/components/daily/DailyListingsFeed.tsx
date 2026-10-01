import React, { useEffect, useMemo, useState } from 'react';
import {
  Building,
  MapPin,
  Bed,
  Bath,
  Maximize2,
  Sparkles,
  Send,
  Share2,
  Filter,
  Check,
  RefreshCw,
  FileUp,
  AlertTriangle,
  ExternalLink,
  FlaskConical
} from 'lucide-react';
import { PropertyListing, RealEstateLead, SourcesResponse } from '../../types';
import { US_STATES } from '../../data/referenceData';
import { apiGet, apiSend } from '../../services/apiClient';
import { KaggleImportModal } from '../data/KaggleImportModal';

interface DailyListingsFeedProps {
  leads: RealEstateLead[];
  onSyncPropertyToSalesforce: (property: PropertyListing) => void;
  onJumpToMap: (lat: number, lng: number, address: string) => void;
  onDraftOutreachForProperty: (property: PropertyListing) => void;
  /** Called after an MLS sync or CSV import so other tabs can reload listings. */
  onListingsChanged: () => void;
}

const PAGE = 120;

/** Leads in the same state whose budget is within 15% of the list price. */
function matchLeads(listing: PropertyListing, leads: RealEstateLead[]) {
  return leads
    .filter(l => l.state === listing.state && l.targetBudgetOrPrice && listing.price > 0)
    .map(l => ({ lead: l, diff: Math.abs(l.targetBudgetOrPrice! - listing.price) / listing.price }))
    .filter(m => m.diff <= 0.15)
    .sort((a, b) => a.diff - b.diff)
    .map(m => ({ lead: m.lead, score: Math.round(100 - m.diff * 200) }));
}

export const DailyListingsFeed: React.FC<DailyListingsFeedProps> = ({
  leads,
  onSyncPropertyToSalesforce,
  onJumpToMap,
  onDraftOutreachForProperty,
  onListingsChanged
}) => {
  const [selectedState, setSelectedState] = useState<string>('ALL');
  const [selectedSource, setSelectedSource] = useState<string>('ALL');
  const [selectedType, setSelectedType] = useState<string>('ALL');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [onlyMatched, setOnlyMatched] = useState<boolean>(false);
  const [notifiedPropertyId, setNotifiedPropertyId] = useState<string | null>(null);

  const [listings, setListings] = useState<PropertyListing[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sources, setSources] = useState<SourcesResponse | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [showImport, setShowImport] = useState(false);

  const load = async (offset = 0) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
      if (selectedState !== 'ALL') params.set('state', selectedState);
      if (selectedSource !== 'ALL') params.set('source', selectedSource);
      if (includeInactive) params.set('includeInactive', '1');
      const res = await apiGet<{ listings: PropertyListing[]; total: number }>(`/api/listings?${params}`, 30000);
      setListings(prev => (offset ? [...prev, ...res.listings] : res.listings));
      setTotal(res.total);
      setLoadError(null);
    } catch (error) {
      if (!offset) setListings([]);
      setLoadError(error instanceof Error ? error.message : 'Could not load listings.');
    } finally {
      setLoading(false);
    }
  };

  const loadSources = async () => {
    try {
      setSources(await apiGet<SourcesResponse>('/api/sources', 30000));
    } catch {
      setSources(null);
    }
  };

  useEffect(() => {
    void loadSources();
  }, []);

  useEffect(() => {
    void load(0);
  }, [selectedState, selectedSource, includeInactive]);

  const runMlsSync = async (full = false) => {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const res = await apiSend<{ upserted: number; processed: number; totalListings: number | null; incrementalSince: string | null }>(
        'POST',
        `/api/mls/sync${full ? '?full=1' : ''}`,
        undefined,
        90000
      );
      setSyncMessage({
        ok: true,
        text: `MLS sync finished: ${res.upserted.toLocaleString()} listings saved${res.incrementalSince ? ` (changes since ${new Date(res.incrementalSince).toLocaleString()})` : ''}. ${res.totalListings?.toLocaleString() ?? '?'} MLS listings in Supabase.`
      });
      await Promise.all([load(0), loadSources()]);
      onListingsChanged();
    } catch (error) {
      setSyncMessage({ ok: false, text: error instanceof Error ? error.message : 'MLS sync failed.' });
    } finally {
      setSyncing(false);
    }
  };

  const withMatches = useMemo(() => listings.map(l => ({ listing: l, matches: matchLeads(l, leads) })), [listings, leads]);
  const propertyTypes = useMemo(() => Array.from(new Set(listings.map(p => p.propertyType))).sort(), [listings]);
  const filtered = withMatches.filter(({ listing, matches }) => {
    if (selectedType !== 'ALL' && listing.propertyType !== selectedType) return false;
    if (onlyMatched && matches.length === 0) return false;
    return true;
  });

  const mls = sources?.mls;
  const mlsSource = sources?.sources.find(s => s.slug === 'mls');
  const hasTestData = listings.some(l => l.isTestData);

  const handleNotifyLead = (prop: PropertyListing) => {
    setNotifiedPropertyId(prop.id);
    setTimeout(() => setNotifiedPropertyId(null), 3000);
  };

  return (
    <div className="flex-1 bg-neutral-950 overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-neutral-800">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-white">Daily Property Listings</h1>
            {!mls?.configured ? (
              <span className="text-xs font-mono px-2.5 py-0.5 rounded bg-neutral-900 border border-neutral-700 text-neutral-400">No MLS feed configured</span>
            ) : mls.isTestData ? (
              <span className="text-xs font-mono px-2.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/40 text-amber-300">{mls.name}</span>
            ) : (
              <span className="text-xs font-mono px-2.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/40 text-emerald-300">{mls.name}</span>
            )}
          </div>
          <p className="text-xs text-neutral-400 mt-1">
            {mlsSource?.lastSyncAt
              ? `Last MLS sync ${new Date(mlsSource.lastSyncAt).toLocaleString()}${mls?.cronEnabled ? ' · syncs daily automatically' : ''}.`
              : 'Listings from your MLS feed and imported Kaggle datasets, stored in Supabase.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowImport(true)}
            disabled={!sources?.supabaseConfigured}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-200 bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 rounded cursor-pointer disabled:opacity-50"
          >
            <FileUp className="w-3.5 h-3.5 text-cyan-400" />
            Import Kaggle CSV
          </button>
          <button
            onClick={() => void runMlsSync(false)}
            disabled={!mls?.configured || syncing}
            title={mls?.configured ? 'Pull new and changed listings from the MLS feed' : 'Configure MLS_* environment variables first'}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 rounded cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing MLS…' : 'Sync MLS now'}
          </button>
        </div>
      </div>

      {syncMessage && (
        <div className={`text-xs p-3 rounded border ${syncMessage.ok ? 'border-emerald-500/30 text-emerald-200 bg-emerald-500/5' : 'border-rose-500/30 text-rose-200 bg-rose-500/5'}`}>
          {syncMessage.text}
        </div>
      )}
      {mlsSource?.lastError && !syncMessage && (
        <div className="text-xs p-3 rounded border border-rose-500/30 text-rose-200 bg-rose-500/5">Last MLS sync failed: {mlsSource.lastError}</div>
      )}

      {sources && !sources.supabaseConfigured && (
        <div className="text-xs p-3 rounded border border-amber-500/30 text-amber-200 bg-amber-500/5 flex gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Supabase is not configured on the server. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel → Settings → Environment Variables, then redeploy.
        </div>
      )}

      {sources && !mls?.configured && (
        <div className="p-4 rounded-lg border border-neutral-800 bg-neutral-900/60 text-xs text-neutral-300 space-y-2">
          <div className="font-semibold text-white">Connect your MLS (RESO Web API)</div>
          <p className="text-neutral-400 leading-relaxed">
            MLS data is licensed: request an IDX or VOW data feed from your MLS (or its vendor: Bridge Interactive, Trestle, MLS Grid, Spark).
            Then add these environment variables in Vercel and redeploy. Listings sync daily and on "Sync MLS now".
          </p>
          <pre className="p-3 bg-neutral-950 border border-neutral-800 rounded font-mono text-[11px] text-cyan-200 overflow-x-auto">{`MLS_RESO_URL=https://api.bridgedataoutput.com/api/v2/OData/<dataset>
MLS_ACCESS_TOKEN=<server token>
MLS_NAME=<Your MLS name>
# OAuth vendors (e.g. Trestle) instead of MLS_ACCESS_TOKEN:
# MLS_OAUTH_TOKEN_URL=…  MLS_CLIENT_ID=…  MLS_CLIENT_SECRET=…  MLS_OAUTH_SCOPE=api
CRON_SECRET=<random string>   # enables the daily automatic sync`}</pre>
          <p className="text-neutral-500">
            To test the pipeline before your feed is approved, set <span className="font-mono text-neutral-300">MLS_PROVIDER=bridge-test</span>.
            It loads Bridge's public sandbox, which is synthetic data and is labelled TEST DATA everywhere.
          </p>
        </div>
      )}

      {hasTestData && (
        <div className="text-xs p-3 rounded border border-amber-500/40 text-amber-200 bg-amber-500/5 flex gap-2">
          <FlaskConical className="w-4 h-4 shrink-0" />
          Some listings come from a vendor sandbox. They are synthetic test records, not real properties. Don't use them for outreach.
          They are removed automatically on the first sync from a real MLS feed.
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-neutral-900/60 border border-neutral-800 rounded-lg">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-neutral-400">
            <Filter className="w-3.5 h-3.5 text-cyan-400" />
            <span>State:</span>
          </div>
          <select value={selectedState} onChange={e => setSelectedState(e.target.value)}
            className="px-2.5 py-1 bg-neutral-950 border border-neutral-700 rounded text-xs text-neutral-200 focus:outline-none focus:border-cyan-400 cursor-pointer">
            <option value="ALL">All states</option>
            {US_STATES.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
          </select>

          <span className="text-xs text-neutral-400 ml-2">Source:</span>
          <select value={selectedSource} onChange={e => setSelectedSource(e.target.value)}
            className="px-2.5 py-1 bg-neutral-950 border border-neutral-700 rounded text-xs text-neutral-200 focus:outline-none focus:border-cyan-400 cursor-pointer">
            <option value="ALL">All sources</option>
            <option value="mls">MLS feed</option>
            <option value="kaggle">Kaggle datasets</option>
          </select>

          <span className="text-xs text-neutral-400 ml-2">Property Type:</span>
          <select value={selectedType} onChange={e => setSelectedType(e.target.value)}
            className="px-2.5 py-1 bg-neutral-950 border border-neutral-700 rounded text-xs text-neutral-200 focus:outline-none focus:border-cyan-400 cursor-pointer">
            <option value="ALL">All Property Types</option>
            {propertyTypes.map(pt => <option key={pt} value={pt}>{pt}</option>)}
          </select>

          <label className="flex items-center gap-2 text-xs text-neutral-300 ml-2 cursor-pointer select-none">
            <input type="checkbox" checked={includeInactive} onChange={e => setIncludeInactive(e.target.checked)}
              className="rounded bg-neutral-950 border-neutral-700 text-cyan-500 focus:ring-cyan-500 cursor-pointer" />
            <span>Include sold / off-market</span>
          </label>

          <label className="flex items-center gap-2 text-xs text-neutral-300 ml-2 cursor-pointer select-none">
            <input type="checkbox" checked={onlyMatched} onChange={e => setOnlyMatched(e.target.checked)}
              className="rounded bg-neutral-950 border-neutral-700 text-cyan-500 focus:ring-cyan-500 cursor-pointer" />
            <span>Only Matched to Leads</span>
          </label>
        </div>

        <div className="text-xs text-neutral-400 font-mono tabular-nums">
          Showing <span className="text-cyan-300 font-semibold">{filtered.length}</span> of {total.toLocaleString()} listings
        </div>
      </div>

      {loadError && (
        <div className="text-xs p-3 rounded border border-rose-500/30 text-rose-200 bg-rose-500/5">{loadError}</div>
      )}

      {/* Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filtered.map(({ listing: property, matches }) => {
          const match = matches[0];
          return (
            <article
              key={property.id}
              className={`bg-neutral-900 border rounded-lg overflow-hidden flex flex-col transition-all hover:shadow-[0_0_15px_rgba(6,182,212,0.15)] ${
                property.isTestData ? 'border-amber-500/40' : 'border-neutral-800 hover:border-cyan-500/40'
              }`}
            >
              <div className="relative aspect-[16/9] w-full bg-neutral-800 overflow-hidden flex items-center justify-center">
                <Building className="w-10 h-10 text-neutral-700 absolute" />
                {property.photoUrl && (
                  <img
                    src={property.photoUrl}
                    alt={property.title}
                    referrerPolicy="no-referrer"
                    loading="lazy"
                    className="relative w-full h-full object-cover"
                    onError={e => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                )}
                <div className="absolute top-2.5 left-2.5 flex flex-wrap items-center gap-1.5">
                  <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-neutral-950/85 backdrop-blur-md text-cyan-300 border border-cyan-500/30">
                    {property.status}
                  </span>
                  {property.sourceSlug === 'mls' && (
                    <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-neutral-950/85 backdrop-blur-md text-neutral-300 border border-neutral-800">
                      MLS #{property.mlsId}
                    </span>
                  )}
                </div>
                {property.isTestData && (
                  <div className="absolute bottom-0 inset-x-0 py-1 text-center text-[11px] font-bold tracking-wider bg-amber-500/90 text-neutral-950">
                    TEST DATA: NOT A REAL LISTING
                  </div>
                )}
              </div>

              <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                <div>
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="text-xl font-bold font-mono tabular-nums text-white">${property.price.toLocaleString()}</div>
                    {property.previousPrice && (
                      <div className="text-xs font-mono tabular-nums text-neutral-500 line-through">${property.previousPrice.toLocaleString()}</div>
                    )}
                  </div>
                  <h3 className="text-sm font-semibold text-neutral-100 mt-1 line-clamp-1">{property.title}</h3>
                  <div className="text-xs text-neutral-400 mt-0.5 flex items-center gap-1">
                    <MapPin className="w-3 h-3 text-cyan-400 shrink-0" />
                    <span className="truncate">{[property.address, property.city, `${property.state} ${property.postalCode}`.trim()].filter(Boolean).join(', ')}</span>
                  </div>
                  <div className="text-[11px] text-neutral-500 mt-1 truncate">
                    {property.sourceLabel}
                    {property.daysOnMarket !== null && ` · ${property.daysOnMarket} days on market`}
                    {property.listingAgentBrokerage && ` · ${property.listingAgentBrokerage}`}
                  </div>

                  <div className="flex items-center gap-3.5 text-xs text-neutral-300 font-mono tabular-nums mt-3 pt-3 border-t border-neutral-800/80">
                    {property.beds > 0 && (
                      <span className="flex items-center gap-1"><Bed className="w-3.5 h-3.5 text-blue-400" />{property.beds} Beds</span>
                    )}
                    {property.baths > 0 && (
                      <span className="flex items-center gap-1"><Bath className="w-3.5 h-3.5 text-blue-400" />{property.baths} Baths</span>
                    )}
                    {property.squareFeet > 0 && (
                      <span className="flex items-center gap-1"><Maximize2 className="w-3.5 h-3.5 text-blue-400" />{property.squareFeet.toLocaleString()} sqft</span>
                    )}
                  </div>

                  {match && (
                    <div className="mt-3 p-2 bg-blue-950/40 rounded border border-cyan-500/40 text-xs">
                      <div className="flex items-center justify-between text-cyan-300 font-medium">
                        <span className="flex items-center gap-1.5">
                          <Sparkles className="w-3 h-3 text-cyan-400" />
                          <span>Budget match: {match.lead.firstName} {match.lead.lastName}</span>
                        </span>
                        <span className="font-mono">{match.score}%</span>
                      </div>
                      <div className="text-[11px] text-neutral-400 mt-0.5 truncate">
                        Budget ${(match.lead.targetBudgetOrPrice || 0).toLocaleString()} · same state
                        {matches.length > 1 && ` · +${matches.length - 1} more`}
                      </div>
                    </div>
                  )}
                </div>

                <div className="pt-3 border-t border-neutral-800 space-y-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onSyncPropertyToSalesforce(property)}
                      className={`flex-1 py-1.5 text-xs font-semibold rounded border transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${
                        property.syncedToSalesforce ? 'bg-neutral-950 border-neutral-800 text-neutral-400' : 'bg-neutral-800 hover:bg-neutral-700 border-neutral-700 text-white'
                      }`}
                    >
                      <Share2 className="w-3.5 h-3.5 text-cyan-400" />
                      <span>{property.syncedToSalesforce ? 'Synced to SF' : 'Push to Salesforce'}</span>
                    </button>
                    <button
                      onClick={() => onDraftOutreachForProperty(property)}
                      disabled={property.isTestData}
                      className="px-2.5 py-1.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-xs font-bold rounded transition-all cursor-pointer flex items-center gap-1 disabled:opacity-40"
                      title={property.isTestData ? 'Not available for test data' : 'Draft AI Email Campaign for this property'}
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Draft Pitch</span>
                    </button>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-neutral-500 pt-1">
                    {property.latitude !== null && property.longitude !== null ? (
                      <button
                        onClick={() => onJumpToMap(property.latitude!, property.longitude!, `${property.city}, ${property.state}`)}
                        className="hover:text-cyan-400 transition-colors flex items-center gap-1 cursor-pointer"
                      >
                        <MapPin className="w-3 h-3 text-cyan-400" />
                        <span>View on Heatmap</span>
                      </button>
                    ) : (
                      <span className="text-neutral-600">No coordinates in source</span>
                    )}
                    {property.listingUrl && (
                      <a href={property.listingUrl} target="_blank" rel="noreferrer" className="hover:text-cyan-400 flex items-center gap-1">
                        Listing <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                    {match && (
                      <button onClick={() => handleNotifyLead(property)} className="text-cyan-400 hover:text-cyan-300 hover:underline cursor-pointer flex items-center gap-1 font-medium">
                        {notifiedPropertyId === property.id ? (
                          <><Check className="w-3 h-3" /><span className="font-bold">Marked for follow-up</span></>
                        ) : (
                          <><Send className="w-3 h-3" /><span>Notify {match.lead.firstName}</span></>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {listings.length < total && (
        <div className="flex justify-center">
          <button onClick={() => void load(listings.length)} disabled={loading}
            className="px-4 py-1.5 text-xs bg-neutral-900 border border-neutral-700 text-neutral-200 rounded hover:bg-neutral-800 cursor-pointer disabled:opacity-50">
            {loading ? 'Loading…' : `Load more (${(total - listings.length).toLocaleString()} remaining)`}
          </button>
        </div>
      )}

      {!loading && filtered.length === 0 && !loadError && (
        <div className="py-12 text-center text-sm text-neutral-400">
          {mls?.configured
            ? 'No listings yet. Click "Sync MLS now" to pull listings from your feed.'
            : 'No listings yet. Connect an MLS feed (see above) or import a Kaggle CSV.'}
        </div>
      )}
      {loading && listings.length === 0 && <div className="py-12 text-center text-sm text-neutral-500">Loading listings…</div>}

      {showImport && (
        <KaggleImportModal
          onClose={() => setShowImport(false)}
          onImported={() => {
            void load(0);
            void loadSources();
            onListingsChanged();
          }}
        />
      )}
    </div>
  );
};
