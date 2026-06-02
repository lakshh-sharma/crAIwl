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
import {
  auditedProvider,
  InMemoryAuditLog,
  resolveAuthHeaders,
  type AuditLog,
  type AuthProfile,
  type LLMProvider,
  type SecretsProvider,
  type StrategyConfig,
} from '@craiwl/core';
import { compile, type UserField } from '../compile/index.js';
import { crawlSite, type CrawlSiteResult } from '../crawl/index.js';
import type { CrawlScopeMode } from '../crawl/canonicalize.js';
import { computeRunCost, diffRuns, type RunCostBreakdown, type RunDiff } from '../cost/index.js';
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
  /** Enable self-heal during the crawl. Reuses `llm` for repair calls. */
  selfHeal?: { maxRepairs?: number };
  /** Previous-run records to diff against. Returns a populated `diff` field. */
  previousRecords?: ExtractedRecord[];
  /**
   * Resolves the named secret in `config.auth` (when present) into request
   * headers attached to every fetch. Required when the config has auth.
   */
  secrets?: SecretsProvider;
  /**
   * Auth profile to stamp onto the compiled config (only honored when
   * runJob is doing the compile — pre-supplied configs are not mutated).
   * Use this from the CLI flow where the user passes `--auth-*` and we
   * have to write auth into the freshly-compiled config.
   */
  auth?: AuthProfile;
  /**
   * Caller-supplied audit log. When omitted, runJob creates an
   * InMemoryAuditLog internally so the manifest's compliance section is
   * still populated. Pass one in when you want to persist the JSONL or
   * inspect events afterwards.
   */
  auditLog?: AuditLog;
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
  cost: RunCostBreakdown;
  /** Populated when the caller supplied `previousRecords`. */
  diff?: RunDiff;
  /** The audit log the run wrote to. Always present. */
  auditLog: AuditLog;
};

export async function runJob(opts: RunJobOptions): Promise<RunJobResult> {
  const now = opts.now ?? (() => new Date());
  const runId = opts.runId ?? `run-${randomUUID()}`;
  const auditLog: AuditLog = opts.auditLog ?? new InMemoryAuditLog();

  // 1. Resolve auth headers upfront when we know we'll need them. The crawl,
  //    the compile-time entry fetch, and any saved-config auth profile all
  //    use the same headers — resolving once keeps the secret short-lived
  //    in memory and centralizes the SecretsProvider dependency.
  const pendingAuth: AuthProfile | undefined = opts.config?.auth ?? opts.auth;
  let authHeaders: Record<string, string> | undefined;
  if (pendingAuth) {
    if (!opts.secrets) {
      throw new Error('runJob: auth is configured but no SecretsProvider was supplied');
    }
    // Wrap the provider so every read gets audited. We don't audit the
    // provider passed in by the caller directly — they might reuse it
    // across many runs and want their own audit policy.
    const provider = auditedProvider(opts.secrets, { audit: auditLog, reason: 'resolve-auth' });
    authHeaders = await resolveAuthHeaders(pendingAuth, provider);
  }

  // 2. Get a config. Either use one the caller provided, or compile one from
  //    the entry page (which we fetch with the auth headers when present).
  let config: StrategyConfig;
  const compileUsage = { calls: 0, inputTokens: 0, outputTokens: 0 };
  let compileModel = opts.config?.createdBy ?? 'unknown';

  if (opts.config) {
    config = opts.config;
  } else {
    if (!opts.llm) {
      throw new Error('runJob: either `config` or `llm` must be provided');
    }
    const entryRes = await opts.fetcher.fetch(
      opts.entryUrl,
      authHeaders ? { headers: { ...authHeaders } } : {},
    );
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
    // Compile makes 2 LLM calls (field-schema + locator-synthesis).
    compileUsage.calls = 2;
    compileUsage.inputTokens = compileResult.usage.inputTokens;
    compileUsage.outputTokens = compileResult.usage.outputTokens;
    compileModel = compileResult.model;

    // Stamp the CLI-supplied auth profile onto the freshly-compiled config
    // so subsequent saves persist it.
    if (opts.auth) {
      config = { ...config, auth: opts.auth };
    }
  }

  // 3. Crawl.
  const crawl = await crawlSite({
    entryUrl: opts.entryUrl,
    config,
    fetcher: opts.fetcher,
    robotsCache: opts.robotsCache,
    userAgent: opts.userAgent,
    auditLog,
    ...(authHeaders ? { authHeaders } : {}),
    ...(opts.scope ? { scope: opts.scope } : {}),
    ...(opts.maxPages !== undefined ? { maxPages: opts.maxPages } : {}),
    ...(opts.maxDepth !== undefined ? { maxDepth: opts.maxDepth } : {}),
    ...(opts.robotsPolicy ? { robotsPolicy: opts.robotsPolicy } : {}),
    ...(opts.followLinks !== undefined ? { followLinks: opts.followLinks } : {}),
    ...(opts.selfHeal && opts.llm
      ? {
          selfHeal: {
            llm: opts.llm,
            ...(opts.selfHeal.maxRepairs !== undefined
              ? { maxRepairs: opts.selfHeal.maxRepairs }
              : {}),
          },
        }
      : {}),
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

  // 4. Cost accounting.
  const cost = computeRunCost({
    compile: compileUsage,
    selfHeal: {
      calls: crawl.selfHealUsage.calls,
      inputTokens: crawl.selfHealUsage.inputTokens,
      outputTokens: crawl.selfHealUsage.outputTokens,
    },
    model: compileModel,
    pages: crawl.pagesPerUrl.map((p) => ({ tier: p.tierUsed, timingMs: p.timingMs })),
    startedAt: crawl.startedAt,
    finishedAt: crawl.finishedAt,
    recordCount: crawl.records.length,
  });

  // 5. Build the manifest (now carries cost + compliance).
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
    cost,
    auditLog,
  });

  // 6. Optional diff against a previous run.
  const diff = opts.previousRecords ? diffRuns(opts.previousRecords, crawl.records) : undefined;

  return {
    runId,
    config,
    crawl,
    records: crawl.records,
    cleanRecords: partition.clean,
    reviewRecords: partition.review,
    manifest,
    cost,
    auditLog,
    ...(diff ? { diff } : {}),
  };
}
