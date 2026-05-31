import { describe, expect, it } from 'vitest';
import { EnvSecretsProvider } from './env.js';
import { SecretsReadOnlyError } from './types.js';

describe('EnvSecretsProvider', () => {
  it('resolves logical names to CRAWL_SECRET_<NAME> env vars', async () => {
    const provider = new EnvSecretsProvider({
      env: { CRAWL_SECRET_GITHUB_TOKEN: 'ghp_abc' },
    });
    expect(await provider.get('github-token')).toBe('ghp_abc');
  });

  it('returns undefined for missing names', async () => {
    const provider = new EnvSecretsProvider({ env: {} });
    expect(await provider.get('missing')).toBeUndefined();
  });

  it('lists every secret with the configured prefix (no values)', async () => {
    const provider = new EnvSecretsProvider({
      env: {
        CRAWL_SECRET_GITHUB_TOKEN: 'x',
        CRAWL_SECRET_STRIPE_KEY: 'y',
        UNRELATED: 'z',
      },
    });
    expect(await provider.list()).toEqual(['github-token', 'stripe-key']);
  });

  it('rejects writes with SecretsReadOnlyError', async () => {
    const provider = new EnvSecretsProvider({ env: {} });
    await expect(provider.set('x', 'y')).rejects.toBeInstanceOf(SecretsReadOnlyError);
    await expect(provider.remove('x')).rejects.toBeInstanceOf(SecretsReadOnlyError);
  });

  it('honors a custom prefix', async () => {
    const provider = new EnvSecretsProvider({
      prefix: 'MYAPP_',
      env: { MYAPP_TOKEN: 'value' },
    });
    expect(await provider.get('token')).toBe('value');
  });
});
