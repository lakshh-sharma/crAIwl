import { describe, expect, it } from 'vitest';
import { estimateUsd, getPricing, DEFAULT_PRICING } from './pricing.js';

describe('estimateUsd', () => {
  it('multiplies tokens by the per-million rate', () => {
    // 1M input + 1M output on Sonnet 4.6 = $3 + $15 = $18.
    expect(estimateUsd('claude-sonnet-4-6', 1_000_000, 1_000_000)).toBeCloseTo(18, 2);
  });

  it('scales linearly with token count', () => {
    const half = estimateUsd('claude-sonnet-4-6', 500_000, 500_000);
    expect(half).toBeCloseTo(9, 2);
  });

  it('returns 0 for unknown models rather than throwing', () => {
    expect(estimateUsd('not-a-real-model', 1_000_000, 1_000_000)).toBe(0);
  });

  it('treats mock models as free so test runs do not show fake cost', () => {
    expect(estimateUsd('mock-llm', 1_000_000, 1_000_000)).toBe(0);
  });

  it('rounds to 4 decimal places for readable manifests', () => {
    const usd = estimateUsd('claude-sonnet-4-6', 33, 11);
    // 33 input × $3/M + 11 output × $15/M = 0.000099 + 0.000165 = 0.000264 → rounds to 0.0003.
    expect(usd).toBe(0.0003);
  });

  it('honors a custom pricing table', () => {
    const cents = estimateUsd('weird-model', 1_000_000, 1_000_000, {
      'weird-model': { inputPerMTok: 1.0, outputPerMTok: 1.0 },
    });
    expect(cents).toBe(2);
  });
});

describe('getPricing', () => {
  it('returns the pricing record for known models', () => {
    expect(getPricing('claude-sonnet-4-6')).toEqual({ inputPerMTok: 3.0, outputPerMTok: 15.0 });
  });

  it('returns undefined for unknown models', () => {
    expect(getPricing('not-real')).toBeUndefined();
  });
});

describe('DEFAULT_PRICING', () => {
  it('covers all currently-shipping Claude 4.x models', () => {
    for (const key of ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5']) {
      expect(DEFAULT_PRICING[key]).toBeDefined();
    }
  });
});
