import type { CampaignDraft, CampaignReviewStatus, CampaignType } from '../src/types/index.js';
import { handler, HttpError, json, readJson } from './_lib/http.js';
import { requireSupabase } from './_lib/supabase.js';

// GET    /api/campaigns
// POST   /api/campaigns           body: CampaignDraft (id = client-generated uuid)
// PATCH  /api/campaigns?id=…      body: Partial<CampaignDraft>

const STATUSES: CampaignReviewStatus[] = ['Pending Approval', 'Needs Edit', 'Approved', 'Delivered', 'Rejected'];
const TYPES: CampaignType[] = ['Monday Newsletter', 'Wednesday Market Education', 'Friday Property Highlights', 'Direct Agent Outreach'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toCampaign(row: Record<string, any>): CampaignDraft {
  return {
    id: row.id,
    title: row.title,
    campaignType: row.campaign_type,
    targetAudience: row.target_audience ?? '',
    subject: row.subject ?? '',
    bodyContent: row.body_content ?? '',
    status: row.status,
    approverNotes: row.approver_notes ?? undefined,
    testSendAddress: row.test_send_address ?? '',
    recipientLeadIds: row.recipient_lead_ids ?? [],
    // The UI edits this with <input type="datetime-local">, which wants "YYYY-MM-DDTHH:mm".
    scheduledDate: row.scheduled_date ? new Date(row.scheduled_date).toISOString().slice(0, 16) : '',
    createdAt: row.created_at,
    sentAt: row.sent_at ?? undefined,
    salesforceCampaignId: row.salesforce_campaign_id ?? undefined
  };
}

function toRow(c: Partial<CampaignDraft>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  const set = (key: string, value: unknown) => {
    if (value !== undefined) row[key] = value;
  };
  if (c.status !== undefined && !STATUSES.includes(c.status)) throw new HttpError(400, `Unknown campaign status "${c.status}".`);
  if (c.campaignType !== undefined && !TYPES.includes(c.campaignType)) throw new HttpError(400, `Unknown campaign type "${c.campaignType}".`);
  set('title', c.title?.slice(0, 300));
  set('campaign_type', c.campaignType);
  set('target_audience', c.targetAudience);
  set('subject', c.subject?.slice(0, 500));
  set('body_content', c.bodyContent);
  set('status', c.status);
  set('approver_notes', c.approverNotes);
  set('test_send_address', c.testSendAddress);
  set('recipient_lead_ids', c.recipientLeadIds?.filter(id => UUID.test(id)));
  if (c.scheduledDate !== undefined) {
    const date = new Date(c.scheduledDate);
    row.scheduled_date = c.scheduledDate && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
  }
  set('sent_at', c.sentAt);
  set('salesforce_campaign_id', c.salesforceCampaignId);
  return row;
}

const idParam = (request: Request) => {
  const id = new URL(request.url).searchParams.get('id') ?? '';
  if (!UUID.test(id)) throw new HttpError(400, 'Missing or invalid ?id=');
  return id;
};

export const GET = handler(async () => {
  const sb = requireSupabase();
  const { data, error } = await sb.from('campaign_drafts').select('*').order('created_at', { ascending: false }).limit(500);
  if (error) throw new HttpError(500, error.message);
  return json({ campaigns: (data ?? []).map(toCampaign) });
});

export const POST = handler(async request => {
  const campaign = await readJson<Partial<CampaignDraft>>(request);
  if (!campaign.title?.trim()) throw new HttpError(400, 'Campaign title is required.');
  if (!campaign.campaignType) throw new HttpError(400, 'Campaign type is required.');
  if (campaign.id && !UUID.test(campaign.id)) throw new HttpError(400, 'Campaign id must be a UUID.');
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('campaign_drafts')
    .insert({ ...(campaign.id ? { id: campaign.id } : {}), ...toRow(campaign) })
    .select('*')
    .single();
  if (error) throw new HttpError(500, error.message);
  return json({ campaign: toCampaign(data) }, 201);
});

export const PATCH = handler(async request => {
  const id = idParam(request);
  const patch = toRow(await readJson<Partial<CampaignDraft>>(request));
  if (!Object.keys(patch).length) throw new HttpError(400, 'Nothing to update.');
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('campaign_drafts')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new HttpError(error.code === 'PGRST116' ? 404 : 500, error.message);
  return json({ campaign: toCampaign(data) });
});
