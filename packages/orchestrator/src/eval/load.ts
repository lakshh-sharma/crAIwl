/**
 * Filesystem loader for eval fixtures.
 *
 * Fixture layout on disk:
 *
 *   fixtures/
 *     pricing/
 *       config.json     — exported StrategyConfig (env wrapper or raw)
 *       pages.json      — [{ sourceUrl, htmlFile, expected: [...] }, ...]
 *       page-a.html
 *       page-b.html
 *
 * `htmlFile` is resolved relative to the fixture directory. `config.json`
 * is parsed through importConfig so the same envelope the CLI emits is
 * accepted verbatim.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { parseStrategyConfig, type StrategyConfig } from '@craiwl/core';
import { importConfig } from '../output/config-io.js';
import type { EvalFixture, FixturePage } from './types.js';

type PagesManifestEntry = {
  sourceUrl: string;
  htmlFile: string;
  expected: FixturePage['expected'];
};

export async function loadFixtures(rootDir: string): Promise<EvalFixture[]> {
  const entries = await readdir(rootDir);
  const out: EvalFixture[] = [];
  for (const name of entries.sort()) {
    const dir = join(rootDir, name);
    const s = await safeStat(dir);
    if (!s?.isDirectory()) continue;
    const fx = await loadFixture(name, dir);
    if (fx) out.push(fx);
  }
  return out;
}

export async function loadFixture(name: string, dir: string): Promise<EvalFixture | null> {
  const configRaw = await readOptional(join(dir, 'config.json'));
  const pagesRaw = await readOptional(join(dir, 'pages.json'));
  if (!configRaw || !pagesRaw) return null;

  // Accept both an exported envelope (importConfig) and a raw config.
  // The CLI's `compile -o` writes envelopes; hand-edited fixtures often
  // skip the wrapper.
  let config: StrategyConfig;
  try {
    config = importConfig(configRaw);
  } catch {
    config = parseStrategyConfig(JSON.parse(configRaw));
  }

  const manifest = JSON.parse(pagesRaw) as PagesManifestEntry[];
  const pages: FixturePage[] = [];
  for (const entry of manifest) {
    const html = await readFile(join(dir, entry.htmlFile), 'utf8');
    pages.push({ sourceUrl: entry.sourceUrl, html, expected: entry.expected });
  }
  return { name, config, pages };
}

async function safeStat(path: string) {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}
