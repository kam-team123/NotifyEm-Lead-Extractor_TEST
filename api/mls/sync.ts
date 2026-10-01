import { handler, HttpError, isCronRequest, json } from '../_lib/http.js';
import { markSourceStatus, requireSupabase, sourceIdBySlug } from '../_lib/supabase.js';
import { fetchResoProperties, mapResoRecord, readMlsConfig } from '../_lib/reso.js';

// POST /api/mls/sync            — "Sync MLS now" button (incremental)
// POST /api/mls/sync?full=1     — re-pull everything allowed by MLS_MAX_RECORDS
// GET  /api/mls/sync            — Vercel Cron (daily, see vercel.json); requires Authorization: Bearer $CRON_SECRET

async function runSync(full: boolean) {
  const config = readMlsConfig();
  if (!config) {
    throw new HttpError(
      400,
      'No MLS feed is configured. Set MLS_RESO_URL plus MLS_ACCESS_TOKEN (or MLS_OAUTH_TOKEN_URL, MLS_CLIENT_ID, MLS_CLIENT_SECRET) in Vercel, or MLS_PROVIDER=bridge-test to try the sandbox.'
    );
  }
  const sb = requireSupabase();
  const sourceId = await sourceIdBySlug(sb, 'mls');
  const started = Date.now();

  // Never mix sandbox records with a real feed.
  if (!config.isTestData) {
    await sb.from('listings').delete().eq('source_id', sourceId).eq('is_test_data', true);
    await sb.from('properties').delete().eq('source_id', sourceId).eq('verification_status', 'test_data');
  }

  let since: string | null = null;
  if (!full) {
    const { data } = await sb
      .from('listings')
      .select('source_modified_at')
      .eq('source_id', sourceId)
      .eq('is_test_data', config.isTestData)
      .not('source_modified_at', 'is', null)
      .order('source_modified_at', { ascending: false })
      .limit(1);
    since = data?.[0]?.source_modified_at ? new Date(data[0].source_modified_at).toISOString() : null;
  }

  let processed = 0;
  let upserted = 0;
  try {
    for await (const page of fetchResoProperties(config, since, 45000)) {
      const mapped = [
        ...new Map(
          page
            .map(r => mapResoRecord(r, config.isTestData))
            .filter(m => m.listingKey)
            .map(m => [m.listingKey, m] as const)
        ).values()
      ];
      processed += page.length;
      if (!mapped.length) continue;

      const { data: props, error: propError } = await sb
        .from('properties')
        .upsert(mapped.map(m => ({ ...m.property, source_id: sourceId })), { onConflict: 'source_id,external_id' })
        .select('id, external_id');
      if (propError) throw new Error(`Saving MLS properties failed: ${propError.message}`);
      const propertyIds = new Map((props ?? []).map(p => [p.external_id as string, p.id as string]));

      const { error: listError } = await sb.from('listings').upsert(
        mapped.map(m => ({ ...m.listing, source_id: sourceId, property_id: propertyIds.get(m.listingKey) ?? null })),
        { onConflict: 'source_id,listing_id' }
      );
      if (listError) throw new Error(`Saving MLS listings failed: ${listError.message}`);
      upserted += mapped.length;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markSourceStatus(sb, 'mls', { last_error: message, is_live: false });
    throw error instanceof HttpError ? error : new HttpError(502, message);
  }

  const { count } = await sb.from('listings').select('id', { count: 'exact', head: true }).eq('source_id', sourceId);
  await markSourceStatus(sb, 'mls', {
    is_connected: true,
    is_live: true,
    last_sync_at: new Date().toISOString(),
    last_error: null,
    record_count: count ?? upserted
  });

  return { feed: config.name, isTestData: config.isTestData, incrementalSince: since, processed, upserted, totalListings: count ?? null, ms: Date.now() - started };
}

export const GET = handler(async request => {
  if (!isCronRequest(request)) throw new HttpError(401, 'GET is reserved for Vercel Cron. Use POST to sync from the app.');
  return json(await runSync(false));
});

export const POST = handler(async request => {
  const full = new URL(request.url).searchParams.get('full') === '1';
  return json(await runSync(full));
});
