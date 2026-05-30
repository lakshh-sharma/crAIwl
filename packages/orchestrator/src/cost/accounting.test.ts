import { describe, expect, it } from 'vitest';
import { computeRunCost } from './accounting.js';

describe('computeRunCost', () => {
  it('totals tokens + dollars across compile and self-heal phases', () => {
    const breakdown = computeRunCost({
      compile: { calls: 2, inputTokens: 4000, outputTokens: 1000 },
      selfHeal: { calls: 1, inputTokens: 2000, outputTokens: 500 },
      model: 'claude-sonnet-4-6',
      pages: [
        { tier: 'static', timingMs: 100 },
        { tier: 'static', timingMs: 200 },
        { tier: 'headless', timingMs: 1500 },
      ],
      startedAt: '2026-05-29T12:00:00.000Z',
      finishedAt: '2026-05-29T12:00:10.000Z',
      recordCount: 5,
    });

    expect(breakdown.llm.totalCalls).toBe(3);
    expect(breakdown.llm.inputTokens).toBe(6000);
    expect(breakdown.llm.outputTokens).toBe(1500);
    // 6000 input × $3/M + 1500 output × $15/M = 0.018 + 0.0225 = 0.0405
    expect(breakdown.llm.estimatedUsd).toBeCloseTo(0.0405, 4);
    expect(breakdown.llm.byPhase.compile.calls).toBe(2);
    expect(breakdown.llm.byPhase.selfHeal.calls).toBe(1);
  });

  it('buckets pages by fetch tier', () => {
    const breakdown = computeRunCost({
      compile: { calls: 1, inputTokens: 0, outputTokens: 0 },
      selfHeal: { calls: 0, inputTokens: 0, outputTokens: 0 },
      model: 'claude-sonnet-4-6',
      pages: [
        { tier: 'static', timingMs: 50 },
        { tier: 'static', timingMs: 100 },
        { tier: 'headless', timingMs: 2000 },
        { tier: 'headless', timingMs: 2500 },
        { tier: 'static', timingMs: 75 },
      ],
      startedAt: '2026-05-29T12:00:00.000Z',
      finishedAt: '2026-05-29T12:00:05.000Z',
      recordCount: 5,
    });
    expect(breakdown.pages.byTier).toEqual({ static: 3, headless: 2 });
    expect(breakdown.pages.totalFetchTimeMs).toBe(4725);
  });

  it('computes wall-clock from the timestamps', () => {
    const breakdown = computeRunCost({
      compile: { calls: 0, inputTokens: 0, outputTokens: 0 },
      selfHeal: { calls: 0, inputTokens: 0, outputTokens: 0 },
      model: 'mock-llm',
      pages: [],
      startedAt: '2026-05-29T12:00:00.000Z',
      finishedAt: '2026-05-29T12:00:30.000Z',
      recordCount: 0,
    });
    expect(breakdown.wallClock.totalMs).toBe(30_000);
  });

  it('reports records-per-Ktoken efficiency', () => {
    const breakdown = computeRunCost({
      compile: { calls: 1, inputTokens: 1000, outputTokens: 0 },
      selfHeal: { calls: 0, inputTokens: 0, outputTokens: 0 },
      model: 'claude-sonnet-4-6',
      pages: [{ tier: 'static', timingMs: 100 }],
      startedAt: '2026-05-29T12:00:00.000Z',
      finishedAt: '2026-05-29T12:00:01.000Z',
      recordCount: 50,
    });
    // 50 records / 1000 tokens × 1000 = 50 records per 1K tokens.
    expect(breakdown.records.perKToken).toBe(50);
  });

  it('returns perKToken=0 when nothing was spent on the LLM', () => {
    const breakdown = computeRunCost({
      compile: { calls: 0, inputTokens: 0, outputTokens: 0 },
      selfHeal: { calls: 0, inputTokens: 0, outputTokens: 0 },
      model: 'mock-llm',
      pages: [{ tier: 'static', timingMs: 100 }],
      startedAt: '2026-05-29T12:00:00.000Z',
      finishedAt: '2026-05-29T12:00:01.000Z',
      recordCount: 100,
    });
    expect(breakdown.records.perKToken).toBe(0);
  });

  it('zero-cost path for re-runs that reuse a saved config and never call the LLM', () => {
    const breakdown = computeRunCost({
      compile: { calls: 0, inputTokens: 0, outputTokens: 0 },
      selfHeal: { calls: 0, inputTokens: 0, outputTokens: 0 },
      model: 'claude-sonnet-4-6',
      pages: [{ tier: 'static', timingMs: 50 }],
      startedAt: '2026-05-29T12:00:00.000Z',
      finishedAt: '2026-05-29T12:00:01.000Z',
      recordCount: 10,
    });
    expect(breakdown.llm.estimatedUsd).toBe(0);
    expect(breakdown.llm.totalCalls).toBe(0);
  });
});
