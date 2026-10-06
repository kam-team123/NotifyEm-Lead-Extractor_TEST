import { beforeEach, describe, expect, it } from 'vitest';
import { BootstrapError, bootstrapAdmin } from '../scripts/lib/bootstrapAdmin';
import { createFakeSupabase } from './fakeSupabase';

const sb = createFakeSupabase();
const EMAIL = 'admin@example.com';
const TEMP = 'Temporary-Pass-123';

beforeEach(() => sb.reset());

describe('initial admin bootstrap', () => {
  it('creates UID 001 / Manny / admin with a forced password change', async () => {
    const result = await bootstrapAdmin(sb.service, { email: EMAIL, password: TEMP });
    expect(result.status).toBe('created');
    expect(sb.tables.app_users).toHaveLength(1);
    expect(sb.tables.app_users[0]).toMatchObject({ public_uid: '001', username: 'Manny', role: 'admin', must_change_password: true, login_email: EMAIL });
    expect(sb.tables.audit_events.at(-1)).toMatchObject({ action: 'bootstrap.admin', outcome: 'success' });
  });

  it('is idempotent: a second run changes nothing and never resets the password', async () => {
    await bootstrapAdmin(sb.service, { email: EMAIL, password: TEMP });
    const second = await bootstrapAdmin(sb.service, { email: EMAIL, password: 'A-Different-Pass-999' });
    expect(second.status).toBe('already_exists');
    expect(sb.calls.createUser).toBe(1);
    expect(sb.calls.updateUserById).toHaveLength(0);
    expect(sb.tables.app_users).toHaveLength(1);
    expect(sb.authUsers[0].password).toBe(TEMP);
  });

  it('links an auth user left by an interrupted run without touching its password', async () => {
    sb.addAuthUser(EMAIL, 'Whatever-They-Set-1');
    const result = await bootstrapAdmin(sb.service, { email: EMAIL, password: '' });
    expect(result.status).toBe('linked_existing_auth_user');
    expect(sb.calls.createUser).toBe(0);
    expect(sb.authUsers[0].password).toBe('Whatever-They-Set-1');
  });

  it('refuses a missing email or a short temporary password', async () => {
    await expect(bootstrapAdmin(sb.service, { email: '', password: TEMP })).rejects.toBeInstanceOf(BootstrapError);
    await expect(bootstrapAdmin(sb.service, { email: EMAIL, password: 'short' })).rejects.toThrow(/at least 12/);
    expect(sb.calls.createUser).toBe(0);
  });

  it('removes the new auth user again if the profile insert fails', async () => {
    sb.failInsertOn.add('app_users');
    await expect(bootstrapAdmin(sb.service, { email: EMAIL, password: TEMP })).rejects.toThrow(/removed again/);
    expect(sb.authUsers).toHaveLength(0);
  });

  it('never writes the password into the audit log', async () => {
    await bootstrapAdmin(sb.service, { email: EMAIL, password: TEMP });
    expect(JSON.stringify(sb.tables.audit_events)).not.toContain(TEMP);
  });
});
