/**
 * Per-run cost accounting.
 *
 * Aggregates everything the orchestrator paid for during a single run:
 *
 *  - LLM calls broken into "compile" (the one-time program synthesis at the
 *    start) and "self-heal" (per-field repairs during the crawl). Each gets
 *    a token and dollar count so the compile-once-execute-many ratio is
 *    visible.
 *  - Pages bucketed by fetch tier (static / impersonate / headless / proxy)
 *    — useful for catching unexpected tier escalation.
 *  - Wall-clock and total fetch time.
 *  - Records produced per thousand tokens spent — the efficiency metric
 *    that anchors the cost story.
 *
 * The breakdown attaches to the run manifest so JSON exports carry it for
 * downstream cost dashboards, and Markdown exports render a short summary.
 */

import type { FetchTier } from '@craiwl/fetcher';
import { estimateUsd } from './pricing.js';

export type PhaseUsage = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  estimatedUsd: number;
};

export type RunCostBreakdown = {
  llm: {
    totalCalls: number;
    inputTokens: number;
    outputTokens: number;
    estimatedUsd: number;
    model: string;
    byPhase: {
      compile: PhaseUsage;
      selfHeal: PhaseUsage;
    };
  };
  pages: {
    total: number;
    byTier: Partial<Record<FetchTier, number>>;
    totalFetchTimeMs: number;
  };
  wallClock: {
    totalMs: number;
    startedAt: string;
    finishedAt: string;
  };
  records: {
    total: number;
    /** Records produced per 1,000 tokens spent. Higher = better efficiency. */
    perKToken: number;
  };
};

export type ComputeCostInput = {
  compile: {
    /** Number of distinct LLM calls during compile (0 when running from a saved config). */
    calls: number;
    inputTokens: number;
    outputTokens: number;
  };
  selfHeal: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
  };
  model: string;
  pages: Array<{ tier: FetchTier; timingMs: number }>;
  startedAt: string;
  finishedAt: string;
  recordCount: number;
};

export function computeRunCost(input: ComputeCostInput): RunCostBreakdown {
  const compileUsd = estimateUsd(
    input.model,
    input.compile.inputTokens,
    input.compile.outputTokens,
  );
  const selfHealUsd = estimateUsd(
    input.model,
    input.selfHeal.inputTokens,
    input.selfHeal.outputTokens,
  );

  const totalInputTokens = input.compile.inputTokens + input.selfHeal.inputTokens;
  const totalOutputTokens = input.compile.outputTokens + input.selfHeal.outputTokens;
  const totalTokens = totalInputTokens + totalOutputTokens;

  const byTier: Partial<Record<FetchTier, number>> = {};
  let totalFetchTimeMs = 0;
  for (const page of input.pages) {
    byTier[page.tier] = (byTier[page.tier] ?? 0) + 1;
    totalFetchTimeMs += page.timingMs;
  }

  const wallClockMs = new Date(input.finishedAt).getTime() - new Date(input.startedAt).getTime();

  return {
    llm: {
      totalCalls: input.compile.calls + input.selfHeal.calls,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      estimatedUsd: round4(compileUsd + selfHealUsd),
      model: input.model,
      byPhase: {
        compile: {
          calls: input.compile.calls,
          inputTokens: input.compile.inputTokens,
          outputTokens: input.compile.outputTokens,
          estimatedUsd: round4(compileUsd),
        },
        selfHeal: {
          calls: input.selfHeal.calls,
          inputTokens: input.selfHeal.inputTokens,
          outputTokens: input.selfHeal.outputTokens,
          estimatedUsd: round4(selfHealUsd),
        },
      },
    },
    pages: {
      total: input.pages.length,
      byTier,
      totalFetchTimeMs,
    },
    wallClock: {
      totalMs: Math.max(0, wallClockMs),
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
    },
    records: {
      total: input.recordCount,
      perKToken: totalTokens === 0 ? 0 : round4((input.recordCount * 1000) / totalTokens),
    },
  };
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
