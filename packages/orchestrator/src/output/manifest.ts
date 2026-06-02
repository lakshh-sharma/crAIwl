/**
 * Run manifest — the metadata block that ships alongside every output.
 *
 * The manifest answers the questions a downstream consumer cares about:
 * which config produced these records, when, how much was crawled, and
 * what fraction of records actually got each field. Without it, exported
 * data is just a CSV without context.
 */

import type { ExtractedRecord } from '@craiwl/extractor';
import type { AuditLog, StrategyConfig } from '@craiwl/core';
import type { RunCostBreakdown } from '../cost/index.js';

export type RunManifest = {
  runId: string;
  startedAt: string;
  finishedAt: string;
  goal: string;
  entryUrl: string;
  config: {
    version: string;
    createdBy: string;
    createdAt: string;
    fetchProfile: string;
    confidenceFloor: number;
  };
  counts: {
    pagesCrawled: number;
    recordsTotal: number;
    recordsClean: number;
    recordsReview: number;
    pagesSkipped: number;
    pagesFailed: number;
  };
  /** % of records where each field was successfully extracted, keyed by `<templateId>.<fieldName>`. */
  fieldCoverage: Record<string, number>;
  /** LLM + page + wall-clock cost breakdown for this run. */
  cost: RunCostBreakdown;
  /**
   * Compliance rollup — what credentials were used, how many robots
   * overrides fired, how many pages got auth headers, how many auth
   * failures came back. Always present; fields are zeroed when nothing
   * audit-worthy happened.
   */
  compliance: ComplianceSummary;
};

export type ComplianceSummary = {
  /** null when the run was unauthenticated. */
  authProfile: { type: 'bearer' | 'api-key' | 'basic'; secretNames: string[] } | null;
  /** Distinct secret names accessed during the run — never values. */
  secretsAccessed: string[];
  /** Pages that had auth headers attached. */
  pagesAuthenticated: number;
  /** Robots.txt bypasses (warn or ignore policy). */
  robotsBypasses: number;
  /** 401/403 responses. A non-zero count usually means a bad token. */
  httpAuthFailures: number;
};

export type BuildManifestInput = {
  runId: string;
  startedAt: string;
  finishedAt: string;
  config: StrategyConfig;
  records: ExtractedRecord[];
  cleanCount: number;
  reviewCount: number;
  pagesCrawled: number;
  pagesSkipped: number;
  pagesFailed: number;
  cost: RunCostBreakdown;
  /** Source of truth for the compliance summary. Optional — runs that don't
   * pass an audit log produce a zeroed/unauthenticated summary. */
  auditLog?: AuditLog;
};

export function buildManifest(input: BuildManifestInput): RunManifest {
  return {
    runId: input.runId,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    goal: input.config.goal,
    entryUrl: input.config.target.entryUrl,
    config: {
      version: input.config.strategyVersion,
      createdBy: input.config.createdBy,
      createdAt: input.config.createdAt,
      fetchProfile: input.config.fetchProfile,
      confidenceFloor: input.config.confidenceFloor,
    },
    counts: {
      pagesCrawled: input.pagesCrawled,
      recordsTotal: input.records.length,
      recordsClean: input.cleanCount,
      recordsReview: input.reviewCount,
      pagesSkipped: input.pagesSkipped,
      pagesFailed: input.pagesFailed,
    },
    fieldCoverage: computeCoverage(input.records),
    cost: input.cost,
    compliance: buildCompliance(input.config, input.auditLog),
  };
}

function buildCompliance(
  config: StrategyConfig,
  auditLog: AuditLog | undefined,
): ComplianceSummary {
  const authProfile: ComplianceSummary['authProfile'] = config.auth
    ? { type: config.auth.type, secretNames: [config.auth.secret] }
    : null;
  if (!auditLog) {
    return {
      authProfile,
      secretsAccessed: [],
      pagesAuthenticated: 0,
      robotsBypasses: 0,
      httpAuthFailures: 0,
    };
  }
  const secrets = new Set<string>();
  let pagesAuthenticated = 0;
  let robotsBypasses = 0;
  let httpAuthFailures = 0;
  for (const e of auditLog.events()) {
    if (e.kind === 'secret-accessed') secrets.add(e.secretName);
    else if (e.kind === 'auth-attached') pagesAuthenticated++;
    else if (e.kind === 'robots-bypass') robotsBypasses++;
    else if (e.kind === 'http-auth-failure') httpAuthFailures++;
  }
  return {
    authProfile,
    secretsAccessed: Array.from(secrets).sort(),
    pagesAuthenticated,
    robotsBypasses,
    httpAuthFailures,
  };
}

function computeCoverage(records: ExtractedRecord[]): Record<string, number> {
  const counts = new Map<string, { hits: number; total: number }>();
  for (const rec of records) {
    for (const [fieldName, outcome] of Object.entries(rec.fields)) {
      const key = `${rec.templateId}.${fieldName}`;
      const c = counts.get(key) ?? { hits: 0, total: 0 };
      c.total++;
      if (outcome.ok) c.hits++;
      counts.set(key, c);
    }
  }
  const out: Record<string, number> = {};
  for (const [k, c] of counts) {
    out[k] = c.total === 0 ? 0 : Math.round((c.hits / c.total) * 1000) / 1000;
  }
  return out;
}
