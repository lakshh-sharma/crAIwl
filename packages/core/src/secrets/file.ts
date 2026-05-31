/**
 * Local file-backed secrets provider.
 *
 * One JSON file, 0o600 permissions, mirroring how `~/.aws/credentials`
 * and `~/.npmrc` behave. Not encrypted at rest — users who want that
 * either set an OS-level encrypted filesystem (FileVault, LUKS) or
 * stick to the env-var provider with credentials piped from a vault.
 *
 * The file is created lazily on the first `set` and the parent dir
 * is mkdir-p'd. Reads tolerate a missing file (returns empty) so the
 * provider works out of the box on a fresh machine.
 */

import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { SecretsProvider } from './types.js';

export type FileSecretsProviderOptions = {
  /** Path to the secrets file. Defaults to `~/.craiwl/secrets.json`. */
  path?: string;
};

const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

export class FileSecretsProvider implements SecretsProvider {
  readonly label: string;
  readonly path: string;

  constructor(opts: FileSecretsProviderOptions = {}) {
    this.path = opts.path ?? join(homedir(), '.craiwl', 'secrets.json');
    this.label = `file:${this.path}`;
  }

  async get(name: string): Promise<string | undefined> {
    const data = await this.read();
    return data[name];
  }

  async set(name: string, value: string): Promise<void> {
    const data = await this.read();
    data[name] = value;
    await this.write(data);
  }

  async list(): Promise<string[]> {
    const data = await this.read();
    return Object.keys(data).sort();
  }

  async remove(name: string): Promise<boolean> {
    const data = await this.read();
    if (!(name in data)) return false;
    delete data[name];
    await this.write(data);
    return true;
  }

  private async read(): Promise<Record<string, string>> {
    let raw: string;
    try {
      raw = await readFile(this.path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw err;
    }
    // Corrupt JSON is tolerated as empty — a single mis-edit of the secrets
    // file shouldn't bring down the CLI. The next `set` will rewrite it.
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {};
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  }

  private async write(data: Record<string, string>): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: DIR_MODE });
    await writeFile(this.path, `${JSON.stringify(data, null, 2)}\n`, {
      encoding: 'utf8',
      mode: FILE_MODE,
    });
    // writeFile only honors `mode` on file creation; chmod the existing file too
    // so re-saves don't leave a previously-permissive file untouched.
    await chmod(this.path, FILE_MODE);
  }
}
