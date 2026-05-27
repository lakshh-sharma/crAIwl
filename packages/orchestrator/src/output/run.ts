/**
 * One-shot job runner.
 *
 * The CLI's happy path: take a URL + a goal, fetch + clean the entry page,
 * compile a config, crawl the rest, partition into clean vs. review, and
 * return everything the CLI needs to serialize.
 *
 * Callers that already have a config (e.g. scheduled re-runs) skip the
 * compile step by passing `config` directly.
 */

import { randomUUID } from 'node:crypto';
import { cleanHtml, partitionByConfidence, type ExtractedRecord } from '@craiwl/extractor';
import type { Fetcher, RobotsCache } from '@craiwl/fetcher';
import type { LLMProvider, StrategyConfig } from '@craiwl/core';
import { compile, type UserField } from '../compile/index.js';
import { crawlSite, type CrawlSiteResult } from '../crawl/index.js';
import type { CrawlScopeMode } from '../crawl/canonicalize.js';
import { buildManifest, type RunManifest } from './manifest.js';

export type RunJobOptions = {
  entryUrl: string;
  goal: string;
  fetcher: Fetcher;
  robotsCache: RobotsCache;
  userAgent: string;
  llm?: LLMProvider;
  /** Skip compile by providing a pre-existing config. */
  config?: StrategyConfig;
  /** Optional user-supplied fields when compiling. */
  userFields?: UserField[];
  scope?: CrawlScopeMode;
  maxPages?: number;
  maxDepth?: number;
  robotsPolicy?: 'respect' | 'warn' | 'ignore';
  followLinks?: boolean;
  /** Override clock for deterministic runs in tests. */
  now?: () => Date;
  /** Override the run id (defaults to a fresh UUID). */
  runId?: string;
};

export type RunJobResult = {
  runId: string;
  config: StrategyConfig;
  crawl: CrawlSiteResult;
  records: ExtractedRecord[];
  cleanRecords: ExtractedRecord[];
  reviewRecords: ExtractedRecord[];
  manifest: RunManifest;
};

export async function runJob(opts: RunJobOptions): Promise<RunJobResult> {
  const now = opts.now ?? (() => new Date());
  const runId = opts.runId ?? `run-${randomUUID()}`;

  // 1. Get a config. Either use one the caller provided, or compile one from
  //    the entry page.
  let config: StrategyConfig;
  if (opts.config) {
    config = opts.config;
  } else {
    if (!opts.llm) {
      throw new Error('runJob: either `config` or `llm` must be provided');
    }
    const entryRes = await opts.fetcher.fetch(opts.entryUrl);
    if (entryRes.status >= 400) {
      throw new Error(`runJob: entry URL returned http-${entryRes.status}`);
    }
    const cleaned = cleanHtml(entryRes.body);
    const compileResult = await compile({
      entryUrl: entryRes.finalUrl || opts.entryUrl,
      cleanedHtml: cleaned.html,
      goal: opts.goal,
      ...(opts.userFields ? { userFields: opts.userFields } : {}),
      ...(opts.scope ? { scope: opts.scope === 'single' ? 'single' : 'site' } : {}),
      llm: opts.llm,
      now,
    });
    config = compileResult.config;
  }

  // 2. Crawl.
  const crawl = await crawlSite({
    entryUrl: opts.entryUrl,
    config,
    fetcher: opts.fetcher,
    robotsCache: opts.robotsCache,
    userAgent: opts.userAgent,
    ...(opts.scope ? { scope: opts.scope } : {}),
    ...(opts.maxPages !== undefined ? { maxPages: opts.maxPages } : {}),
    ...(opts.maxDepth !== undefined ? { maxDepth: opts.maxDepth } : {}),
    ...(opts.robotsPolicy ? { robotsPolicy: opts.robotsPolicy } : {}),
    ...(opts.followLinks !== undefined ? { followLinks: opts.followLinks } : {}),
    now,
  });

  // 3. Partition by confidence using the config's floor.
  const partition = partitionByConfidence(
    {
      records: crawl.records,
      perTemplate: {},
      successCount: 0,
      failureCount: 0,
      timingMs: 0,
    },
    config.confidenceFloor,
  );

  // 4. Build the manifest.
  const manifest = buildManifest({
    runId,
    startedAt: crawl.startedAt,
    finishedAt: crawl.finishedAt,
    config,
    records: crawl.records,
    cleanCount: partition.clean.length,
    reviewCount: partition.review.length,
    pagesCrawled: crawl.pagesCrawled,
    pagesSkipped: crawl.skipped.length,
    pagesFailed: crawl.failures.length,
  });

  return {
    runId,
    config,
    crawl,
    records: crawl.records,
    cleanRecords: partition.clean,
    reviewRecords: partition.review,
    manifest,
  };
}
