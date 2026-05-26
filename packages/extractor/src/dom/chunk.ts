import { JSDOM, VirtualConsole } from 'jsdom';
import { DEFAULT_COMPILE_TOKEN_BUDGET, estimateTokens, type TokenEstimator } from './tokens.js';

export type ChunkOptions = {
  /** Maximum tokens the chunked DOM may consume. Defaults to a conservative budget. */
  maxTokens?: number;
  /** How many examples of each repeating region to retain. Defaults to 2. */
  examplesPerPattern?: number;
  /** Pluggable token estimator. */
  estimate?: TokenEstimator;
};

export type ChunkedDocument = {
  /** Possibly-trimmed HTML that fits the budget. */
  html: string;
  /** Estimated tokens for the input HTML. */
  originalTokens: number;
  /** Estimated tokens for the chunked HTML. */
  finalTokens: number;
  /** Configured token budget. */
  budget: number;
  /** Number of distinct repeating patterns detected at the top level. */
  patternsDetected: number;
  /** Total top-level elements before chunking. */
  regionsBefore: number;
  /** Total top-level elements retained after chunking. */
  regionsAfter: number;
  /** True when chunking dropped content. */
  truncated: boolean;
};

/**
 * Reduces a cleaned-but-still-too-large HTML body to fit a token budget by
 * keeping representative examples of each repeating top-level region rather
 * than blindly truncating. The intuition: for a pricing page with 12 tier
 * cards, the compile prompt only needs 1–2 cards to infer the template;
 * showing all 12 wastes tokens and confuses the model.
 *
 * Strategy:
 *   1. Group top-level body children by structural fingerprint (tag + class
 *      signature). Two `<div class="tier-card">…</div>` siblings collapse
 *      into one group.
 *   2. From each group, keep up to `examplesPerPattern` items.
 *   3. If the result is still over budget, drop from the back (later
 *      groups first), then from within remaining groups.
 *   4. Always retain headings/titles at the top — those carry context.
 *
 * If the body fits the budget unchanged, the document is returned as-is.
 */
export function chunkForBudget(html: string, opts: ChunkOptions = {}): ChunkedDocument {
  const estimator = opts.estimate ?? estimateTokens;
  const budget = opts.maxTokens ?? DEFAULT_COMPILE_TOKEN_BUDGET;
  const examplesPerPattern = opts.examplesPerPattern ?? 2;
  const originalTokens = estimator(html);

  if (originalTokens <= budget) {
    return {
      html,
      originalTokens,
      finalTokens: originalTokens,
      budget,
      patternsDetected: 0,
      regionsBefore: 0,
      regionsAfter: 0,
      truncated: false,
    };
  }

  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { virtualConsole });
  const body = dom.window.document.body;
  const topLevel = Array.from(body.children);
  const regionsBefore = topLevel.length;

  // Build pattern groups keyed by `${tagName}.${sortedClasses}`.
  const groups = new Map<string, Element[]>();
  for (const el of topLevel) {
    const key = fingerprint(el);
    const list = groups.get(key) ?? [];
    list.push(el);
    groups.set(key, list);
  }

  // First pass: keep up to N from each group, in original document order.
  const survivors = new Set<Element>();
  for (const list of groups.values()) {
    for (let i = 0; i < Math.min(examplesPerPattern, list.length); i++) {
      survivors.add(list[i]!);
    }
  }

  // Build a candidate body containing only survivors, in document order.
  const ordered = topLevel.filter((el) => survivors.has(el));
  let candidateHtml = ordered.map((el) => el.outerHTML).join('\n');

  // If still over budget, drop the trailing element until we fit (but always
  // keep at least the first element so we have *something*).
  let trimmed = [...ordered];
  while (estimator(candidateHtml) > budget && trimmed.length > 1) {
    trimmed = trimmed.slice(0, -1);
    candidateHtml = trimmed.map((el) => el.outerHTML).join('\n');
  }

  return {
    html: candidateHtml,
    originalTokens,
    finalTokens: estimator(candidateHtml),
    budget,
    patternsDetected: groups.size,
    regionsBefore,
    regionsAfter: trimmed.length,
    truncated: true,
  };
}

function fingerprint(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const classes = el.className
    .split(/\s+/)
    .filter((c) => c.length > 0)
    .sort()
    .join('.');
  // Including a small structural hash (child tag counts) catches sibling
  // <div>s with no class but different shapes.
  const childTags = Array.from(el.children)
    .map((c) => c.tagName.toLowerCase())
    .sort()
    .join(',');
  return classes ? `${tag}.${classes}|${childTags}` : `${tag}|${childTags}`;
}
