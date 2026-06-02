import { describe, expect, it } from 'vitest';
import { InMemoryAuditLog } from './log.js';
import { auditedProvider } from './provider-wrap.js';
import type { SecretsProvider } from '../secrets/types.js';

const FIXED_NOW = () => new Date('2026-06-02T00:00:00.000Z');

const fake = (data: Record<string, string>, label = 'fake'): SecretsProvider => ({
  label,
  get: async (n) => data[n],
  set: async () => {},
  list: async () => Object.keys(data),
  remove: async () => false,
});

describe('auditedProvider', () => {
  it('records a secret-accessed event on a successful get', async () => {
    const audit = new InMemoryAuditLog();
    const wrapped = auditedProvider(fake({ token: 'tk' }), {
      audit,
      reason: 'resolve-auth',
      now: FIXED_NOW,
    });
    const value = await wrapped.get('token');
    expect(value).toBe('tk');
    expect(audit.events()).toHaveLength(1);
    const e = audit.events()[0]!;
    expect(e.kind).toBe('secret-accessed');
    if (e.kind === 'secret-accessed') {
      expect(e.secretName).toBe('token');
      expect(e.providerLabel).toBe('fake');
      expect(e.reason).toBe('resolve-auth');
    }
  });

  it('does NOT record an event when the secret is missing', async () => {
    const audit = new InMemoryAuditLog();
    const wrapped = auditedProvider(fake({}), { audit, reason: 'resolve-auth' });
    const value = await wrapped.get('absent');
    expect(value).toBeUndefined();
    expect(audit.events()).toHaveLength(0);
  });

  it('passes label / list / set / remove through unchanged', async () => {
    const audit = new InMemoryAuditLog();
    const inner = fake({ a: '1' }, 'inner-label');
    const wrapped = auditedProvider(inner, { audit, reason: 'manual-lookup' });
    expect(wrapped.label).toBe('inner-label');
    expect(await wrapped.list()).toEqual(['a']);
    await wrapped.set('b', '2'); // no-op in fake — just shouldn't throw
    expect(await wrapped.remove('a')).toBe(false);
    // Only the implicit `get` would have audited, and we didn't call one.
    expect(audit.events()).toHaveLength(0);
  });
});
