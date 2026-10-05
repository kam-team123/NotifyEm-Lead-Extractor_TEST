# Notifyem

Real estate lead finder: property map, listings, leads pipeline and collections.
Vite + React front end, with Vercel serverless functions in `api/` that talk to OpenStreetMap,
your MLS feed and Supabase.

## How data flows

```
Browser ──► /api/*  (Vercel functions, server-side)
              ├── /api/geocode        Nominatim → Photon fallback
              ├── /api/map-search     Supabase stored records + live OSM (Overpass mirrors)
              ├── /api/listings       MLS + Kaggle listings from Supabase
              ├── /api/mls/sync       RESO Web API → Supabase (button + daily Vercel Cron)
              ├── /api/import/kaggle  CSV rows (parsed in the browser) → Supabase
              ├── /api/sources        data-source status and MLS configuration
              └── /api/leads, /api/collections
```

The browser never calls Overpass or Supabase directly. Overpass rejects anonymous clients (HTTP 406) and returns
504 when it is overloaded; those error pages have no CORS headers, which is what showed up as "Failed to fetch".

## Deploy (Vercel + Supabase)

1. **Database:** in the Supabase SQL editor run `supabase/0003_app_api.sql`. It is safe whether you ran 0001, 0002 or both,
   and safe to re-run. It adds the columns and keys the API needs and turns on Row Level Security (the API uses the service-role key).
2. **Environment variables:** in Vercel → Project → Settings → Environment Variables, add the keys from `.env.example`.
   At minimum: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. For MLS: `MLS_RESO_URL` + `MLS_ACCESS_TOKEN` (or the OAuth trio) and `CRON_SECRET`.
3. **Redeploy.** `vercel.json` sets a 60 s function limit and a daily MLS sync at 11:00 UTC.

## Data sources

| Source | How it works in the app |
| --- | --- |
| OpenStreetMap | Address-tagged buildings, live (≤ 3 mi radius), cached into Supabase. |
| Realtor.com | Live for-sale search in the Lead Finder through RealtyAPI. Set the server-only `REALTYAPI_KEY`; the API uses paid credits and its terms apply. |
| Overture Maps | `npm i --no-save @duckdb/node-api`, then `npm run import:overture -- --place "Austin, TX" --radius 5`. |
| Kaggle | Listings page → *Import Kaggle CSV* (streams large files, filters by state). Stored as historical snapshots. |
| RPR | No public API exists; the panel links to narrpr.com. |
| MLS | Any RESO Web API feed: Bridge, Trestle, MLS Grid, Spark, or your MLS directly. MLS data needs a data license (IDX/VOW) from your MLS. `MLS_PROVIDER=bridge-test` loads Bridge's synthetic sandbox to test the pipeline. Those records are labelled TEST DATA and deleted on the first real sync. |

## Run locally

```
npm install
cp .env.example .env.local   # fill in values
npm run dev                  # http://localhost:3000, /api routes served by the Vite dev server
```

## Not done yet

- The app has no login. Anyone with the URL can read and write leads and trigger syncs. Add Supabase Auth before sharing it widely.
- Salesforce sync is still a placeholder.
