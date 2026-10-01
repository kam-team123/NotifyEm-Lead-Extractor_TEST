# NotifyEm: How the System Should Work

**Operational guide | Version 1.0 | October 2, 2026**

This guide describes expected behavior for the current NotifyEm application. MLS access requires a separate license from your MLS or data vendor.

## System path

The browser sends requests to NotifyEm's server-side API. The API reads or writes Supabase and, where needed, requests data from OpenStreetMap or an MLS RESO Web API. Credentials stay on the server and are never placed in browser code or this guide.

Before using persistence, the Supabase project must have the current schema from `supabase/0003_app_api.sql`. Production environment variables belong in Vercel Project Settings, followed by a redeploy.

## Property Map

1. Open **Property Map** and search an address, city, state, or ZIP. The compact search on the map performs the same search.
2. NotifyEm geocodes the place and searches stored records and OpenStreetMap. Each source reports its own success, empty, skipped, or error status; one unavailable source should not hide the others.
3. The map shows returned properties. The results list scrolls independently. Clicking a marker selects the result and opens its source record when the record has a source URL.
4. Use **Qualify & Add to Leads** to create a lead from a result. Complete the required fields and save it to the lead pipeline.

Search-radius limits protect live services: OpenStreetMap searches up to 3 miles and records already stored in Supabase up to 50 miles. A selected radius above a live source's limit does not increase that source's coverage.

## MLS Listings

MLS data is not available until an MLS or authorized vendor approves a licensed IDX/VOW RESO Web API feed and provides credentials. The app supports a base feed URL plus either an access token or OAuth client credentials. Configure these as server-only Vercel environment variables; never paste secrets into the browser, source control, or this PDF.

1. Configure the feed URL and approved credentials. Add the optional feed name or provider-required filters when needed.
2. Open **Listings** and run **Sync MLS now**. The server requests RESO Property records and saves accepted listings and property details in Supabase. Later manual runs are incremental when modification timestamps are available.
3. With Vercel Cron enabled and its secret configured, the scheduled sync runs daily at 11:00 UTC. The Listings screen reports sync status and failures.
4. Filter and review the saved listings. Listing availability, fields, media, and permitted uses depend on the MLS feed agreement.

The Bridge sandbox is only for testing the sync path. Its records are synthetic, should never be used for outreach, and are marked as test data. The first real-feed sync removes sandbox records.

## Leads and Other Areas

Qualified map results and manually entered leads should persist to Supabase and appear in **Leads & Pipeline**. Collections also persist. If a save fails, the app should show an error rather than imply that the change reached the database.

AI campaign drafts are review-only and are not currently persisted or sent as email. Salesforce is not a live integration: its screen is informational, and sync actions do not send records to Salesforce.

## Health Checks and Troubleshooting

- **MLS sync is disabled:** no valid feed configuration reached the server. Check the Vercel environment variables and redeploy.
- **MLS returns 401 or 403:** the MLS rejected the token or OAuth credentials, or the account/feed lacks permission. Confirm access with the MLS/vendor.
- **OpenStreetMap is unavailable:** retry later. Stored results can still be returned independently.
- **A database column is missing:** the Supabase schema and API expectations are out of sync. Apply the current SQL migration and verify the affected table before retrying.
- **A result is marked TEST DATA:** it is synthetic sandbox content, not a real listing.

## Security and Current Limitations

The application currently has no login or user authorization. Do not expose a production deployment publicly until access controls are added. Store service-role keys, MLS tokens, OAuth secrets, and cron secrets only in protected server-side environment settings. Rotate any credential that has been shared or exposed.

Salesforce sync is a placeholder, campaigns do not send email, and MLS access remains subject to the MLS's license and display rules.