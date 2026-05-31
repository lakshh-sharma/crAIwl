import { describe, expect, it } from 'vitest';
import { CompositeSecretsProvider } from './composite.js';
import { SecretsReadOnlyError, type SecretsProvider } from './types.js';

const readOnly = (data: Record<string, string>, label = 'env'): SecretsProvider => ({
  label,
  get: async (n) => data[n],
  set: async () => {
    throw new SecretsReadOnlyError(label);
  },
  list: async () => Object.keys(data).sort(),
  remove: async () => {
    throw new SecretsReadOnlyError(label);
  },
});

const memory = (initial: Record<string, string> = {}, label = 'memory'): SecretsProvider => {
  const data = { ...initial };
  return {
    label,
    get: async (n) => data[n],
    set: async (n, v) => {
      data[n] = v;
    },
    list: async () => Object.keys(data).sort(),
    remove: async (n) => {
      if (!(n in data)) return false;
      delete data[n];
      return true;
    },
  };
};

describe('CompositeSecretsProvider', () => {
  it('returns the first provider hit when looking up a name', async () => {
    const env = readOnly({ token: 'from-env' });
    const file = memory({ token: 'from-file' });
    const comp = new CompositeSecretsProvider([env, file]);
    expect(await comp.get('token')).toBe('from-env');
  });

  it('falls through to later providers when earlier ones miss', async () => {
    const env = readOnly({});
    const file = memory({ token: 'from-file' });
    const comp = new CompositeSecretsProvider([env, file]);
    expect(await comp.get('token')).toBe('from-file');
  });

  it('writes target the first writable provider in the chain', async () => {
    const env = readOnly({});
    const file = memory({});
    const comp = new CompositeSecretsProvider([env, file]);
    await comp.set('new', 'value');
    expect(await file.get('new')).toBe('value');
  });

  it('throws when no provider in the chain is writable', async () => {
    const a = readOnly({});
    const b = readOnly({});
    const comp = new CompositeSecretsProvider([a, b]);
    await expect(comp.set('x', 'y')).rejects.toThrow(/no writable provider/);
  });

  it('lists the union of all providers, deduped + sorted', async () => {
    const env = readOnly({ a: '1', b: '2' });
    const file = memory({ b: '3', c: '4' });
    const comp = new CompositeSecretsProvider([env, file]);
    expect(await comp.list()).toEqual(['a', 'b', 'c']);
  });

  it('throws when constructed empty', () => {
    expect(() => new CompositeSecretsProvider([])).toThrow();
  });
});
