/**
 * Environment-variable-backed secrets provider.
 *
 * Lookups are normalized: a logical name like `github-token` resolves to
 * the env var `CRAWL_SECRET_GITHUB_TOKEN`. This keeps secret names
 * portable across providers — the same logical name works with the env
 * provider in CI, the file provider on a dev machine, and a future
 * vault-backed provider in production without renaming references in
 * a StrategyConfig.
 */

import { SecretsReadOnlyError, type SecretsProvider } from './types.js';

const DEFAULT_PREFIX = 'CRAWL_SECRET_';

export type EnvSecretsProviderOptions = {
  prefix?: string;
  /** Inject a custom env source (test seam). Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
};

export class EnvSecretsProvider implements SecretsProvider {
  readonly label = 'env';
  private readonly prefix: string;
  private readonly env: NodeJS.ProcessEnv;

  constructor(opts: EnvSecretsProviderOptions = {}) {
    this.prefix = opts.prefix ?? DEFAULT_PREFIX;
    this.env = opts.env ?? process.env;
  }

  async get(name: string): Promise<string | undefined> {
    return this.env[this.toEnvKey(name)];
  }

  async set(): Promise<void> {
    throw new SecretsReadOnlyError(this.label);
  }

  async list(): Promise<string[]> {
    const out: string[] = [];
    for (const key of Object.keys(this.env)) {
      if (key.startsWith(this.prefix)) out.push(this.fromEnvKey(key));
    }
    return out.sort();
  }

  async remove(): Promise<boolean> {
    throw new SecretsReadOnlyError(this.label);
  }

  private toEnvKey(name: string): string {
    return `${this.prefix}${name.toUpperCase().replace(/[-\s]/g, '_')}`;
  }

  private fromEnvKey(key: string): string {
    return key.slice(this.prefix.length).toLowerCase().replace(/_/g, '-');
  }
}
