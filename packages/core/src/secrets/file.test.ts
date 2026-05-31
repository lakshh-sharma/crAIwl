import { describe, expect, it } from 'vitest';
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSecretsProvider } from './file.js';

async function fresh() {
  const dir = await mkdtemp(join(tmpdir(), 'craiwl-secrets-'));
  return new FileSecretsProvider({ path: join(dir, 'secrets.json') });
}

describe('FileSecretsProvider', () => {
  it('returns undefined for a missing file', async () => {
    const provider = await fresh();
    expect(await provider.get('anything')).toBeUndefined();
    expect(await provider.list()).toEqual([]);
  });

  it('round-trips a secret through set + get', async () => {
    const provider = await fresh();
    await provider.set('api-token', 'tk_123');
    expect(await provider.get('api-token')).toBe('tk_123');
  });

  it('stores values in 0600-mode files (Unix)', async () => {
    const provider = await fresh();
    await provider.set('s', 'v');
    if (process.platform !== 'win32') {
      const s = await stat(provider.path);
      // Only the owner-read/owner-write bits should be set.
      expect(s.mode & 0o777).toBe(0o600);
    }
  });

  it('lists names without exposing values', async () => {
    const provider = await fresh();
    await provider.set('a', 'one');
    await provider.set('b', 'two');
    const names = await provider.list();
    expect(names).toEqual(['a', 'b']);
    for (const n of names) expect(n.includes('one')).toBe(false);
  });

  it('remove returns false for unknown names', async () => {
    const provider = await fresh();
    expect(await provider.remove('nope')).toBe(false);
  });

  it('remove deletes the entry and persists', async () => {
    const provider = await fresh();
    await provider.set('a', 'x');
    await provider.set('b', 'y');
    expect(await provider.remove('a')).toBe(true);
    expect(await provider.get('a')).toBeUndefined();
    expect(await provider.get('b')).toBe('y');
  });

  it('survives a corrupted file by treating it as empty', async () => {
    const provider = await fresh();
    await provider.set('a', 'one');
    // Now write garbage into the file behind the provider's back.
    const { writeFile } = await import('node:fs/promises');
    await writeFile(provider.path, '<<<not json>>>', 'utf8');
    // A subsequent get should not throw — the provider treats unparseable
    // contents as empty rather than crashing the CLI on a corrupt file.
    expect(await provider.get('a')).toBeUndefined();
  });
});
