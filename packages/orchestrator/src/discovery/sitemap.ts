/**
 * Sitemap discovery + parsing.
 *
 * Sitemaps are the cheapest, most reliable URL source for a crawl. We seed
 * from robots.txt (if available) plus the conventional `/sitemap.xml`, then
 * follow `<sitemapindex>` chains up to a bounded depth, decoding `.gz`
 * payloads in-process. URLs are deduplicated by a lightweight canonical
 * form — full canonicalization (CRAWL-076) happens later in the pipeline.
 *
 * This module deliberately uses `undici.request` directly rather than the
 * shared `Fetcher` abstraction because gzip sitemaps arrive as binary and
 * `FetchResult.body` is `string`. The trade-off is intentional: sitemap
 * discovery does not need tier escalation.
 */

import { gunzipSync } from 'node:zlib';
import { fetch as undiciFetch } from 'undici';
import { XMLParser } from 'fast-xml-parser';
import type { RobotsRules } from '@craiwl/fetcher';

export type SitemapUrl = {
  loc: string;
  lastmod?: string;
};

export type SitemapDiscoveryResult = {
  urls: SitemapUrl[];
  /** Sitemap files actually fetched + parsed (URL strings). */
  visited: string[];
  /** Sitemap files we tried and dropped, plus the reason. */
  skipped: Array<{ url: string; reason: string }>;
};

/** Injectable fetcher (test seam). Returns raw bytes so we can gunzip. */
export type SitemapFetch = (url: string) => Promise<{ status: number; body: Buffer }>;

export type DiscoverSitemapsOptions = {
  /** Robots rules for the origin. When present, `robots.sitemaps` is used as the seed set. */
  robots?: RobotsRules;
  /** Max recursion depth for sitemap-index chains. Default 3. */
  maxDepth?: number;
  /** Hard cap on URLs collected (prevents pathological indexes). Default 50000. */
  maxUrls?: number;
  /** Per-request timeout for the default fetcher. Default 30s. */
  timeoutMs?: number;
  /** User-Agent for the default fetcher. */
  userAgent?: string;
  /** Override the HTTP fetcher (used in tests). */
  fetchImpl?: SitemapFetch;
};

const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_MAX_URLS = 50_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_UA = 'craiwl/0.1 (+sitemap-discovery)';

// `isArray` forces fast-xml-parser to return arrays even when a single child is present,
// so downstream code does not need to special-case the 1-element shape.
const xmlParser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => name === 'url' || name === 'sitemap',
});

export async function discoverSitemaps(
  origin: string,
  opts: DiscoverSitemapsOptions = {},
): Promise<SitemapDiscoveryResult> {
  const fetchImpl = opts.fetchImpl ?? defaultSitemapFetch(opts.timeoutMs, opts.userAgent);
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxUrls = opts.maxUrls ?? DEFAULT_MAX_URLS;
  const baseOrigin = new URL(origin).origin;

  const seeds: string[] = [];
  if (opts.robots) {
    for (const s of opts.robots.sitemaps) if (s && !seeds.includes(s)) seeds.push(s);
  }
  const conventional = `${baseOrigin}/sitemap.xml`;
  if (!seeds.includes(conventional)) seeds.push(conventional);

  const seen = new Set<string>();
  const visited: string[] = [];
  const skipped: Array<{ url: string; reason: string }> = [];
  const urls = new Map<string, SitemapUrl>();

  const queue: Array<{ url: string; depth: number }> = seeds.map((url) => ({ url, depth: 0 }));

  while (queue.length > 0 && urls.size < maxUrls) {
    const next = queue.shift()!;
    const { url, depth } = next;
    if (seen.has(url)) continue;
    seen.add(url);

    if (depth > maxDepth) {
      skipped.push({ url, reason: 'max-depth-exceeded' });
      continue;
    }

    let res: { status: number; body: Buffer };
    try {
      res = await fetchImpl(url);
    } catch (err) {
      skipped.push({ url, reason: `fetch-error: ${(err as Error).message}` });
      continue;
    }
    if (res.status >= 400 || res.status === 0) {
      skipped.push({ url, reason: `status-${res.status}` });
      continue;
    }

    const text = decodeBody(url, res.body);
    if (text === null) {
      skipped.push({ url, reason: 'decode-error' });
      continue;
    }

    let parsed: unknown;
    try {
      parsed = xmlParser.parse(text);
    } catch (err) {
      skipped.push({ url, reason: `parse-error: ${(err as Error).message}` });
      continue;
    }
    visited.push(url);

    const root = parsed as {
      sitemapindex?: { sitemap?: Array<{ loc?: unknown }> };
      urlset?: { url?: Array<{ loc?: unknown; lastmod?: unknown }> };
    };

    if (root.sitemapindex?.sitemap) {
      for (const sm of root.sitemapindex.sitemap) {
        const loc = typeof sm.loc === 'string' ? sm.loc.trim() : null;
        if (loc) queue.push({ url: loc, depth: depth + 1 });
      }
      continue;
    }

    if (root.urlset?.url) {
      for (const item of root.urlset.url) {
        if (urls.size >= maxUrls) break;
        const loc = typeof item.loc === 'string' ? item.loc.trim() : null;
        if (!loc) continue;
        const canonical = canonicalize(loc);
        if (!canonical) continue;
        if (urls.has(canonical)) continue;
        const lastmod = typeof item.lastmod === 'string' ? item.lastmod.trim() : '';
        urls.set(canonical, lastmod ? { loc: canonical, lastmod } : { loc: canonical });
      }
      continue;
    }

    skipped.push({ url, reason: 'not-a-sitemap' });
  }

  return { urls: Array.from(urls.values()), visited, skipped };
}

function decodeBody(url: string, body: Buffer): string | null {
  try {
    const looksGzip = body.length >= 2 && body[0] === 0x1f && body[1] === 0x8b;
    if (url.endsWith('.gz') || looksGzip) {
      return gunzipSync(body).toString('utf8');
    }
    return body.toString('utf8');
  } catch {
    return null;
  }
}

function canonicalize(loc: string): string | null {
  try {
    const u = new URL(loc);
    u.hash = '';
    u.hostname = u.hostname.toLowerCase();
    return u.toString();
  } catch {
    return null;
  }
}

function defaultSitemapFetch(timeoutMs?: number, userAgent?: string): SitemapFetch {
  return async (url: string) => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      const res = await undiciFetch(url, {
        method: 'GET',
        headers: {
          'user-agent': userAgent ?? DEFAULT_UA,
          accept: 'application/xml, text/xml, */*;q=0.8',
        },
        signal: ac.signal,
        redirect: 'follow',
      });
      const body = Buffer.from(await res.arrayBuffer());
      return { status: res.status, body };
    } finally {
      clearTimeout(timer);
    }
  };
}
