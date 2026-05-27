/**
 * End-to-end discovery: sitemap → path probing → homepage nav, deduped and
 * source-attributed. The orchestrator hands the candidate set to the human
 * for confirmation before a crawl starts (CRAWL-052) — discovery never
 * commits the system to crawling anything on its own.
 */

import type { Fetcher, RobotsCache } from '@craiwl/fetcher';
import { discoverSitemaps, type SitemapFetch } from './sitemap.js';
import { probeDocPaths } from './probe.js';
import { extractNavLinks } from './nav.js';

export type DiscoverySource = 'sitemap' | 'probe' | 'nav';

export type CandidateUrl = {
  url: string;
  source: DiscoverySource;
  lastmod?: string;
  navText?: string;
  navScore?: number;
};

export type DiscoveryResult = {
  candidates: CandidateUrl[];
  sitemap: { visited: string[]; skipped: Array<{ url: string; reason: string }> };
  probes: Array<{ url: string; path: string; status: number; resolved: boolean }>;
  nav: Array<{ url: string; text: string; score: number }>;
};

export type DiscoveryOptions = {
  /** Fetcher for path probing + the homepage. Tier 0 is fine. */
  fetcher: Fetcher;
  /** Robots cache so we reuse the parsed robots.txt for both allowed checks and sitemap seeds. */
  robotsCache?: RobotsCache;
  /** Override the sitemap fetcher (for tests). */
  sitemapFetch?: SitemapFetch;
  /** Drop nav links scoring below this threshold. Default 0.3. */
  navMinScore?: number;
};

export async function discover(entryUrl: string, opts: DiscoveryOptions): Promise<DiscoveryResult> {
  const origin = new URL(entryUrl).origin;
  const navMinScore = opts.navMinScore ?? 0.3;

  const robots = opts.robotsCache ? await opts.robotsCache.getForOrigin(origin) : undefined;

  const [sitemapRes, probes, navRes] = await Promise.all([
    discoverSitemaps(origin, {
      ...(robots ? { robots } : {}),
      ...(opts.sitemapFetch ? { fetchImpl: opts.sitemapFetch } : {}),
    }),
    probeDocPaths(origin, { fetcher: opts.fetcher }),
    fetchHomepage(opts.fetcher, origin),
  ]);

  const navLinks = navRes ? extractNavLinks(navRes.body, navRes.finalUrl) : [];

  const candidates = new Map<string, CandidateUrl>();

  for (const u of sitemapRes.urls) {
    const key = canonicalKey(u.loc);
    candidates.set(
      key,
      u.lastmod
        ? { url: u.loc, source: 'sitemap', lastmod: u.lastmod }
        : { url: u.loc, source: 'sitemap' },
    );
  }
  for (const p of probes) {
    if (!p.resolved) continue;
    const key = canonicalKey(p.url);
    if (candidates.has(key)) continue;
    candidates.set(key, { url: p.url, source: 'probe' });
  }
  for (const l of navLinks) {
    if (l.score < navMinScore) continue;
    if (new URL(l.href).origin !== origin) continue; // stay on-origin; cross-origin nav is noise
    const key = canonicalKey(l.href);
    if (candidates.has(key)) continue;
    candidates.set(key, { url: l.href, source: 'nav', navText: l.text, navScore: l.score });
  }

  return {
    candidates: Array.from(candidates.values()),
    sitemap: { visited: sitemapRes.visited, skipped: sitemapRes.skipped },
    probes: probes.map((p) => ({
      url: p.url,
      path: p.path,
      status: p.status,
      resolved: p.resolved,
    })),
    nav: navLinks.map((l) => ({ url: l.href, text: l.text, score: l.score })),
  };
}

async function fetchHomepage(
  fetcher: Fetcher,
  origin: string,
): Promise<{ body: string; finalUrl: string } | null> {
  try {
    const res = await fetcher.fetch(`${origin}/`);
    if (res.status < 200 || res.status >= 300) return null;
    return { body: res.body, finalUrl: res.finalUrl || `${origin}/` };
  } catch {
    return null;
  }
}

function canonicalKey(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    u.hostname = u.hostname.toLowerCase();
    // Drop a trailing slash on non-root paths so /docs and /docs/ collapse.
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1);
    return u.toString();
  } catch {
    return url;
  }
}
