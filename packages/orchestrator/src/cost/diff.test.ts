import { describe, expect, it } from 'vitest';
import type { ExtractedRecord, FieldOutcome } from '@craiwl/extractor';
import { diffRuns } from './diff.js';

const ok = (value: unknown, locator = '.x'): FieldOutcome => ({
  ok: true,
  value,
  locator,
  locatorRank: 0,
  rawText: String(value),
  grounded: true,
  confidence: 1,
});

const miss: FieldOutcome = { ok: false, reason: 'locator-miss', attempts: [] };

const record = (
  sourceUrl: string,
  templateId: string,
  fields: Record<string, FieldOutcome>,
): ExtractedRecord => ({
  sourceUrl,
  templateId,
  extractedAt: '2026-05-29T12:00:00.000Z',
  fields,
});

describe('diffRuns', () => {
  it('marks records present in current but not in previous as added', () => {
    const prev: ExtractedRecord[] = [];
    const curr = [record('https://x/a', 'page', { title: ok('A') })];
    const d = diffRuns(prev, curr);
    expect(d.added).toHaveLength(1);
    expect(d.removed).toEqual([]);
    expect(d.changed).toEqual([]);
  });

  it('marks records present in previous but not in current as removed', () => {
    const prev = [record('https://x/a', 'page', { title: ok('A') })];
    const curr: ExtractedRecord[] = [];
    const d = diffRuns(prev, curr);
    expect(d.removed).toHaveLength(1);
    expect(d.added).toEqual([]);
  });

  it('marks records with the same key but different values as changed', () => {
    const prev = [record('https://x/a', 'page', { title: ok('Old'), price: ok(9) })];
    const curr = [record('https://x/a', 'page', { title: ok('New'), price: ok(9) })];
    const d = diffRuns(prev, curr);
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0]!.fieldChanges).toEqual([{ field: 'title', before: 'Old', after: 'New' }]);
  });

  it('counts unchanged records that match exactly across runs', () => {
    const r = record('https://x/a', 'page', { title: ok('Stable') });
    const d = diffRuns([r], [r]);
    expect(d.unchangedCount).toBe(1);
    expect(d.changed).toEqual([]);
  });

  it('treats failed-vs-extracted as a field change', () => {
    const prev = [record('https://x/a', 'page', { title: miss })];
    const curr = [record('https://x/a', 'page', { title: ok('Now Works') })];
    const d = diffRuns(prev, curr);
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0]!.fieldChanges[0]).toEqual({
      field: 'title',
      before: null,
      after: 'Now Works',
    });
  });

  it('keys multi-record pages by position-in-page', () => {
    const prev = [
      record('https://x/p', 'card', { name: ok('Alpha') }),
      record('https://x/p', 'card', { name: ok('Beta') }),
    ];
    const curr = [
      record('https://x/p', 'card', { name: ok('Alpha') }),
      record('https://x/p', 'card', { name: ok('Gamma') }),
    ];
    const d = diffRuns(prev, curr);
    // Position 0 unchanged, position 1 changed.
    expect(d.unchangedCount).toBe(1);
    expect(d.changed).toHaveLength(1);
  });

  it('reports counts for both sides', () => {
    const prev = [record('https://x/a', 'page', { x: ok(1) })];
    const curr = [
      record('https://x/a', 'page', { x: ok(1) }),
      record('https://x/b', 'page', { x: ok(2) }),
    ];
    const d = diffRuns(prev, curr);
    expect(d.previousCount).toBe(1);
    expect(d.currentCount).toBe(2);
  });

  it('handles records with object-valued fields', () => {
    const prev = [record('https://x/a', 'page', { tags: ok({ a: 1, b: 2 }) })];
    const curr = [record('https://x/a', 'page', { tags: ok({ a: 1, b: 2 }) })];
    expect(diffRuns(prev, curr).unchangedCount).toBe(1);

    const curr2 = [record('https://x/a', 'page', { tags: ok({ a: 1, b: 3 }) })];
    expect(diffRuns(prev, curr2).changed).toHaveLength(1);
  });
});
