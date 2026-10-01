export type LeadCategory = 
  | 'Residential Single-Family'
  | 'Multi-Family 2-4 Units'
  | 'Luxury Estate'
  | 'Commercial & Retail'
  | 'Distressed / Pre-Foreclosure'
  | 'FSBO (For Sale By Owner)'
  | 'Investor Buyer';

export type PipelineState = 
  | 'New'
  | 'Researched'
  | 'Contacted'
  | 'Engaged'
  | 'Referral Received'
  | 'Active Partner'
  | 'Dormant'
  | 'Do Not Contact';

export type SalesforceSyncStatus = 'Synced' | 'Pending' | 'Error' | 'Not Synced';

export interface RealEstateLead {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  brokerageOrCompany: string;
  role: 'Property Owner' | 'Listing Agent' | 'Broker' | 'Real Estate Investor' | 'Referral Partner' | 'Homebuyer';
  category: LeadCategory;
  street: string;
  city: string;
  state: string; // e.g. 'TX', 'CA', 'FL', 'NY'
  postalCode: string;
  county?: string;
  latitude: number;
  longitude: number;
  pipelineState: PipelineState;
  leadSource: 'Lead Finder Discovery' | 'Address Geosearch' | 'Daily MLS Feed' | 'Manual Intake' | 'Salesforce Import';
  collectionId?: string;
  targetBudgetOrPrice?: number;
  salesforceSyncStatus: SalesforceSyncStatus;
  salesforceLeadId?: string;
  lastSyncedAt?: string;
  notes: string;
  sourceUrl: string;
  collectedAt: string;
  verificationStatus: string;
  confidenceScore: number | null;
  scoreReason: string;
  matchScore?: number;
  createdAt: string;
}

/** 'New Today' and 'Price Reduced' are derived; anything else is the source's RESO StandardStatus or dataset status. */
export type PropertyListingStatus = 'New Today' | 'Active' | 'Price Reduced' | 'Pending' | (string & {});

export interface PropertyListing {
  id: string;
  mlsId: string;
  title: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  price: number;
  previousPrice?: number;
  beds: number;
  baths: number;
  squareFeet: number;
  lotSizeAcres?: number;
  propertyType: string;
  daysOnMarket: number | null;
  listingDate: string; // YYYY-MM-DD
  status: PropertyListingStatus;
  photoUrl: string;
  capRate?: number; // % estimated return for investors
  estimatedRent?: number;
  latitude: number | null;
  longitude: number | null;
  listingAgentName: string;
  listingAgentBrokerage: string;
  syncedToSalesforce: boolean;
  salesforceAssetId?: string;
  matchedLeadIds: string[]; // leads who match this listing
  description: string;
  /** 'mls' | 'kaggle' — where the record came from. */
  sourceSlug: string;
  sourceLabel: string;
  /** true for vendor sandbox feeds (e.g. Bridge "test" dataset) — synthetic, never real listings. */
  isTestData: boolean;
  listingUrl?: string;
  updatedAt: string;
}

export interface DatabaseCollection {
  id: string;
  name: string;
  description: string;
  leadCount: number;
  targetStates: string[];
  colorTag: string;
  createdAt: string;
  updatedAt: string;
}

export interface SalesforceConfig {
  isConnected: boolean;
  instanceUrl: string;
  orgId: string;
  clientId: string;
  environment: 'Production' | 'Sandbox';
  apiVersion: string;
  syncMode: 'Realtime Webhook' | 'Daily Batch (08:00 AM EST)' | 'Manual';
  lastSyncTimestamp: string | null;
  totalSyncedLeads: number;
  autoSyncDailyListings: boolean;
  enforceSuppression: boolean;
}

export interface SalesforceSyncLog {
  id: string;
  timestamp: string;
  operation: 'Push Leads' | 'Sync Daily Listings' | 'Pull Inbound Contacts' | 'Nightly Batch';
  status: 'SUCCESS' | 'WARNING' | 'FAILED';
  recordsProcessed: number;
  recordsSucceeded: number;
  recordsFailed: number;
  salesforceIds: string[];
  message: string;
  durationMs: number;
}

export type CampaignType = 
  | 'Monday Newsletter'
  | 'Wednesday Market Education'
  | 'Friday Property Highlights'
  | 'Direct Agent Outreach';

export type CampaignReviewStatus = 'Pending Approval' | 'Needs Edit' | 'Approved' | 'Delivered' | 'Rejected';

export interface CampaignDraft {
  id: string;
  title: string;
  campaignType: CampaignType;
  targetAudience: string;
  subject: string;
  bodyContent: string;
  status: CampaignReviewStatus;
  approverNotes?: string;
  testSendAddress: string;
  recipientLeadIds: string[];
  scheduledDate: string;
  createdAt: string;
  sentAt?: string;
  salesforceCampaignId?: string;
}

export interface USStateSummary {
  code: string;
  name: string;
  /** Largest city, used to centre a state search on real buildings instead of the geographic centroid. */
  anchorCity: string;
}

// ---------------------------------------------------------------------------
// Shapes returned by the /api server functions (shared by api/ and src/).
// ---------------------------------------------------------------------------

/** One property/building point shown on the map, from any data source. */
export interface MapRecord {
  id: string; // `${sourceSlug}:${externalId}`
  sourceSlug: string; // 'osm' | 'overture' | 'kaggle' | 'mls' | 'parcel-layer:<id>'
  sourceLabel: string;
  externalId: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  lat: number;
  lng: number;
  category: string;
  ownerName?: string;
  parcelId?: string;
  assessedValue?: number;
  yearBuilt?: number;
  lotAcres?: number;
  sourceUrl: string;
  retrievedAt: string;
  /** true when served from Supabase rather than fetched live during this search. */
  fromStore: boolean;
  confidenceScore: number;
}

export interface SourceRunStatus {
  slug: string;
  label: string;
  status: 'ok' | 'empty' | 'error' | 'skipped';
  count: number;
  message?: string;
  ms?: number;
}

export interface MapSearchResponse {
  records: MapRecord[];
  sources: SourceRunStatus[];
  /** Whether live results were saved to Supabase for later searches. */
  persisted: boolean;
}

export interface GeocodeResponse {
  displayName: string;
  lat: number;
  lng: number;
  /** "<house number> <street>" when the match is a street address. */
  streetAddress?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  provider: string;
  sourceUrl: string;
}

export interface DataSourceStatus {
  slug: string;
  name: string;
  sourceType: string;
  provider: string;
  accessType: string;
  cost: string;
  apiUrl: string | null;
  isConnected: boolean;
  isLive: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  recordCount: number;
  metadata: Record<string, unknown>;
}

export interface SourcesResponse {
  supabaseConfigured: boolean;
  supabaseError?: string;
  mls: {
    configured: boolean;
    name: string;
    isTestData: boolean;
    cronEnabled: boolean;
  };
  sources: DataSourceStatus[];
  parcelLayers: DataSourceStatus[];
}
