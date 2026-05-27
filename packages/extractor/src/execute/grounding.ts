/**
 * Extractive grounding guard.
 *
 * Every extracted value MUST trace back to text that's actually on the page.
 * The rawText the executor recorded is the bridge: if it appears verbatim in
 * the source DOM's textContent, the value is grounded. Values that fail this
 * check are flagged and routed to review rather than silently emitted as
 * clean output — the failure mode that turns a useful tool into a fabricator.
 *
 * The check is intentionally narrow. We don't try to verify that the
 * transform pipeline was "right" or that the validate predicate "should
 * have" passed. We only verify that the source string exists. The
 * transform chain itself is deterministic (see `core/strategy/transforms`),
 * so a value derived from grounded text is grounded by construction.
 */

const WHITESPACE_RUN = /\s+/g;

export type GroundingResult = {
  grounded: boolean;
  /**
   * Reason when not grounded. The most common failure is `not-in-source` —
   * the rawText isn't a substring of the page text. `empty-source` and
   * `empty-text` flag the degenerate cases.
   */
  reason?: 'not-in-source' | 'empty-source' | 'empty-text';
};

/**
 * Returns the normalized text representation we compare against. Production
 * pages have inconsistent whitespace, so collapse runs of whitespace to a
 * single space on both sides before substring matching.
 */
export function normalizeForGrounding(text: string): string {
  return text.replace(WHITESPACE_RUN, ' ').trim();
}

/**
 * Check whether `rawText` traces back to `sourceText`. Both are normalized
 * (collapse whitespace runs, trim) before the substring check so we don't
 * fail on cosmetic differences between DOM serialization and the live tree.
 */
export function checkGrounding(rawText: string, sourceText: string): GroundingResult {
  const source = normalizeForGrounding(sourceText);
  const value = normalizeForGrounding(rawText);
  if (!source) return { grounded: false, reason: 'empty-source' };
  if (!value) return { grounded: false, reason: 'empty-text' };
  return source.includes(value) ? { grounded: true } : { grounded: false, reason: 'not-in-source' };
}
