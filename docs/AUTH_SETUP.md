# NotifyEm sign-in setup

> **Notice:** The application currently opens without sign-in. The authentication setup below describes
> dormant sign-in endpoints and is not an access control for the deployed app. Server API routes use a
> Supabase service-role key; anyone who can reach the app may be able to access or modify its data.
> Do not deploy publicly with private or sensitive data.

Status: **Phases 2–3 of 6.** Sign-in, sign-out, forced password change, password reset, invitations
(server side) and the admin bootstrap exist.
**Still open:** the data routes (`/api/leads`, `/api/map-search`, …) are **not yet protected** and are
reachable without signing in until Phase 4. The admin screens (user list, invite form, audit log) come
in Phase 5.

## How it works

- **Identity:** Supabase Auth stores and hashes passwords and issues session tokens. NotifyEm never
  stores, hashes or logs passwords itself.
- **Username login:** usernames (e.g. `Manny`) live in `public.app_users`. The server looks up the
  account's email from the username and signs in through Supabase Auth. Wrong usernames and wrong
  passwords get the same message.
- **Sessions:** tokens are kept in `HttpOnly`, `SameSite=Lax`, `Secure` cookies (prefix `__Host-` on
  HTTPS). Page scripts cannot read them. Writes must come from NotifyEm's own origin (CSRF check).
  Signing in elsewhere after a password change or reset signs out all other sessions.
- **Rate limits:** sign-in (20 per IP / 8 per username per 15 min), reset (5 per hour), invitations
  (30 per admin per hour). Supabase Auth applies its own limits too.
- **Roles:** `admin` and `user` in `app_users.role`. Users cannot change their own role, status,
  username or UID: the database gives signed-in users no permission to update those columns.
- **Audit log:** `public.audit_events` is append-only, readable by admins only, and never stores
  passwords, tokens or keys.

## API routes

All sign-in endpoints share one Vercel function, and admin endpoints another, to stay within the
Hobby plan's 12-function limit.

| Route | Purpose |
|---|---|
| `GET /api/auth` | Current user (401 when signed out) |
| `POST /api/auth?action=login` | `{ username, password }` |
| `POST /api/auth?action=logout` | Revokes the session, clears cookies |
| `POST /api/auth?action=change-password` | `{ currentPassword, newPassword }` |
| `POST /api/auth?action=forgot-password` | `{ identifier }` (username or email) |
| `POST /api/auth?action=complete` | `{ tokenHash, type: 'invite' \| 'recovery', newPassword }` |
| `POST /api/admin?action=invite` | Admins only: `{ username, email, role?, fullName? }` |

Password rules (`src/lib/passwordPolicy.ts`, checked in the browser and again on the server): at least
12 characters, at most 72 bytes, three of lowercase/uppercase/digits/symbols unless 20+ characters,
must not contain the username.

---

## Setup — do these in order

> ⚠️ **Deploy only after steps 1–5.** Once this code is live, NotifyEm shows the sign-in page first;
> without the database tables and the admin account, nobody can get in.

### 1. Vercel environment variables (Settings → Environment Variables)

| Variable | Notes |
|---|---|
| `SUPABASE_URL` | Already set. |
| `SUPABASE_SERVICE_ROLE_KEY` | Already set. Must be **Sensitive**. Server-only. |
| `SUPABASE_ANON_KEY` | Supabase → Project Settings → API → `anon` / publishable key. Public by design; grants nothing without a signed-in user. The existing `VITE_SUPABASE_ANON_KEY` is also accepted. |
| `APP_ORIGINS` | Optional: extra allowed origins for the CSRF check, comma separated. |

Do **not** put `BOOTSTRAP_ADMIN_PASSWORD` in Vercel; the bootstrap runs from your computer.

### 2. Supabase → Authentication settings

1. **Sign In / Providers → Email:** turn **off** "Allow new users to sign up" (invitation only).
2. **URL Configuration:** set **Site URL** to your production URL (e.g. `https://notifyem.vercel.app`)
   and add these **Redirect URLs**:
   - `https://<your-domain>/accept-invite`
   - `https://<your-domain>/reset-password`
   - `http://localhost:3000/**` (local development)
3. **Email Templates.** NotifyEm verifies email links on the server, so the links must carry a token
   hash instead of Supabase's default redirect link:
   - **Invite user** — replace the link with
     `<a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=invite">Accept your NotifyEm invitation</a>`
   - **Reset password** — replace the link with
     `<a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery">Choose a new password</a>`
4. **Email delivery:** Supabase's built-in sender is limited to a few emails per hour and is meant for
   testing. Invitations and resets work with it at low volume. For real use, connect an SMTP provider
   under **Authentication → Emails → SMTP Settings** (not chosen yet).

### 3. Run the schema migration

In the Supabase SQL editor run **`supabase/0008_auth_foundation.sql`**. Safe to re-run; deletes nothing.

### 4. Create the initial admin (UID 001, username Manny) — one time

1. In `.env.local` (git-ignored; never commit it), add the database values if not already there and
   the two bootstrap values:

   ```
   SUPABASE_URL=...
   SUPABASE_SERVICE_ROLE_KEY=...
   BOOTSTRAP_ADMIN_EMAIL=<Manny's real email>
   BOOTSTRAP_ADMIN_PASSWORD=<a temporary password, 12+ characters>
   ```

   Generate the temporary password with a password manager. Share it with Manny only through a secure
   channel (in person or a password manager share), never by plain email or chat.

2. Run:

   ```
   npm run bootstrap:admin
   ```

   It prints only the outcome, never the password. It is **idempotent**: if admin 001 already exists
   it changes nothing and does not reset the password. If a previous run stopped half-way, it links the
   existing Supabase Auth user without changing that user's password.

3. **Disable bootstrap access:** delete `BOOTSTRAP_ADMIN_PASSWORD` from `.env.local` right away. The
   script only runs from a machine that has the service-role key; nothing is deployed for it.

4. Manny signs in with `Manny` + the temporary password and **must choose a new password** before
   NotifyEm opens.

**Rotating / recovering the admin password later:** use "Forgot password?" on the sign-in page (needs
email delivery), or in Supabase → Authentication → Users → the user → "Send password recovery".
Re-running the bootstrap will *not* reset it, by design.

### 5. Assign existing records to the admin

After step 4, review and run **`supabase/0009_assign_existing_records.sql`**. It gives every existing
lead, collection, campaign and Salesforce sync record that has no owner to admin `001`, then makes
`owner_id` required. Only rows without an owner are touched; nothing is deleted.

### 6. Deploy

Commit and push. Then open the site: you should see the NotifyEm sign-in page.

---

## Tests

`npm test` covers, with Supabase replaced by an in-memory fake:

- cookies, CSRF origin check, session refresh, role enforcement, deactivation, forced password change
- login success / wrong password / unknown username (same message), rate limiting, cross-site posts
- change password, logout, password reset request (no account enumeration), reset & invite links
  (valid, reused, invalid), invitations (admin only, duplicate username, rollback on failure)
- bootstrap: creates 001/Manny/admin, idempotent second run, interrupted-run recovery, no password in
  the audit log
- audit-log redaction and rate-limit key hashing

### Not covered automatically

Row-level security (one user cannot read another's rows) can only be proven against a real database.
No separate test database exists yet, so Phase 6 will add a manual verification checklist for the live
project. The SQL migrations have not yet been executed by the developer; run them in the order above
and report any error message.
