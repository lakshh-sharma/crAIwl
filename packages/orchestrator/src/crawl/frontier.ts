/**
 * In-memory frontier queue.
 *
 * For v1 we run the whole crawl in-process — a Map keyed by canonical URL
 * tracks dedup, an array holds the queue, and counts enforce caps. The
 * Fetcher / Politeness / Executor interfaces are agnostic to where the
 * frontier lives, so swapping this out for BullMQ + Redis later is a
 * contained change.
 */

import { canonicalize, isInScope, type CrawlScopeMode } from './canonicalize.js';

export type FrontierSource = 'seed' | 'discovery' | 'link';

export type FrontierEntry = {
  /** The URL as the user/discoverer wrote it (pre-canonicalization). */
  url: string;
  /** Canonical form used for dedup keys. */
  canonicalKey: string;
  /** Depth from the entry URL (entry = 0). */
  depth: number;
  source: FrontierSource;
  parentUrl?: string;
};

export type FrontierOptions = {
  entryUrl: string;
  maxDepth?: number;
  maxPages?: number;
  scope?: CrawlScopeMode;
  paramAllowlist?: Set<string>;
};

export type EnqueueRejection = {
  url: string;
  reason: 'malformed' | 'out-of-scope' | 'past-max-depth' | 'past-max-pages' | 'duplicate';
};

export type EnqueueResult = {
  accepted: number;
  rejected: EnqueueRejection[];
};

const DEFAULT_MAX_PAGES = 200;

export class Frontier {
  private readonly queue: FrontierEntry[] = [];
  private readonly seen = new Set<string>();
  private readonly visited = new Set<string>();
  private readonly entryUrl: string;
  private readonly scope: CrawlScopeMode;
  private readonly maxDepth: number;
  private readonly maxPages: number;
  private readonly paramAllowlist: Set<string>;

  constructor(opts: FrontierOptions) {
    this.entryUrl = opts.entryUrl;
    this.scope = opts.scope ?? 'section';
    this.maxDepth = opts.maxDepth ?? Number.POSITIVE_INFINITY;
    this.maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;
    this.paramAllowlist = opts.paramAllowlist ?? new Set<string>();
  }

  /**
   * Add candidates to the queue. Returns counts; out-of-scope, malformed,
   * past-depth, and duplicate URLs are skipped silently (but appear in
   * `rejected` for visibility).
   */
  enqueue(candidates: Array<Omit<FrontierEntry, 'canonicalKey'>>): EnqueueResult {
    let accepted = 0;
    const rejected: EnqueueRejection[] = [];

    for (const c of candidates) {
      const key = canonicalize(c.url, { paramAllowlist: this.paramAllowlist });
      if (!key) {
        rejected.push({ url: c.url, reason: 'malformed' });
        continue;
      }
      if (!isInScope(c.url, this.entryUrl, this.scope)) {
        rejected.push({ url: c.url, reason: 'out-of-scope' });
        continue;
      }
      if (c.depth > this.maxDepth) {
        rejected.push({ url: c.url, reason: 'past-max-depth' });
        continue;
      }
      if (this.seen.has(key)) {
        rejected.push({ url: c.url, reason: 'duplicate' });
        continue;
      }
      if (this.seen.size >= this.maxPages) {
        rejected.push({ url: c.url, reason: 'past-max-pages' });
        continue;
      }
      this.seen.add(key);
      const entry: FrontierEntry = {
        url: c.url,
        canonicalKey: key,
        depth: c.depth,
        source: c.source,
      };
      if (c.parentUrl) entry.parentUrl = c.parentUrl;
      this.queue.push(entry);
      accepted++;
    }

    return { accepted, rejected };
  }

  dequeue(): FrontierEntry | undefined {
    return this.queue.shift();
  }

  markVisited(canonicalKey: string): void {
    this.visited.add(canonicalKey);
  }

  get size(): number {
    return this.queue.length;
  }
  get visitedCount(): number {
    return this.visited.size;
  }
  get seenCount(): number {
    return this.seen.size;
  }

  /** True when the queue is empty AND every URL we've ever accepted has been visited. */
  isExhausted(): boolean {
    return this.queue.length === 0;
  }
}
