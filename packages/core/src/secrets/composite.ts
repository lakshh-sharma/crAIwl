/**
 * Composite secrets provider — tries multiple sources in order.
 *
 * Default install:
 *   1. EnvSecretsProvider   — `CRAWL_SECRET_*` env vars beat file entries.
 *   2. FileSecretsProvider  — fallback to the local store.
 *
 * The env-var precedence matters: shell `export` or CI secrets always
 * win over the on-disk file, so a misconfigured machine can be corrected
 * by setting the env var without having to rewrite secrets.json.
 *
 * Writes target the first writable provider in the chain — typically the
 * file provider. Providers that throw `SecretsReadOnlyError` are skipped.
 */

import { SecretsReadOnlyError, type SecretsProvider } from './types.js';

export class CompositeSecretsProvider implements SecretsProvider {
  readonly label: string;
  private readonly providers: readonly SecretsProvider[];

  constructor(providers: readonly SecretsProvider[]) {
    if (providers.length === 0) {
      throw new Error('CompositeSecretsProvider needs at least one provider');
    }
    this.providers = providers;
    this.label = `composite(${providers.map((p) => p.label).join(', ')})`;
  }

  async get(name: string): Promise<string | undefined> {
    for (const p of this.providers) {
      const v = await p.get(name);
      if (v !== undefined) return v;
    }
    return undefined;
  }

  async set(name: string, value: string): Promise<void> {
    for (const p of this.providers) {
      try {
        await p.set(name, value);
        return;
      } catch (err) {
        if (err instanceof SecretsReadOnlyError) continue;
        throw err;
      }
    }
    throw new Error('CompositeSecretsProvider: no writable provider in the chain');
  }

  async list(): Promise<string[]> {
    const all = new Set<string>();
    for (const p of this.providers) {
      for (const n of await p.list()) all.add(n);
    }
    return Array.from(all).sort();
  }

  async remove(name: string): Promise<boolean> {
    let removed = false;
    for (const p of this.providers) {
      try {
        if (await p.remove(name)) removed = true;
      } catch (err) {
        if (err instanceof SecretsReadOnlyError) continue;
        throw err;
      }
    }
    return removed;
  }
}
