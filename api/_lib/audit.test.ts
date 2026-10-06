import { describe, expect, it } from 'vitest';
import { sanitizeMetadata } from './audit.js';
import { bucketKey, RATE_LIMITS } from './rateLimit.js';

describe('audit metadata sanitizing', () => {
  it('drops credential-like keys at any depth', () => {
    const cleaned = sanitizeMetadata({
      username: 'Manny',
      password: 'hunter2',
      newPassword: 'x',
      apiKey: 'rt_123',
      api_key: 'rt_456',
      nested: { access_token: 'jwt', refreshToken: 'rt', provider: 'resend', Authorization: 'Bearer x' },
      list: [{ secret: 's', ok: 1 }]
    });
    expect(cleaned).toEqual({ username: 'Manny', nested: { provider: 'resend' }, list: [{ ok: 1 }] });
    expect(JSON.stringify(cleaned)).not.toMatch(/hunter2|rt_123|rt_456|jwt|Bearer/);
  });

  it('truncates long strings', () => {
    const cleaned = sanitizeMetadata({ note: 'a'.repeat(1000) }) as { note: string };
    expect(cleaned.note.length).toBeLessThan(310);
  });
});

describe('rate-limit buckets', () => {
  it('hashes the subject so usernames and IPs are not stored in clear text', async () => {
    const key = await bucketKey(RATE_LIMITS.loginPerUsername, 'Manny');
    expect(key).toMatch(/^login:user:[0-9a-f]{64}$/);
    expect(key).not.toContain('Manny');
  });

  it('is case-insensitive for the same username', async () => {
    expect(await bucketKey(RATE_LIMITS.loginPerUsername, 'Manny')).toBe(await bucketKey(RATE_LIMITS.loginPerUsername, ' manny '));
  });

  it('keeps different limits in separate buckets', async () => {
    expect(await bucketKey(RATE_LIMITS.loginPerIp, '1.2.3.4')).not.toBe(await bucketKey(RATE_LIMITS.resetPerIp, '1.2.3.4'));
  });
});
