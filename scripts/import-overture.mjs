#!/usr/bin/env node
// Import Overture Maps address points for an area into Supabase (public.properties, source "overture").
//
//   npm i --no-save @duckdb/node-api          # once; DuckDB is not a runtime dependency of the app
//   npm run import:overture -- --place "Austin, TX" --radius 5
//   npm run import:overture -- --bbox -97.80,30.20,-97.65,30.35 --limit 100000
//
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local (or the environment).
// Overture data is read straight from the public S3 bucket (no account needed). A city-sized area
// usually takes 1–5 minutes: DuckDB has to read the release's parquet metadata first.

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const args = process.argv.slice(2);
const arg = name => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const UA = 'Notifyem-overture-import/1.0';

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

async function latestRelease() {
  const res = await fetch('https://overturemaps-us-west-2.s3.amazonaws.com/?list-type=2&prefix=release/&delimiter=/');
  const xml = await res.text();
  const releases = [...xml.matchAll(/<Prefix>release\/([^/<]+)\/<\/Prefix>/g)].map(m => m[1]).sort();
  if (!releases.length) fail('Could not list Overture releases.');
  return releases[releases.length - 1];
}

async function geocode(place) {
  const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({ q: place, countrycodes: 'us', format: 'jsonv2', limit: '1' })}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  const [hit] = await res.json();
  if (!hit) fail(`No US location matched "${place}".`);
  return { lat: Number(hit.lat), lng: Number(hit.lon), name: hit.display_name };
}

async function main() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) fail('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local');

  let bbox;
  if (arg('bbox')) {
    bbox = arg('bbox').split(',').map(Number);
    if (bbox.length !== 4 || bbox.some(v => !Number.isFinite(v))) fail('--bbox must be west,south,east,north');
  } else if (arg('place')) {
    const radius = Number(arg('radius') || 3);
    const c = await geocode(arg('place'));
    const dLat = radius / 69;
    const dLng = radius / (69.172 * Math.cos((c.lat * Math.PI) / 180));
    bbox = [c.lng - dLng, c.lat - dLat, c.lng + dLng, c.lat + dLat];
    console.log(`Area: ${c.name} (±${radius} mi)`);
  } else {
    fail('Pass --place "City, ST" [--radius miles] or --bbox west,south,east,north');
  }
  const [west, south, east, north] = bbox;
  const limit = Math.max(1, Number(arg('limit') || 50000));

  let duck;
  try {
    duck = await import('@duckdb/node-api');
  } catch {
    fail('DuckDB is not installed. Run:  npm i --no-save @duckdb/node-api');
  }

  const release = arg('release') || (await latestRelease());
  console.log(`Overture release ${release}; reading addresses from S3 (this can take a few minutes)…`);

  const db = await duck.DuckDBInstance.create(':memory:');
  const conn = await db.connect();
  await conn.run("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; SET s3_region='us-west-2';");
  const started = Date.now();
  const reader = await conn.runAndReadAll(`
    SELECT id, number, street, unit, postcode, postal_city,
           address_levels[1].value AS level1, address_levels[2].value AS level2,
           ST_X(geometry) AS lng, ST_Y(geometry) AS lat
    FROM read_parquet('s3://overturemaps-us-west-2/release/${release}/theme=addresses/type=address/*', hive_partitioning=1)
    WHERE country = 'US'
      AND bbox.xmin >= ${west} AND bbox.xmax <= ${east}
      AND bbox.ymin >= ${south} AND bbox.ymax <= ${north}
    LIMIT ${limit}`);
  const rows = reader.getRowObjectsJson();
  console.log(`Fetched ${rows.length.toLocaleString()} address points in ${Math.round((Date.now() - started) / 1000)}s.`);
  if (!rows.length) return;
  if (args.includes('--dry-run')) {
    console.log(rows.slice(0, 5));
    return;
  }

  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { data: source, error: sourceError } = await sb.from('data_sources').select('id').eq('slug', 'overture').maybeSingle();
  if (sourceError || !source) fail(`Overture data source row missing. Run supabase/0003_app_api.sql first. ${sourceError?.message ?? ''}`);

  const now = new Date().toISOString();
  let saved = 0;
  for (let i = 0; i < rows.length; i += 1000) {
    const batch = rows.slice(i, i + 1000).map(r => {
      const street = [r.number, r.street].filter(Boolean).join(' ') + (r.unit ? ` #${String(r.unit).replace(/^#/, '')}` : '');
      const state = typeof r.level1 === 'string' && r.level1.length === 2 ? r.level1 : null;
      const city = r.postal_city || r.level2 || null;
      return {
        source_id: source.id,
        external_id: r.id,
        street_address: street || null,
        full_address: [street, city, [state, r.postcode].filter(Boolean).join(' ')].filter(Boolean).join(', '),
        city,
        state,
        zip_code: r.postcode ? String(r.postcode).slice(0, 10) : null,
        latitude: Number(r.lat),
        longitude: Number(r.lng),
        property_type: 'Address point',
        confidence_score: 80,
        source_url: `https://explore.overturemaps.org/#16/${Number(r.lat).toFixed(5)}/${Number(r.lng).toFixed(5)}`,
        verification_status: 'source_record',
        metadata: { overtureRelease: release },
        updated_at: now
      };
    });
    const { error } = await sb.from('properties').upsert(batch, { onConflict: 'source_id,external_id' });
    if (error) fail(`Supabase upsert failed: ${error.message}`);
    saved += batch.length;
    process.stdout.write(`\rSaved ${saved.toLocaleString()} / ${rows.length.toLocaleString()}`);
  }

  const { count } = await sb.from('properties').select('id', { count: 'exact', head: true }).eq('source_id', source.id);
  await sb
    .from('data_sources')
    .update({ is_connected: true, last_sync_at: now, last_error: null, record_count: count ?? saved, updated_at: now })
    .eq('slug', 'overture');
  console.log(`\n✔ Done. ${count?.toLocaleString() ?? saved} Overture addresses in Supabase. They now appear on the Property Map.`);
}

main().catch(error => fail(error instanceof Error ? error.message : String(error)));
