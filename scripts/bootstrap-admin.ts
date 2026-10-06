#!/usr/bin/env -S npx tsx
// One-time creation of NotifyEm's initial administrator: public UID 001, username Manny, role admin.
//
//   npm run bootstrap:admin
//
// Reads from .env.local (never committed) or the environment:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   – already used by the app
//   BOOTSTRAP_ADMIN_EMAIL                     – the admin's real email (used for password recovery)
//   BOOTSTRAP_ADMIN_PASSWORD                  – a TEMPORARY password; the admin must change it at first login
//
// Idempotent: if admin 001 already exists, nothing changes and the password is NEVER reset.
// After a successful run, delete BOOTSTRAP_ADMIN_PASSWORD from .env.local. See docs/AUTH_SETUP.md.

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { BootstrapError, bootstrapAdmin, INITIAL_ADMIN } from './lib/bootstrapAdmin';

dotenv.config({ path: '.env.local' });
dotenv.config();

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

if (!url || !serviceKey) {
  console.error('\n✖ Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.\n');
  process.exit(1);
}

const sb = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

try {
  const result = await bootstrapAdmin(sb, {
    email: process.env.BOOTSTRAP_ADMIN_EMAIL || '',
    password: process.env.BOOTSTRAP_ADMIN_PASSWORD || ''
  });
  if (result.status === 'already_exists') {
    console.log(`\n✓ Admin ${INITIAL_ADMIN.publicUid} already exists (username "${result.username}"). Nothing changed; the password was not touched.`);
  } else {
    console.log(`\n✓ Admin created: UID ${INITIAL_ADMIN.publicUid}, username "${INITIAL_ADMIN.username}", role ${INITIAL_ADMIN.role}.`);
    if (result.status === 'linked_existing_auth_user') {
      console.log('  An existing Supabase Auth user with this email was linked; its password was not changed.');
    }
    console.log('  Sign in at NotifyEm; you will be asked to replace the temporary password before anything else.');
  }
  console.log('  Now delete BOOTSTRAP_ADMIN_PASSWORD from .env.local (and anywhere else you stored it).\n');
} catch (error) {
  console.error(`\n✖ ${error instanceof BootstrapError ? error.message : error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
