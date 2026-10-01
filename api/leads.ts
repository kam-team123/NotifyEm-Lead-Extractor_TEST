import type { PipelineState, RealEstateLead } from '../src/types/index.js';
import { handler, HttpError, json, readJson } from './_lib/http.js';
import { requireSupabase } from './_lib/supabase.js';

// GET   /api/leads
// POST  /api/leads          body: RealEstateLead (id = client-generated uuid)
// PATCH /api/leads?id=…     body: Partial<RealEstateLead>

const PIPELINE_STATES: PipelineState[] = [
  'New', 'Researched', 'Contacted', 'Engaged', 'Referral Received', 'Active Partner', 'Dormant', 'Do Not Contact'
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COLUMNS =
  'id, first_name, last_name, email, phone, brokerage_or_company, lead_role, lead_category, street, city, state, postal_code, ' +
  'latitude, longitude, pipeline_state, lead_source, collection_id, target_budget_or_price, salesforce_sync_status, notes, ' +
  'source_url, verification_status, confidence_score, score_reason, created_at, updated_at';

function toLead(row: Record<string, any>): RealEstateLead {
  return {
    id: row.id,
    firstName: row.first_name ?? '',
    lastName: row.last_name ?? '',
    email: row.email ?? '',
    phone: row.phone ?? '',
    brokerageOrCompany: row.brokerage_or_company ?? '',
    role: row.lead_role ?? 'Property Owner',
    category: row.lead_category ?? 'Residential Single-Family',
    street: row.street ?? '',
    city: row.city ?? '',
    state: row.state ?? '',
    postalCode: row.postal_code ?? '',
    latitude: Number(row.latitude ?? 0),
    longitude: Number(row.longitude ?? 0),
    pipelineState: row.pipeline_state ?? 'New',
    leadSource: row.lead_source ?? 'Manual Intake',
    collectionId: row.collection_id ?? undefined,
    targetBudgetOrPrice: row.target_budget_or_price ? Number(row.target_budget_or_price) : undefined,
    salesforceSyncStatus: row.salesforce_sync_status ?? 'Not Synced',
    notes: row.notes ?? '',
    sourceUrl: row.source_url ?? '',
    collectedAt: row.created_at,
    verificationStatus: row.verification_status ?? 'unverified',
    confidenceScore: row.confidence_score === null || row.confidence_score === undefined ? null : Number(row.confidence_score),
    scoreReason: row.score_reason ?? '',
    createdAt: row.created_at
  };
}

function toRow(lead: Partial<RealEstateLead>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  const set = (key: string, value: unknown) => {
    if (value !== undefined) row[key] = value;
  };
  set('first_name', lead.firstName);
  set('last_name', lead.lastName);
  set('email', lead.email);
  set('phone', lead.phone);
  set('brokerage_or_company', lead.brokerageOrCompany);
  set('lead_role', lead.role);
  set('lead_category', lead.category);
  set('street', lead.street);
  set('city', lead.city);
  set('state', lead.state);
  set('postal_code', lead.postalCode);
  set('latitude', lead.latitude);
  set('longitude', lead.longitude);
  set('lead_source', lead.leadSource);
  set('collection_id', lead.collectionId === undefined ? undefined : UUID.test(lead.collectionId) ? lead.collectionId : null);
  set('target_budget_or_price', lead.targetBudgetOrPrice);
  set('salesforce_sync_status', lead.salesforceSyncStatus);
  set('notes', lead.notes);
  set('source_url', lead.sourceUrl);
  set('verification_status', lead.verificationStatus);
  set('confidence_score', lead.confidenceScore);
  set('score_reason', lead.scoreReason);
  if (lead.pipelineState !== undefined) {
    if (!PIPELINE_STATES.includes(lead.pipelineState)) throw new HttpError(400, `Unknown pipeline state "${lead.pipelineState}".`);
    row.pipeline_state = lead.pipelineState;
  }
  return row;
}

export const GET = handler(async () => {
  const sb = requireSupabase();
  const { data, error } = await sb.from('leads').select(COLUMNS).order('created_at', { ascending: false }).limit(2000);
  if (error) throw new HttpError(500, error.message);
  return json({ leads: (data ?? []).map(toLead) });
});

export const POST = handler(async request => {
  const lead = await readJson<Partial<RealEstateLead>>(request);
  if (!lead.firstName?.trim() || !lead.lastName?.trim()) throw new HttpError(400, 'First and last name are required.');
  if (lead.id && !UUID.test(lead.id)) throw new HttpError(400, 'Lead id must be a UUID.');
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('leads')
    .insert({ ...(lead.id ? { id: lead.id } : {}), ...toRow(lead) })
    .select(COLUMNS)
    .single();
  if (error) throw new HttpError(500, error.message);
  return json({ lead: toLead(data) }, 201);
});

export const PATCH = handler(async request => {
  const id = new URL(request.url).searchParams.get('id') ?? '';
  if (!UUID.test(id)) throw new HttpError(400, 'Missing or invalid ?id=');
  const patch = toRow(await readJson<Partial<RealEstateLead>>(request));
  if (!Object.keys(patch).length) throw new HttpError(400, 'Nothing to update.');
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('leads')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(COLUMNS)
    .single();
  if (error) throw new HttpError(error.code === 'PGRST116' ? 404 : 500, error.message);
  return json({ lead: toLead(data) });
});
