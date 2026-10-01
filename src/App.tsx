import React, { useEffect, useState } from 'react';
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
  // null = still checking; string = why leads/collections are not being saved to Supabase.
  const [persistenceError, setPersistenceError] = useState<string | null>(null);

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
      const [leadRes, collectionRes] = await Promise.allSettled([
        apiGet<{ leads: RealEstateLead[] }>('/api/leads'),
        apiGet<{ collections: DatabaseCollection[] }>('/api/collections')
      ]);
      if (leadRes.status === 'fulfilled') setLeads(leadRes.value.leads);
      if (collectionRes.status === 'fulfilled') setCollections(collectionRes.value.collections);
      const failure = [leadRes, collectionRes].find(r => r.status === 'rejected') as PromiseRejectedResult | undefined;
      if (failure) {
        const reason = failure.reason instanceof Error ? failure.reason.message : String(failure.reason);
        setPersistenceError(reason);
        showBanner(`Leads and collections are not being saved: ${reason}`, 9000);
      }
    })();
    void reloadListings();
  }, []);

  const persist = (label: string, request: Promise<unknown>) => {
    request.catch(error => {
      showBanner(`${label} was not saved to Supabase: ${error instanceof Error ? error.message : error}`, 8000);
    });
  };

  // Quick Salesforce Sync (from TopBar or Overview)
  const handleQuickSalesforceSync = () => {
    showBanner('Salesforce sync is unavailable until a live OAuth/API integration is configured.');
  };

  // Sync Daily Listings to Salesforce
  const handleSyncListingsToSalesforce = () => {
    showBanner('Salesforce sync is unavailable until a live OAuth/API integration is configured.');
  };

  // Single Lead Push to Salesforce
  const handleSyncSingleLead = (_lead: RealEstateLead) => {
    showBanner('Salesforce sync is unavailable until a live OAuth/API integration is configured.');
  };

  // Single Property Push to Salesforce
  const handleSyncSingleProperty = (_property: PropertyListing) => {
    showBanner('Salesforce sync is unavailable until a live OAuth/API integration is configured.');
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
    if (!persistenceError) persist('Lead', apiSend('POST', '/api/leads', newLead));
    showBanner(`Added new real estate lead: ${newLead.firstName} ${newLead.lastName} (${newLead.category})`);
  };

  // Update Lead Pipeline State
  const handleUpdateLeadState = (leadId: string, newState: PipelineState) => {
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, pipelineState: newState } : l));
    if (!persistenceError) persist('Pipeline change', apiSend('PATCH', `/api/leads?id=${encodeURIComponent(leadId)}`, { pipelineState: newState }));
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
    if (!persistenceError) persist('Collection', apiSend('POST', '/api/collections', { id: newCol.id, name, description, state }));
    showBanner(`Created database collection "${name}"`);
    return newCol.id;
  };

  // Campaign updates
  const handleUpdateCampaignStatus = (campaignId: string, status: CampaignReviewStatus, notes?: string) => {
    setCampaigns(prev => prev.map(c => c.id === campaignId ? { ...c, status, approverNotes: notes } : c));
    showBanner(`Campaign marked as: ${status}`);
  };

  const handleSaveCampaignEdits = (campaignId: string, updatedDraft: Partial<CampaignDraft>) => {
    setCampaigns(prev => prev.map(c => c.id === campaignId ? { ...c, ...updatedDraft } : c));
    showBanner(`Draft edits saved.`);
  };

  const handleCreateNewDraft = (draft: CampaignDraft) => {
    setCampaigns(prev => [draft, ...prev]);
    showBanner(`Generated new campaign draft "${draft.title}". Review required before send.`);
  };

  const pendingReviewCount = campaigns.filter(c => c.status === 'Pending Approval').length;

  return (
    <div className="min-h-screen flex flex-col bg-neutral-950 text-neutral-100 font-sans">
      {/* Universal Top Bar */}
      <TopBar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        salesforceConfig={salesforceConfig}
        onQuickSync={handleQuickSalesforceSync}
        isSyncing={isSyncing}
        pendingReviewCount={pendingReviewCount}
      />

      {/* Floating System Notice Banner */}
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
          onUpdateConfig={setSalesforceConfig}
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
          onFilterByCollection={() => setActiveTab('pipeline')}
        />
      )}
    </div>
  );
}
