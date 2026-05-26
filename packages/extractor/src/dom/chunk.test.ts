import { describe, it, expect } from 'vitest';
import { chunkForBudget, estimateTokens } from './index.js';

const makeCard = (i: number) =>
  `<div class="tier-card"><h3>Tier ${i}</h3><span data-testid="price">$${i * 10}</span><p>${'feature '.repeat(20)}</p></div>`;

describe('estimateTokens', () => {
  it('returns 0 for empty input', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('scales roughly with string length', () => {
    expect(estimateTokens('x'.repeat(400))).toBe(100); // 400 / 4
  });
});

describe('chunkForBudget', () => {
  it('passes through documents that already fit the budget', () => {
    const html = '<h1>Pricing</h1><div class="tier-card">a</div>';
    const result = chunkForBudget(html, { maxTokens: 1_000 });
    expect(result.truncated).toBe(false);
    expect(result.html).toBe(html);
    expect(result.originalTokens).toBe(result.finalTokens);
  });

  it('collapses many identical regions to a handful of examples', () => {
    const html = '<h1>Pricing</h1>' + Array.from({ length: 12 }, (_, i) => makeCard(i)).join('');
    const result = chunkForBudget(html, { maxTokens: 200, examplesPerPattern: 2 });
    expect(result.truncated).toBe(true);
    expect(result.regionsBefore).toBeGreaterThan(result.regionsAfter);
    expect(result.finalTokens).toBeLessThanOrEqual(200);
    expect(result.patternsDetected).toBeGreaterThanOrEqual(1);
    // Should keep at least one <h1> (the heading is its own pattern) plus one card.
    expect(result.html).toContain('<h1');
    expect(result.html).toContain('class="tier-card"');
  });

  it('keeps at least one element even when the budget is impossibly small', () => {
    const html = Array.from({ length: 5 }, (_, i) => makeCard(i)).join('');
    const result = chunkForBudget(html, { maxTokens: 5 });
    expect(result.regionsAfter).toBeGreaterThanOrEqual(1);
    expect(result.html.length).toBeGreaterThan(0);
  });

  it('detects multiple distinct patterns at the top level', () => {
    const html =
      '<header>head</header>' +
      Array.from({ length: 4 }, (_, i) => makeCard(i)).join('') +
      Array.from(
        { length: 4 },
        (_, i) => `<article><h2>Post ${i}</h2><p>${'words '.repeat(30)}</p></article>`,
      ).join('') +
      '<footer>foot</footer>';
    // Force chunking by setting a tight budget — otherwise the early-return
    // skips pattern detection entirely.
    const result = chunkForBudget(html, { maxTokens: 150 });
    expect(result.truncated).toBe(true);
    expect(result.patternsDetected).toBeGreaterThanOrEqual(3);
  });

  it('is deterministic — same input + opts produces the same chunk', () => {
    const html = Array.from({ length: 8 }, (_, i) => makeCard(i)).join('');
    const a = chunkForBudget(html, { maxTokens: 200 });
    const b = chunkForBudget(html, { maxTokens: 200 });
    expect(a).toEqual(b);
  });

  it('respects a custom estimator', () => {
    const html = Array.from({ length: 8 }, (_, i) => makeCard(i)).join('');
    // Estimator that says every char is one token — forces aggressive chunking.
    const result = chunkForBudget(html, {
      maxTokens: 1_000,
      estimate: (s) => s.length,
    });
    // Custom estimator inflates apparent size 4× → chunking should fire and
    // finalTokens should fall well below originalTokens.
    expect(result.truncated).toBe(true);
    expect(result.finalTokens).toBeLessThan(result.originalTokens);
  });
});
