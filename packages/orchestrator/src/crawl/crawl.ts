/**
 * Top-level crawl driver.
 *
 * Walks a frontier of URLs against a compiled StrategyConfig. For each URL:
 *   1. Check robots policy.
 *   2. Acquire a politeness slot for the origin (honors crawl-delay).
 *   3. Fetch via the supplied Fetcher.
 *   4. Update politeness state with the response (cooldowns on 429/503).
 *   5. Clean the HTML, execute the config, collect records.
 *   6. Extract on-origin links from the cleaned page and feed them back
 *      into the frontier with depth+1 (subject to scope and the caps).
 *
 * The frontier, politeness gate, and robots checker are all in-memory for
 * v1. The interfaces stay clean enough that a persistent BullMQ-backed
 * frontier is a drop-in replacement later.
 */

import { JSDOM } from 'jsdom';
import { cleanHtml, execute, type ExtractedRecord } from '@craiwl/extractor';
import type { Fetcher, RobotsCache } from '@craiwl/fetcher';
import type { StrategyConfig } from '@craiwl/core';
import { Frontier } from './frontier.js';
import { PolitenessGate, type PolitenessOptions } from './politeness.js';
import { RobotsPolicyChecker, type AuditEvent, type RobotsPolicy } from './robots-policy.js';
import { type CrawlScopeMode } from './canonicalize.js';

export type CrawlSiteOptions = {
  entryUrl: string;
  config: StrategyConfig;
  fetcher: Fetcher;
  robotsCache: RobotsCache;
  userAgent: string;
  /** Default 'section' — same path prefix as entry URL. */
  scope?: CrawlScopeMode;
  /** Hard cap on pages crawled. Default 50. */
  maxPages?: number;
  /** Cap on link-following depth (entry = 0). Default 3. */
  maxDepth?: number;
  /** robots.txt policy. Default 'respect'. */
  robotsPolicy?: RobotsPolicy;
  /** Politeness knobs. */
  politeness?: PolitenessOptions;
  /** Optional seed URLs (e.g. from discovery) added alongside the entry URL. */
  seeds?: string[];
  /** Disable following on-page links — useful when discovery already gave us the full set. */
  followLinks?: boolean;
  /** Progress callback fires after each page is processed. */
  onProgress?: (p: CrawlProgress) => void;
  /** Caller-controlled cancellation. */
  signal?: AbortSignal;
  /** Test seam: clock. */
  now?: () => Date;
};

export type CrawlProgress = {
  pagesDone: number;
  inFrontier: number;
  recordsExtracted: number;
  failures: number;
};

export type CrawlPageResult = {
  url: string;
  status: number;
  records: ExtractedRecord[];
};

export type CrawlSiteResult = {
  records: ExtractedRecord[];
  pagesCrawled: number;
  pagesPerUrl: CrawlPageResult[];
  skipped: Array<{ url: string; reason: string }>;
  failures: Array<{ url: string; error: string }>;
  auditEvents: AuditEvent[];
  startedAt: string;
  finishedAt: string;
};

const DEFAULT_MAX_PAGES = 50;
const DEFAULT_MAX_DEPTH = 3;

export async function crawlSite(opts: CrawlSiteOptions): Promise<CrawlSiteResult> {
  const now = opts.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const auditEvents: AuditEvent[] = [];
  const records: ExtractedRecord[] = [];
  const pagesPerUrl: CrawlPageResult[] = [];
  const skipped: Array<{ url: string; reason: string }> = [];
  const failures: Array<{ url: string; error: string }> = [];

  const frontier = new Frontier({
    entryUrl: opts.entryUrl,
    scope: opts.scope ?? 'section',
    maxPages: opts.maxPages ?? DEFAULT_MAX_PAGES,
    maxDepth: opts.maxDepth ?? DEFAULT_MAX_DEPTH,
  });
  const politeness = new PolitenessGate(opts.politeness ?? {});
  const robots = new RobotsPolicyChecker({
    cache: opts.robotsCache,
    userAgent: opts.userAgent,
    ...(opts.robotsPolicy ? { policy: opts.robotsPolicy } : {}),
    onAudit: (e) => auditEvents.push(e),
  });
  const followLinks = opts.followLinks ?? true;

  // Seed the frontier with the entry URL plus any discovery results.
  const seedEntries: Array<{ url: string; depth: number; source: 'seed' | 'discovery' }> = [
    { url: opts.entryUrl, depth: 0, source: 'seed' },
  ];
  for (const s of opts.seeds ?? []) {
    if (s !== opts.entryUrl) seedEntries.push({ url: s, depth: 0, source: 'discovery' });
  }
  const seedResult = frontier.enqueue(seedEntries);
  for (const r of seedResult.rejected) skipped.push({ url: r.url, reason: r.reason });

  while (!frontier.isExhausted()) {
    if (opts.signal?.aborted) {
      skipped.push({ url: '(remaining)', reason: 'aborted' });
      break;
    }

    const next = frontier.dequeue();
    if (!next) break;

    // 1. robots.
    const decision = await robots.check(next.url);
    if (!decision.allowed) {
      skipped.push({ url: next.url, reason: decision.reason });
      frontier.markVisited(next.canonicalKey);
      emitProgress(opts.onProgress, frontier, records, failures.length);
      continue;
    }

    // 2. politeness.
    const crawlDelay = await robots.crawlDelaySec(next.url);
    const release = await politeness.acquire(
      next.url,
      ...(crawlDelay !== undefined ? [crawlDelay] : []),
    );

    let pageResult: CrawlPageResult | null = null;
    try {
      const res = await opts.fetcher.fetch(next.url);
      politeness.noteResponse(next.url, {
        status: res.status,
        ...(res.headers['retry-after'] ? { retryAfter: res.headers['retry-after'] } : {}),
      });

      if (res.status >= 400) {
        failures.push({ url: next.url, error: `http-${res.status}` });
        frontier.markVisited(next.canonicalKey);
        continue;
      }

      const cleaned = cleanHtml(res.body);
      const extraction = execute({
        cleanedHtml: cleaned.html,
        config: opts.config,
        sourceUrl: res.finalUrl || next.url,
        now,
      });
      records.push(...extraction.records);
      pageResult = { url: next.url, status: res.status, records: extraction.records };
      pagesPerUrl.push(pageResult);

      // 3. Link discovery — only when enabled and we still have depth budget.
      if (followLinks && next.depth + 1 <= (opts.maxDepth ?? DEFAULT_MAX_DEPTH)) {
        const links = extractLinks(res.body, res.finalUrl || next.url);
        const enqueued = frontier.enqueue(
          links.map((url) => ({
            url,
            depth: next.depth + 1,
            source: 'link' as const,
            parentUrl: next.url,
          })),
        );
        // Surface the reasons that matter for the crawl report. Duplicates
        // are noise — dropping them is the whole point of the frontier.
        for (const r of enqueued.rejected) {
          if (r.reason !== 'duplicate') {
            skipped.push({ url: r.url, reason: r.reason });
          }
        }
      }
    } catch (err) {
      politeness.noteResponse(next.url, { networkError: true });
      failures.push({ url: next.url, error: (err as Error).message });
    } finally {
      release();
      frontier.markVisited(next.canonicalKey);
      emitProgress(opts.onProgress, frontier, records, failures.length);
    }
  }

  return {
    records,
    pagesCrawled: pagesPerUrl.length,
    pagesPerUrl,
    skipped,
    failures,
    auditEvents,
    startedAt,
    finishedAt: now().toISOString(),
  };
}

function emitProgress(
  cb: CrawlSiteOptions['onProgress'],
  frontier: Frontier,
  records: ExtractedRecord[],
  failures: number,
): void {
  if (!cb) return;
  cb({
    pagesDone: frontier.visitedCount,
    inFrontier: frontier.size,
    recordsExtracted: records.length,
    failures,
  });
}

function extractLinks(html: string, baseUrl: string): string[] {
  try {
    const dom = new JSDOM(html, { url: baseUrl });
    const anchors = dom.window.document.querySelectorAll('a[href]');
    const out = new Set<string>();
    for (const a of anchors) {
      const href = a.getAttribute('href');
      if (!href) continue;
      try {
        const abs = new URL(href, baseUrl);
        if (abs.protocol === 'http:' || abs.protocol === 'https:') {
          abs.hash = '';
          out.add(abs.toString());
        }
      } catch {
        /* skip malformed */
      }
    }
    return Array.from(out);
  } catch {
    return [];
  }
}
