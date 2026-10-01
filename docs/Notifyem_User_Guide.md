# NotifyEm User Guide

**Version 1.1 | October 2, 2026**

This guide describes the current NotifyEm application. It covers property discovery, MLS listings, lead management, and current integration limits.

## Main Areas

- **Property Map:** Search a place, review stored property records and live OpenStreetMap results, then qualify a result as a lead.
- **Listings:** Browse saved MLS listings and imported Kaggle snapshots. A real MLS feed must be licensed and configured by an administrator.
- **Leads & Pipeline:** Review leads and move them through the sales stages.
- **AI Campaigns:** Prepare and review draft outreach. NotifyEm does not send email.
- **Salesforce:** Displays planned connection settings. Salesforce sync is not active.
- **Collections:** Group leads by market or audience.

## Property Map

1. Enter an address, city, state, or ZIP and submit the search. The compact search on the map works the same way.
2. Results combine matching records already stored in Supabase with live OpenStreetMap building/address results.
3. Source status indicates whether each source succeeded, returned no records, was skipped, or failed. A source failure should not suppress results from other sources.
4. Select a result card or map marker to see its details. When available, its source link opens the original record.
5. Choose **Qualify & Add to Leads** to enter the contact details needed to save it to the pipeline.

Live OpenStreetMap searches are capped at 3 miles from the search center. Stored results are searched up to 50 miles. The radius control can be wider than a live source's coverage. A mapped building is not proof that a property is currently listed for sale.

## MLS Listings

MLS data requires an approved IDX/VOW license and RESO Web API access from your MLS or authorized vendor. An administrator configures the feed URL and server-only token or OAuth credentials in Vercel, then redeploys.

Use **Sync MLS now** on the Listings page to request new or changed records. A configured Vercel Cron can run the sync daily. Review sync status and errors on the Listings page. Available fields, photos, and permitted display depend on the feed agreement.

The Bridge test sandbox contains synthetic records only. Do not use test records for outreach. The first sync against a real feed removes sandbox records.

Kaggle imports are historical snapshots, not current MLS availability. Filter them by source and treat their statuses as potentially outdated.

## Leads and Collections

Add leads from a qualified map result or through the Leads & Pipeline view. Complete required contact and address fields, then save. Move saved leads through the pipeline stages and group them in collections as needed.

If a save fails, treat the displayed error as authoritative and verify the record before retrying. The app requires the Supabase schema migration `supabase/0003_app_api.sql` for its current API fields.

## Troubleshooting and Security

- **No map results:** Try a specific city or street address. Coverage varies, and live OpenStreetMap availability can fluctuate.
- **MLS sync disabled:** Check that the feed URL and valid credentials are set in server-side environment settings, then redeploy.
- **MLS 401/403:** Ask the MLS/vendor to confirm the token, feed permissions, and IDX/VOW access.
- **Database column missing:** Apply the current SQL migration and verify that the API and Supabase schemas match.
- **TEST DATA label:** These are synthetic sandbox records, not real properties.

NotifyEm currently has no login or user authorization. Do not expose a production deployment publicly until access controls are added. Keep database service keys, MLS credentials, and cron secrets in protected server-side settings. Rotate credentials that have been shared or exposed.