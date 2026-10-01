import {
  CampaignDraft,
  DatabaseCollection,
  PropertyListing,
  RealEstateLead,
  SalesforceConfig,
  SalesforceSyncLog,
  USStateSummary
} from '../types';

export const US_STATES: USStateSummary[] = [
  { code: 'AL', name: 'Alabama', anchorCity: 'Huntsville' },
  { code: 'AK', name: 'Alaska', anchorCity: 'Anchorage' },
  { code: 'AZ', name: 'Arizona', anchorCity: 'Phoenix' },
  { code: 'AR', name: 'Arkansas', anchorCity: 'Little Rock' },
  { code: 'CA', name: 'California', anchorCity: 'Los Angeles' },
  { code: 'CO', name: 'Colorado', anchorCity: 'Denver' },
  { code: 'CT', name: 'Connecticut', anchorCity: 'Bridgeport' },
  { code: 'DE', name: 'Delaware', anchorCity: 'Wilmington' },
  { code: 'DC', name: 'District of Columbia', anchorCity: 'Washington' },
  { code: 'FL', name: 'Florida', anchorCity: 'Jacksonville' },
  { code: 'GA', name: 'Georgia', anchorCity: 'Atlanta' },
  { code: 'HI', name: 'Hawaii', anchorCity: 'Honolulu' },
  { code: 'ID', name: 'Idaho', anchorCity: 'Boise' },
  { code: 'IL', name: 'Illinois', anchorCity: 'Chicago' },
  { code: 'IN', name: 'Indiana', anchorCity: 'Indianapolis' },
  { code: 'IA', name: 'Iowa', anchorCity: 'Des Moines' },
  { code: 'KS', name: 'Kansas', anchorCity: 'Wichita' },
  { code: 'KY', name: 'Kentucky', anchorCity: 'Louisville' },
  { code: 'LA', name: 'Louisiana', anchorCity: 'New Orleans' },
  { code: 'ME', name: 'Maine', anchorCity: 'Portland' },
  { code: 'MD', name: 'Maryland', anchorCity: 'Baltimore' },
  { code: 'MA', name: 'Massachusetts', anchorCity: 'Boston' },
  { code: 'MI', name: 'Michigan', anchorCity: 'Detroit' },
  { code: 'MN', name: 'Minnesota', anchorCity: 'Minneapolis' },
  { code: 'MS', name: 'Mississippi', anchorCity: 'Jackson' },
  { code: 'MO', name: 'Missouri', anchorCity: 'Kansas City' },
  { code: 'MT', name: 'Montana', anchorCity: 'Billings' },
  { code: 'NE', name: 'Nebraska', anchorCity: 'Omaha' },
  { code: 'NV', name: 'Nevada', anchorCity: 'Las Vegas' },
  { code: 'NH', name: 'New Hampshire', anchorCity: 'Manchester' },
  { code: 'NJ', name: 'New Jersey', anchorCity: 'Newark' },
  { code: 'NM', name: 'New Mexico', anchorCity: 'Albuquerque' },
  { code: 'NY', name: 'New York', anchorCity: 'New York' },
  { code: 'NC', name: 'North Carolina', anchorCity: 'Charlotte' },
  { code: 'ND', name: 'North Dakota', anchorCity: 'Fargo' },
  { code: 'OH', name: 'Ohio', anchorCity: 'Columbus' },
  { code: 'OK', name: 'Oklahoma', anchorCity: 'Oklahoma City' },
  { code: 'OR', name: 'Oregon', anchorCity: 'Portland' },
  { code: 'PA', name: 'Pennsylvania', anchorCity: 'Philadelphia' },
  { code: 'RI', name: 'Rhode Island', anchorCity: 'Providence' },
  { code: 'SC', name: 'South Carolina', anchorCity: 'Charleston' },
  { code: 'SD', name: 'South Dakota', anchorCity: 'Sioux Falls' },
  { code: 'TN', name: 'Tennessee', anchorCity: 'Nashville' },
  { code: 'TX', name: 'Texas', anchorCity: 'Houston' },
  { code: 'UT', name: 'Utah', anchorCity: 'Salt Lake City' },
  { code: 'VT', name: 'Vermont', anchorCity: 'Burlington' },
  { code: 'VA', name: 'Virginia', anchorCity: 'Virginia Beach' },
  { code: 'WA', name: 'Washington', anchorCity: 'Seattle' },
  { code: 'WV', name: 'West Virginia', anchorCity: 'Charleston' },
  { code: 'WI', name: 'Wisconsin', anchorCity: 'Milwaukee' },
  { code: 'WY', name: 'Wyoming', anchorCity: 'Cheyenne' }
];

export const INITIAL_LEADS: RealEstateLead[] = [];
export const INITIAL_PROPERTY_LISTINGS: PropertyListing[] = [];
export const INITIAL_COLLECTIONS: DatabaseCollection[] = [];
export const INITIAL_SYNC_LOGS: SalesforceSyncLog[] = [];
export const INITIAL_CAMPAIGNS: CampaignDraft[] = [];

export const INITIAL_SALESFORCE_CONFIG: SalesforceConfig = {
  isConnected: false,
  instanceUrl: '',
  orgId: '',
  clientId: '',
  environment: 'Production',
  apiVersion: '',
  syncMode: 'Manual',
  lastSyncTimestamp: null,
  totalSyncedLeads: 0,
  autoSyncDailyListings: false,
  enforceSuppression: true
};