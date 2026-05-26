/**
 * Token estimation for compile-prompt budgeting.
 *
 * This is intentionally a coarse heuristic, not a tokenizer. Real token
 * counts depend on which model we're calling (Anthropic doesn't ship a
 * client-side tokenizer at API parity), and we don't want to pull in a
 * heavy WASM tokenizer just to decide when to start chunking. The ~4-chars-
 * per-token rule of thumb is within ±20% for English HTML on the models
 * we use — fine for budgeting decisions, not fine for billing.
 *
 * When precision matters (cost accounting, billing), prefer the real token
 * count returned by the provider in the response.
 */

export type TokenEstimator = (text: string) => number;

const HEURISTIC_CHARS_PER_TOKEN = 4;

export const estimateTokens: TokenEstimator = (text) => {
  if (!text) return 0;
  return Math.ceil(text.length / HEURISTIC_CHARS_PER_TOKEN);
};

/**
 * Default budget defensively-low. The actual compile prompt also carries
 * instructions, schema, and few-shot examples — leave headroom.
 */
export const DEFAULT_COMPILE_TOKEN_BUDGET = 12_000;
