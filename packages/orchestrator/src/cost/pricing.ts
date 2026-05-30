/**
 * Per-model pricing for LLM cost estimates.
 *
 * Numbers are dollars-per-million-tokens, matching Anthropic's published
 * input/output prices. Treat them as estimates: actual billing may include
 * cache-read discounts, batch-mode pricing, or rate-tier adjustments that
 * we don't model here. Pass a custom table to `estimateUsd` if your
 * billing differs.
 *
 * Unknown models return 0 rather than throwing — the orchestrator surfaces
 * usage counts regardless of whether we have a price for the model, and
 * an unknown price is better than a wrong-by-default one.
 */

export type ModelPricing = {
  /** Dollars per 1,000,000 input tokens. */
  inputPerMTok: number;
  /** Dollars per 1,000,000 output tokens. */
  outputPerMTok: number;
};

export const DEFAULT_PRICING: Record<string, ModelPricing> = {
  // Claude 4.x — Anthropic's current generation.
  'claude-opus-4-7': { inputPerMTok: 15.0, outputPerMTok: 75.0 },
  'claude-opus-4-6': { inputPerMTok: 15.0, outputPerMTok: 75.0 },
  'claude-sonnet-4-6': { inputPerMTok: 3.0, outputPerMTok: 15.0 },
  'claude-sonnet-4-5': { inputPerMTok: 3.0, outputPerMTok: 15.0 },
  'claude-haiku-4-5-20251001': { inputPerMTok: 0.8, outputPerMTok: 4.0 },
  'claude-haiku-4-5': { inputPerMTok: 0.8, outputPerMTok: 4.0 },
  // Test/mock models — explicit zero so tests don't accidentally flag cost.
  'mock-llm': { inputPerMTok: 0, outputPerMTok: 0 },
  'mock-claude': { inputPerMTok: 0, outputPerMTok: 0 },
  'mock-claude-test': { inputPerMTok: 0, outputPerMTok: 0 },
};

export function estimateUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  pricing: Record<string, ModelPricing> = DEFAULT_PRICING,
): number {
  const p = pricing[model];
  if (!p) return 0;
  const usd =
    (inputTokens / 1_000_000) * p.inputPerMTok + (outputTokens / 1_000_000) * p.outputPerMTok;
  // Round to four decimal places so manifests stay readable on small runs.
  return Math.round(usd * 10_000) / 10_000;
}

export function getPricing(model: string): ModelPricing | undefined {
  return DEFAULT_PRICING[model];
}
