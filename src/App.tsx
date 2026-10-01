import React, { useEffect, useRef, useState } from 'react';
import { TopBar } from './components/layout/TopBar';
import { HeatmapLeadFinder } from './components/map/HeatmapLeadFinder';
import { DailyListingsFeed } from './components/daily/DailyListingsFeed';
import { LeadsPipeline } from './components/pipeline/LeadsPipeline';
import { CampaignReviewer } from './components/campaigns/CampaignReviewer';
import { SalesforceCenter } from './components/salesforce/SalesforceCenter';
import { CollectionsManager } from './components/collections/CollectionsManager';

import { 
  RealEstateLead, 
  PropertyListing, 
  DatabaseCollection, 
  SalesforceConfig, 
  SalesforceSyncLog, 
  CampaignDraft,
  PipelineState,
  CampaignReviewStatus
} from './types';

import {
  INITIAL_LEADS,
  INITIAL_PROPERTY_LISTINGS,
  INITIAL_COLLECTIONS,
  INITIAL_SALESFORCE_CONFIG,
  INITIAL_SYNC_LOGS,
  INITIAL_CAMPAIGNS
} from './data/referenceData';
import { apiGet, apiSend, newId } from './services/apiClient';


export default function App() {
  const [activeTab, setActiveTab] = useState<'map' | 'daily' | 'pipeline' | 'campaigns' | 'salesforce' | 'collections'>('map');
  // Set by "View in Pipeline" on a collection card; the pipeline opens filtered to it.
  const [pipelineCollectionFilter, setPipelineCollectionFilter] = useState('ALL');

  // Application Data State
  const [leads, setLeads] = useState<RealEstateLead[]>(INITIAL_LEADS);
  const [properties, setProperties] = useState<PropertyListing[]>(INITIAL_PROPERTY_LISTINGS);
  const [collections, setCollections] = useState<DatabaseCollection[]>(INITIAL_COLLECTIONS);
  const [salesforceConfig, setSalesforceConfig] = useState<SalesforceConfig>(INITIAL_SALESFORCE_CONFIG);
  const [syncLogs, setSyncLogs] = useState<SalesforceSyncLog[]>(INITIAL_SYNC_LOGS);
  const [campaigns, setCampaigns] = useState<CampaignDraft[]>(INITIAL_CAMPAIGNS);

  // Status and feedback
  const [isSyncing, setIsSyncing] = useState(false);
  const [bannerNotice, setBannerNotice] = useState<string | null>(null);
  // Why leads / collections are not being saved to Supabase (null = loaded fine or still checking).
  const [leadsError, setLeadsError] = useState<string | null>(null);
  const [collectionsError, setCollectionsError] = useState<string | null>(null);
  const [campaignsError, setCampaignsError] = useState<string | null>(null);
  const [salesforceError, setSalesforceError] = useState<string | null>(null);

  // Quick Notification Banner helper
  const showBanner = (msg: string, ms = 4000) => {
    setBannerNotice(msg);
    setTimeout(() => setBannerNotice(null), ms);
  };

  const reloadListings = async () => {
    try {
      const res = await apiGet<{ listings: PropertyListing[] }>('/api/listings?limit=200');
      setProperties(res.listings.filter(l => !l.isTestData));
    } catch {
      // Listings tab shows its own error; other tabs simply have no listings to pick from.
    }
  };

  // Load saved data from Supabase (through /api) on start.
  useEffect(() => {
    void (async () => {
      const [leadRes, collectionRes, campaignRes, salesforceRes] = await Promise.allSettled([
        apiGet<{ leads: RealEstateLead[] }>('/api/leads'),
        apiGet<{ collections: DatabaseCollection[] }>('/api/collections'),
        apiGet<{ campaigns: CampaignDraft[] }>('/api/campaigns'),
        apiGet<{ config: SalesforceConfig; logs: SalesforceSyncLog[] }>('/api/salesforce')
      ]);
      const reason = (r: PromiseRejectedResult) => (r.reason instanceof Error ? r.reason.message : String(r.reason));
      if (leadRes.status === 'fulfilled') setLeads(leadRes.value.leads);
      else setLeadsError(reason(leadRes));
      if (collectionRes.status === 'fulfilled') setCollections(collectionRes.value.collections);
      else setCollectionsError(reason(collectionRes));
      if (campaignRes.status === 'fulfilled') setCampaigns(campaignRes.value.campaigns);
      else setCampaignsError(reason(campaignRes));
      if (salesforceRes.status === 'fulfilled') {
        setSalesforceConfig(salesforceRes.value.config);
        setSyncLogs(salesforceRes.value.logs);
      } else setSalesforceError(reason(salesforceRes));
    })();
    void reloadListings();
  }, []);

  // A record's create request, while it is in flight. Later writes that depend on the record wait for it,
  // so e.g. a pipeline change on a brand-new lead can't reach the server before the lead itself.
  const pendingSaves = useRef(new Map<string, Promise<unknown>>());

  const trackSave = <T,>(id: string, request: Promise<T>): Promise<T> => {
    pendingSaves.current.set(id, request);
    const clear = () => {
      if (pendingSaves.current.get(id) === request) pendingSaves.current.delete(id);
    };
    request.then(clear, clear);
    return request;
  };

  const afterSave = <T,>(id: string | undefined, send: () => Promise<T>): Promise<T> => {
    const pending = id ? pendingSaves.current.get(id) : undefined;
    // If the create failed, still try: the server answers with the real reason (e.g. 404).
    return pending ? pending.then(send, send) : send();
  };

  const persist = (label: string, request: Promise<unknown>) => {
    request.catch(error => {
      showBanner(`${label} was not saved to Supabase: ${error instanceof Error ? error.message : error}`, 8000);
    });
  };

  // Every Salesforce sync request is recorded in the audit trail; the server decides the outcome
  // (always FAILED until a live OAuth/API integration exists).
  const recordSalesforceSync = async (operation: SalesforceSyncLog['operation'], recordsProcessed: number) => {
    if (salesforceError) {
      showBanner('Salesforce sync is unavailable until a live OAuth/API integration is configured.');
      return;
    }
    setIsSyncing(true);
    try {
      const { log } = await apiSend<{ log: SalesforceSyncLog }>('POST', '/api/salesforce', { operation, recordsProcessed });
      setSyncLogs(prev => [log, ...prev]);
      showBanner(log.status === 'SUCCESS' ? `${operation}: ${log.recordsSucceeded} records synced.` : `${operation} not sent. ${log.message}`, 6000);
    } catch (error) {
      showBanner(`Salesforce sync was not recorded: ${error instanceof Error ? error.message : error}`, 8000);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleQuickSalesforceSync = () => {
    void recordSalesforceSync('Push Leads', leads.filter(l => l.salesforceSyncStatus !== 'Synced').length);
  };

  const handleSyncListingsToSalesforce = () => {
    void recordSalesforceSync('Sync Daily Listings', properties.filter(p => !p.syncedToSalesforce).length);
  };

  const handleSyncSingleLead = (_lead: RealEstateLead) => {
    void recordSalesforceSync('Push Leads', 1);
  };

  const handleSyncSingleProperty = (_property: PropertyListing) => {
    void recordSalesforceSync('Sync Daily Listings', 1);
  };

  const handleUpdateSalesforceConfig = (config: SalesforceConfig) => {
    setSalesforceConfig(config);
    if (!salesforceError) persist('Salesforce settings', apiSend('PATCH', '/api/salesforce', config));
  };

  // Add Lead
  const handleAddLead = (leadData: Partial<RealEstateLead>) => {
    if (
      !leadData.firstName?.trim() ||
      !leadData.lastName?.trim() ||
      !leadData.street?.trim() ||
      !leadData.city?.trim() ||
      !leadData.state?.trim() ||
      !leadData.postalCode?.trim() ||
      !leadData.sourceUrl?.trim() ||
      !leadData.verificationStatus?.trim() ||
      !leadData.scoreReason?.trim() ||
      !leadData.role ||
      !leadData.category ||
      !leadData.leadSource ||
      !Number.isFinite(leadData.latitude) ||
      !Number.isFinite(leadData.longitude) ||
      (leadData.confidenceScore !== null && leadData.confidenceScore !== undefined &&
        (!Number.isFinite(leadData.confidenceScore) || leadData.confidenceScore < 0 || leadData.confidenceScore > 100))
    ) {
      showBanner('Lead not saved. Name, verified address, location, type, and source are required.');
      return;
    }

    const collectedAt = new Date().toISOString();
    const newLead: RealEstateLead = {
      id: newId(),
      firstName: leadData.firstName,
      lastName: leadData.lastName,
      email: leadData.email || '',
      phone: leadData.phone || '',
      brokerageOrCompany: leadData.brokerageOrCompany || '',
      role: leadData.role,
      category: leadData.category,
      street: leadData.street,
      city: leadData.city,
      state: leadData.state,
      postalCode: leadData.postalCode,
      latitude: leadData.latitude as number,
      longitude: leadData.longitude as number,
      pipelineState: leadData.pipelineState || 'New',
      leadSource: leadData.leadSource,
      collectionId: leadData.collectionId,
      targetBudgetOrPrice: leadData.targetBudgetOrPrice,
      salesforceSyncStatus: 'Not Synced',
      notes: leadData.notes || '',
      sourceUrl: leadData.sourceUrl,
      collectedAt,
      verificationStatus: leadData.verificationStatus,
      confidenceScore: leadData.confidenceScore ?? null,
      scoreReason: leadData.scoreReason,
      createdAt: collectedAt
    };

    setLeads(prev => [newLead, ...prev]);
    if (!leadsError) {
      persist('Lead', trackSave(newLead.id, afterSave(newLead.collectionId, () => apiSend('POST', '/api/leads', newLead))));
    }
    showBanner(`Added new real estate lead: ${newLead.firstName} ${newLead.lastName} (${newLead.category})`);
  };

  // Update Lead Pipeline State
  const handleUpdateLeadState = (leadId: string, newState: PipelineState) => {
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, pipelineState: newState } : l));
    if (!leadsError) {
      persist('Pipeline change', afterSave(leadId, () => apiSend('PATCH', `/api/leads?id=${encodeURIComponent(leadId)}`, { pipelineState: newState })));
    }
  };

  const handleUpdateLeadCollection = (leadId: string, collectionId: string) => {
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, collectionId: collectionId || undefined } : l));
    if (!leadsError) {
      persist(
        'Collection change',
        afterSave(collectionId, () => afterSave(leadId, () => apiSend('PATCH', `/api/leads?id=${encodeURIComponent(leadId)}`, { collectionId })))
      );
    }
  };

  // Create Database Collection
  const handleCreateCollection = (name: string, description: string, state: string): string => {
    const newCol: DatabaseCollection = {
      id: newId(),
      name,
      description,
      leadCount: 0,
      targetStates: [state],
      colorTag: 'cyan',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    setCollections(prev => [...prev, newCol]);
    if (!collectionsError) {
      persist('Collection', trackSave(newCol.id, apiSend('POST', '/api/collections', { id: newCol.id, name, description, state })));
    }
    showBanner(`Created database collection "${name}"`);
    return newCol.id;
  };

  const handleUpdateCollection = (collectionId: string, changes: { name: string; description: string; state: string }) => {
    setCollections(prev =>
      prev.map(c =>
        c.id === collectionId
          ? { ...c, name: changes.name, description: changes.description, targetStates: [changes.state], updatedAt: new Date().toISOString() }
          : c
      )
    );
    if (!collectionsError) {
      persist('Collection update', afterSave(collectionId, () => apiSend('PATCH', `/api/collections?id=${encodeURIComponent(collectionId)}`, changes)));
    }
    showBanner(`Updated collection "${changes.name}"`);
  };

  const handleDeleteCollection = (collectionId: string) => {
    const name = collections.find(c => c.id === collectionId)?.name ?? 'collection';
    setCollections(prev => prev.filter(c => c.id !== collectionId));
    // Leads stay; they just leave the deleted collection (the database clears collection_id too).
    setLeads(prev => prev.map(l => (l.collectionId === collectionId ? { ...l, collectionId: undefined } : l)));
    if (!collectionsError) {
      persist('Collection delete', afterSave(collectionId, () => apiSend('DELETE', `/api/collections?id=${encodeURIComponent(collectionId)}`)));
    }
    showBanner(`Deleted collection "${name}". Its leads were kept.`);
  };

  // Campaign updates
  const saveCampaignChanges = (campaignId: string, changes: Partial<CampaignDraft>, label: string) => {
    setCampaigns(prev => prev.map(c => c.id === campaignId ? { ...c, ...changes } : c));
    if (!campaignsError) {
      persist(label, afterSave(campaignId, () => apiSend('PATCH', `/api/campaigns?id=${encodeURIComponent(campaignId)}`, changes)));
    }
  };

  const handleUpdateCampaignStatus = (campaignId: string, status: CampaignReviewStatus, notes?: string) => {
    saveCampaignChanges(campaignId, { status, approverNotes: notes }, 'Campaign status');
    showBanner(`Campaign marked as: ${status}`);
  };

  const handleSaveCampaignEdits = (campaignId: string, updatedDraft: Partial<CampaignDraft>) => {
    saveCampaignChanges(campaignId, updatedDraft, 'Campaign edits');
    showBanner(`Draft edits saved.`);
  };

  const handleCreateNewDraft = (draft: CampaignDraft) => {
    setCampaigns(prev => [draft, ...prev]);
    if (!campaignsError) persist('Campaign draft', trackSave(draft.id, apiSend('POST', '/api/campaigns', draft)));
    showBanner(`Generated new campaign draft "${draft.title}". Review required before send.`);
  };

  const pendingReviewCount = campaigns.filter(c => c.status === 'Pending Approval').length;

  const saveProblems = [
    { area: 'Leads & pipeline', error: leadsError, fix: 'supabase/0005_fix_leads_table.sql' },
    { area: 'Collections', error: collectionsError, fix: 'supabase/0003_app_api.sql' },
    { area: 'AI Campaigns', error: campaignsError, fix: 'supabase/0006_campaigns_settings_sync.sql' },
    { area: 'Salesforce settings & logs', error: salesforceError, fix: 'supabase/0006_campaigns_settings_sync.sql' }
  ].filter((p): p is { area: string; error: string; fix: string } => Boolean(p.error));

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-neutral-950 text-neutral-100 font-sans">
      {/* Universal Top Bar */}
      <TopBar
        activeTab={activeTab}
        onSelectTab={tab => {
          if (tab === 'pipeline') setPipelineCollectionFilter('ALL');
          setActiveTab(tab);
        }}
        salesforceConfig={salesforceConfig}
        onQuickSync={handleQuickSalesforceSync}
        isSyncing={isSyncing}
        pendingReviewCount={pendingReviewCount}
      />

      {/* Floating System Notice Banner */}
      {saveProblems.length > 0 && (
        <div role="alert" className="shrink-0 px-6 py-2 bg-rose-950/70 border-b border-rose-500/40 text-xs text-rose-100 flex items-start gap-2">
          <span className="mt-1 w-2 h-2 rounded-full bg-rose-400 shrink-0" />
          <div className="space-y-0.5">
            <div>
              <strong className="font-semibold">Not saving to Supabase:</strong> {saveProblems.map(p => p.area).join(', ')}. Changes there
              will be lost on refresh.
            </div>
            {saveProblems.map(p => (
              <div key={p.area} className="text-rose-300/80">
                {p.area}: {p.error}
                {/does not exist|Could not find the table/i.test(p.error) && (
                  <span className="text-rose-200"> → Run {p.fix} in the Supabase SQL editor, then reload.</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {bannerNotice && (
        <div className="fixed top-14 right-6 z-50 bg-neutral-950/95 border border-cyan-500/60 shadow-[0_0_20px_rgba(6,182,212,0.3)] rounded-md px-4 py-2.5 text-xs text-cyan-100 flex items-center gap-2 animate-fade-in backdrop-blur-md">
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping shadow-[0_0_8px_#06b6d4]" />
          <span>{bannerNotice}</span>
        </div>
      )}

      {/* Viewport Router */}
      {activeTab === 'map' && (
        <HeatmapLeadFinder
          leads={leads}
          properties={properties}
          collections={collections}
          onAddLead={handleAddLead}
          onPushToSalesforce={handleSyncSingleLead}
          onCreateCollection={handleCreateCollection}
          onOpenListings={() => setActiveTab('daily')}
        />
      )}

      {activeTab === 'daily' && (
        <DailyListingsFeed
          leads={leads}
          onSyncPropertyToSalesforce={handleSyncSingleProperty}
          onJumpToMap={() => setActiveTab('map')}
          onDraftOutreachForProperty={() => setActiveTab('campaigns')}
          onListingsChanged={() => void reloadListings()}
        />
      )}

      {activeTab === 'pipeline' && (
        <LeadsPipeline
          leads={leads}
          collections={collections}
          onUpdateLeadState={handleUpdateLeadState}
          onUpdateLeadCollection={handleUpdateLeadCollection}
          initialCollectionFilter={pipelineCollectionFilter}
          onAddLead={handleAddLead}
          onSyncSingleLeadToSalesforce={handleSyncSingleLead}
          onSelectLeadForOutreach={() => setActiveTab('campaigns')}
        />
      )}

      {activeTab === 'campaigns' && (
        <CampaignReviewer
          campaigns={campaigns}
          leads={leads}
          properties={properties}
          onUpdateCampaignStatus={handleUpdateCampaignStatus}
          onSaveCampaignEdits={handleSaveCampaignEdits}
          onCreateNewDraft={handleCreateNewDraft}
        />
      )}

      {activeTab === 'salesforce' && (
        <SalesforceCenter
          config={salesforceConfig}
          syncLogs={syncLogs}
          leads={leads}
          properties={properties}
          onUpdateConfig={handleUpdateSalesforceConfig}
          onTriggerLeadsSync={handleQuickSalesforceSync}
          onTriggerListingsSync={handleSyncListingsToSalesforce}
          isSyncing={isSyncing}
        />
      )}

      {activeTab === 'collections' && (
        <CollectionsManager
          collections={collections}
          leads={leads}
          onCreateCollection={(name, desc, st) => handleCreateCollection(name, desc, st)}
          onUpdateCollection={handleUpdateCollection}
          onDeleteCollection={handleDeleteCollection}
          onFilterByCollection={collectionId => {
            setPipelineCollectionFilter(collectionId);
            setActiveTab('pipeline');
          }}
        />
      )}
    </div>
  );
}
