import type { SalesforceConfig, SalesforceSyncLog } from '../src/types/index.js';
import { handler, HttpError, json, readJson } from './_lib/http.js';
import { requireSupabase } from './_lib/supabase.js';

// GET   /api/salesforce          → { config, logs }
// PATCH /api/salesforce          body: Partial<SalesforceConfig>   (non-secret Connected App settings)
// POST  /api/salesforce          body: { operation }               (records a sync attempt in the audit trail)
//
// Secrets (client secret, refresh token) are never stored here; a live integration reads them from env vars.

const SETTINGS_KEY = 'salesforce';
const OPERATIONS: SalesforceSyncLog['operation'][] = ['Push Leads', 'Sync Daily Listings', 'Pull Inbound Contacts', 'Nightly Batch'];
const SYNC_MODES: SalesforceConfig['syncMode'][] = ['Realtime Webhook', 'Daily Batch (08:00 AM EST)', 'Manual'];

type StoredSettings = Pick<
  SalesforceConfig,
  'instanceUrl' | 'orgId' | 'clientId' | 'environment' | 'apiVersion' | 'syncMode' | 'autoSyncDailyListings' | 'enforceSuppression'
>;

const DEFAULTS: StoredSettings = {
  instanceUrl: '',
  orgId: '',
  clientId: '',
  environment: 'Production',
  apiVersion: 'v60.0',
  syncMode: 'Manual',
  autoSyncDailyListings: false,
  enforceSuppression: true
};

function cleanSettings(input: Partial<SalesforceConfig>): Partial<StoredSettings> {
  const out: Partial<StoredSettings> = {};
  const text = (value: unknown, max = 300) => (typeof value === 'string' ? value.trim().slice(0, max) : undefined);
  if (input.instanceUrl !== undefined) {
    const url = text(input.instanceUrl) ?? '';
    if (url && !/^https:\/\/[^\s/]+/i.test(url)) throw new HttpError(400, 'Instance URL must start with https://');
    out.instanceUrl = url.replace(/\/+$/, '');
  }
  if (input.orgId !== undefined) out.orgId = text(input.orgId, 40) ?? '';
  if (input.clientId !== undefined) out.clientId = text(input.clientId, 300) ?? '';
  if (input.environment !== undefined) out.environment = input.environment === 'Sandbox' ? 'Sandbox' : 'Production';
  if (input.apiVersion !== undefined) out.apiVersion = /^v\d+\.\d$/.test(input.apiVersion) ? input.apiVersion : DEFAULTS.apiVersion;
  if (input.syncMode !== undefined) out.syncMode = SYNC_MODES.includes(input.syncMode) ? input.syncMode : 'Manual';
  if (input.autoSyncDailyListings !== undefined) out.autoSyncDailyListings = Boolean(input.autoSyncDailyListings);
  if (input.enforceSuppression !== undefined) out.enforceSuppression = Boolean(input.enforceSuppression);
  return out;
}

function toLog(row: Record<string, any>): SalesforceSyncLog {
  return {
    id: row.id,
    timestamp: row.created_at,
    operation: row.operation,
    status: row.status,
    recordsProcessed: row.records_processed ?? 0,
    recordsSucceeded: row.records_succeeded ?? 0,
    recordsFailed: row.records_failed ?? 0,
    salesforceIds: row.salesforce_ids ?? [],
    message: row.message ?? '',
    durationMs: row.duration_ms ?? 0
  };
}

async function loadSettings(sb: ReturnType<typeof requireSupabase>): Promise<StoredSettings> {
  const { data, error } = await sb.from('app_settings').select('value').eq('key', SETTINGS_KEY).maybeSingle();
  if (error) throw new HttpError(500, error.message);
  return { ...DEFAULTS, ...cleanSettings((data?.value ?? {}) as Partial<SalesforceConfig>) };
}

export const GET = handler(async () => {
  const sb = requireSupabase();
  const [settings, logsRes] = await Promise.all([
    loadSettings(sb),
    sb.from('salesforce_sync_events').select('*').order('created_at', { ascending: false }).limit(200)
  ]);
  if (logsRes.error) throw new HttpError(500, logsRes.error.message);
  const logs = (logsRes.data ?? []).map(toLog);
  const lastSuccess = logs.find(l => l.status === 'SUCCESS');

  const config: SalesforceConfig = {
    ...settings,
    // No live OAuth integration exists yet, so the app is never "connected".
    isConnected: false,
    lastSyncTimestamp: lastSuccess?.timestamp ?? null,
    totalSyncedLeads: logs.filter(l => l.operation === 'Push Leads').reduce((sum, l) => sum + l.recordsSucceeded, 0)
  };
  return json({ config, logs });
});

export const PATCH = handler(async request => {
  const patch = cleanSettings(await readJson<Partial<SalesforceConfig>>(request));
  const sb = requireSupabase();
  const value = { ...(await loadSettings(sb)), ...patch };
  const { error } = await sb.from('app_settings').upsert({ key: SETTINGS_KEY, value, updated_at: new Date().toISOString() });
  if (error) throw new HttpError(500, error.message);
  return json({ settings: value });
});

export const POST = handler(async request => {
  const { operation, recordsProcessed } = await readJson<{ operation?: SalesforceSyncLog['operation']; recordsProcessed?: number }>(request);
  if (!operation || !OPERATIONS.includes(operation)) throw new HttpError(400, 'Unknown sync operation.');
  const sb = requireSupabase();
  const processed = Math.max(0, Math.min(100000, Math.round(Number(recordsProcessed) || 0)));

  // The outcome is decided here, not by the browser: without a live integration every attempt fails.
  const { data, error } = await sb
    .from('salesforce_sync_events')
    .insert({
      operation,
      status: 'FAILED',
      records_processed: processed,
      records_succeeded: 0,
      records_failed: processed,
      message: 'Not sent: no live Salesforce OAuth/API integration is configured on the server.',
      duration_ms: 0
    })
    .select('*')
    .single();
  if (error) throw new HttpError(500, error.message);
  return json({ log: toLog(data) }, 201);
});
