/**
 * Confidence score for an extracted field.
 *
 * Inputs:
 *  - locatorRank: 0-based index of the locator that worked (0 = first choice).
 *  - totalLocators: how many ranked candidates the config offered for the field.
 *  - grounded: whether the rawText traced back to source DOM (extractive grounding).
 *  - hadValidate: whether the field had a `validate` predicate, which (since it
 *    passed) is evidence the value is in the expected shape.
 *
 * Formula (intentionally conservative):
 *   start at 1.0
 *   subtract a small penalty for using a fallback locator (up to 0.2 across all ranks)
 *   subtract a large penalty when not grounded (0.5)
 *   add a small boost when a validate predicate ran and passed (0.05)
 *   clamp to [0, 1]
 *
 * The exact numbers are tunable — the contract is that grounded + first-locator
 * + validate-passed should round-trip to 1.0, and ungrounded should always fall
 * below a reasonable confidenceFloor (0.8).
 */

export type ConfidenceInputs = {
  locatorRank: number;
  totalLocators: number;
  grounded: boolean;
  hadValidate: boolean;
};

const MAX_LOCATOR_PENALTY = 0.2;
const UNGROUNDED_PENALTY = 0.5;
const VALIDATE_BONUS = 0.05;

export function scoreConfidence(inputs: ConfidenceInputs): number {
  const { locatorRank, totalLocators, grounded, hadValidate } = inputs;
  const denom = Math.max(1, totalLocators - 1);
  const locatorPenalty = totalLocators <= 1 ? 0 : (locatorRank / denom) * MAX_LOCATOR_PENALTY;
  const groundingPenalty = grounded ? 0 : UNGROUNDED_PENALTY;
  const validateBonus = hadValidate ? VALIDATE_BONUS : 0;
  const score = 1.0 - locatorPenalty - groundingPenalty + validateBonus;
  return clamp01(score);
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
