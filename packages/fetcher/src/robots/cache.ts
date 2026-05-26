import type { Fetcher } from '../types.js';
import { getCrawlDelay, isAllowed, parseRobotsTxt, type RobotsRules } from './parse.js';

export type RobotsCacheOptions = {
  /** Fetcher used to retrieve `/robots.txt` from each host. Tier 0 is fine. */
  fetcher: Fetcher;
  /** TTL for a cached robots file. Default 24 hours. */
  ttlMs?: number;
};

type Entry = {
  rules: RobotsRules;
  expiresAt: number;
};

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1_000;

/**
 * Per-host cache for robots.txt. The first call to `getForOrigin` (or
 * `isAllowed`/`getCrawlDelay`) for a host fetches `/robots.txt` once and
 * caches the parsed rules until the TTL expires. On fetch failure or 4xx
 * status, the cache stores a permissive "allow all" placeholder so we
 * don't refetch every request — the file simply doesn't exist.
 */
export class RobotsCache {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly opts: RobotsCacheOptions) {}

  async getForOrigin(origin: string): Promise<RobotsRules> {
    const key = normalizeOrigin(origin);
    const cached = this.entries.get(key);
    const now = Date.now();
    if (cached && cached.expiresAt > now) return cached.rules;

    const rules = await this.fetchOne(key);
    this.entries.set(key, {
      rules,
      expiresAt: now + (this.opts.ttlMs ?? DEFAULT_TTL_MS),
    });
    return rules;
  }

  async isAllowed(url: string, userAgent: string): Promise<boolean> {
    const { origin, pathAndQuery } = splitUrl(url);
    const rules = await this.getForOrigin(origin);
    return isAllowed(rules, pathAndQuery, userAgent);
  }

  async getCrawlDelay(url: string, userAgent: string): Promise<number | undefined> {
    const { origin } = splitUrl(url);
    const rules = await this.getForOrigin(origin);
    return getCrawlDelay(rules, userAgent);
  }

  /** Clears the cache. Mostly useful for tests. */
  clear(): void {
    this.entries.clear();
  }

  private async fetchOne(origin: string): Promise<RobotsRules> {
    try {
      const res = await this.opts.fetcher.fetch(`${origin}/robots.txt`, { maxRetries: 1 });
      if (res.status >= 200 && res.status < 300) return parseRobotsTxt(res.body);
      // 404 / 410 — no robots file. Per spec, default is "allow all."
      return parseRobotsTxt('');
    } catch {
      // Network failure — same fallback. Caller logs through the fetcher.
      return parseRobotsTxt('');
    }
  }
}

function normalizeOrigin(origin: string): string {
  try {
    const u = new URL(origin);
    return `${u.protocol}//${u.host}`;
  } catch {
    return origin.replace(/\/+$/, '');
  }
}

function splitUrl(url: string): { origin: string; pathAndQuery: string } {
  const u = new URL(url);
  return {
    origin: `${u.protocol}//${u.host}`,
    pathAndQuery: `${u.pathname}${u.search}`,
  };
}
