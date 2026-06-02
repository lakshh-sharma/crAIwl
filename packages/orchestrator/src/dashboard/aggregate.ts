/**
 * Aggregates a list of run manifests into the rollup the dashboard renders.
 *
 * Manifests live one-per-run on disk. The dashboard is a derived view —
 * recomputed from scratch every time so there's nothing to invalidate when
 * we change the rollup shape. Cost is O(runs) and runs are few.
 */

import type { RunManifest } from '../output/manifest.js';

export type DashboardRunRow = {
  runId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  goal: string;
  entryUrl: string;
  pagesCrawled: number;
  pagesFailed: number;
  recordsTotal: number;
  recordsClean: number;
  estimatedUsd: number;
  /** True when the run had an auth profile attached. */
  authenticated: boolean;
  /** Non-zero count signals a misconfigured token. */
  httpAuthFailures: number;
  robotsBypasses: number;
};

export type DashboardSummary = {
  generatedAt: string;
  /** Range of runs included — null when the list is empty. */
  range: { earliest: string; latest: string } | null;
  totals: {
    runs: number;
    pagesCrawled: number;
    recordsTotal: number;
    recordsClean: number;
    estimatedUsd: number;
    /** Sum of `httpAuthFailures` across runs — a quick "do my tokens work" check. */
    httpAuthFailures: number;
    /** Successful runs (>0 records OR 0 failed pages and >0 pages crawled). */
    successfulRuns: number;
  };
  rows: DashboardRunRow[];
};

export type AggregateOptions = {
  /** Override clock for deterministic tests. */
  now?: () => Date;
  /** Cap on rows returned. Default 200. */
  maxRows?: number;
};

const DEFAULT_MAX_ROWS = 200;

export function aggregate(manifests: RunManifest[], opts: AggregateOptions = {}): DashboardSummary {
  const now = opts.now ?? (() => new Date());
  const limit = opts.maxRows ?? DEFAULT_MAX_ROWS;

  // Sort newest first — operators want the most recent run at the top.
  const sorted = manifests
    .slice()
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
    .slice(0, limit);

  const rows: DashboardRunRow[] = sorted.map(toRow);
  const totals = rows.reduce(
    (acc, r) => {
      acc.runs++;
      acc.pagesCrawled += r.pagesCrawled;
      acc.recordsTotal += r.recordsTotal;
      acc.recordsClean += r.recordsClean;
      acc.estimatedUsd += r.estimatedUsd;
      acc.httpAuthFailures += r.httpAuthFailures;
      if (isSuccess(r)) acc.successfulRuns++;
      return acc;
    },
    {
      runs: 0,
      pagesCrawled: 0,
      recordsTotal: 0,
      recordsClean: 0,
      estimatedUsd: 0,
      httpAuthFailures: 0,
      successfulRuns: 0,
    },
  );
  // Round so the HTML doesn't show a 17-digit float.
  totals.estimatedUsd = Math.round(totals.estimatedUsd * 10_000) / 10_000;

  const range: DashboardSummary['range'] =
    rows.length === 0
      ? null
      : {
          earliest: rows[rows.length - 1]!.startedAt,
          latest: rows[0]!.startedAt,
        };

  return {
    generatedAt: now().toISOString(),
    range,
    totals,
    rows,
  };
}

function toRow(m: RunManifest): DashboardRunRow {
  const started = Date.parse(m.startedAt);
  const finished = Date.parse(m.finishedAt);
  const durationMs = Number.isFinite(started) && Number.isFinite(finished) ? finished - started : 0;
  return {
    runId: m.runId,
    startedAt: m.startedAt,
    finishedAt: m.finishedAt,
    durationMs,
    goal: m.goal,
    entryUrl: m.entryUrl,
    pagesCrawled: m.counts.pagesCrawled,
    pagesFailed: m.counts.pagesFailed,
    recordsTotal: m.counts.recordsTotal,
    recordsClean: m.counts.recordsClean,
    estimatedUsd: m.cost.llm.estimatedUsd,
    authenticated: m.compliance.authProfile !== null,
    httpAuthFailures: m.compliance.httpAuthFailures,
    robotsBypasses: m.compliance.robotsBypasses,
  };
}

function isSuccess(r: DashboardRunRow): boolean {
  if (r.recordsTotal > 0) return true;
  return r.pagesCrawled > 0 && r.pagesFailed === 0;
}
