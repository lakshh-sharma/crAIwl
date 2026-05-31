import { describe, expect, it } from 'vitest';
import { resolveAuthHeaders, redactAuthHeaders } from './auth.js';
import { SecretNotFoundError, type SecretsProvider } from './types.js';

const fakeProvider = (data: Record<string, string>): SecretsProvider => ({
  label: 'test',
  get: async (n) => data[n],
  set: async () => {},
  list: async () => Object.keys(data),
  remove: async () => false,
});

describe('resolveAuthHeaders', () => {
  it('produces a simple api-key header', async () => {
    const headers = await resolveAuthHeaders(
      { type: 'api-key', header: 'X-API-Key', valueTemplate: '{secret}', secret: 'github-token' },
      fakeProvider({ 'github-token': 'ghp_abc' }),
    );
    expect(headers).toEqual({ 'X-API-Key': 'ghp_abc' });
  });

  it('honors a value template (e.g. for "Token <value>" prefixes)', async () => {
    const headers = await resolveAuthHeaders(
      {
        type: 'api-key',
        header: 'Authorization',
        valueTemplate: 'Token {secret}',
        secret: 'my-token',
      },
      fakeProvider({ 'my-token': 'tkn_xyz' }),
    );
    expect(headers).toEqual({ Authorization: 'Token tkn_xyz' });
  });

  it('emits an Authorization: Bearer ... header for bearer', async () => {
    const headers = await resolveAuthHeaders(
      { type: 'bearer', secret: 'oauth' },
      fakeProvider({ oauth: 'eyJhbGc...' }),
    );
    expect(headers).toEqual({ Authorization: 'Bearer eyJhbGc...' });
  });

  it('emits a base64-encoded Authorization: Basic ... header for basic', async () => {
    const headers = await resolveAuthHeaders(
      { type: 'basic', username: 'alice', secret: 'pw' },
      fakeProvider({ pw: 'secret-password' }),
    );
    expect(headers).toEqual({
      Authorization: `Basic ${Buffer.from('alice:secret-password').toString('base64')}`,
    });
  });

  it('throws SecretNotFoundError when the secret is missing', async () => {
    await expect(
      resolveAuthHeaders({ type: 'bearer', secret: 'missing' }, fakeProvider({})),
    ).rejects.toBeInstanceOf(SecretNotFoundError);
  });
});

describe('redactAuthHeaders', () => {
  it('redacts Authorization while preserving the scheme prefix', () => {
    expect(redactAuthHeaders({ Authorization: 'Bearer eyJhbGc...' })).toEqual({
      Authorization: 'Bearer ***',
    });
  });

  it('redacts X-API-Key style headers fully', () => {
    expect(redactAuthHeaders({ 'X-API-Key': 'secret-token' })).toEqual({
      'X-API-Key': '***',
    });
  });

  it('passes non-credential headers through unchanged', () => {
    expect(redactAuthHeaders({ Accept: 'text/html', 'User-Agent': 'craiwl' })).toEqual({
      Accept: 'text/html',
      'User-Agent': 'craiwl',
    });
  });

  it('redacts Cookie headers and *-Token / *-Key suffixes', () => {
    const r = redactAuthHeaders({
      Cookie: 'session=abc',
      'X-Auth-Token': 'abc',
      'X-Service-Key': 'def',
    });
    expect(r.Cookie).toBe('***');
    expect(r['X-Auth-Token']).toBe('***');
    expect(r['X-Service-Key']).toBe('***');
  });
});
