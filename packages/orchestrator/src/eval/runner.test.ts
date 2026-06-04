import { describe, expect, it } from 'vitest';
import { parseStrategyConfig, type StrategyConfigInput } from '@craiwl/core';
import { runEval } from './runner.js';
import type { EvalFixture } from './types.js';

const FIXED_NOW = () => new Date('2026-06-04T12:00:00.000Z');

const LOREM = Array.from({ length: 6 })
  .map(
    () =>
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
  )
  .join(' ');

const article = (title: string, price: string): string => `<!doctype html>
<html><head><title>${title}</title></head><body><main><article>
  <p class="article-title">${title}</p>
  <p class="article-price">${price}</p>
  <p>${LOREM}</p>
  <p>${LOREM}</p>
</article></main></body></html>`;

const baseConfig = parseStrategyConfig({
  strategyVersion: '1.1.0',
  createdBy: 'fixture',
  createdAt: '2026-05-01T00:00:00.000Z',
  lastValidated: null,
  reason: 'compile',
  target: { entryUrl: 'https://example.com', scope: 'section' },
  goal: 'extract title + price',
  pageTemplates: [
    {
      id: 'page',
      multiRecord: false,
      fields: {
        title: {
          locators: ['p.article-title'],
          semanticAnchor: 'article title',
          type: 'string',
          required: true,
        },
        price: {
          locators: ['p.article-price'],
          semanticAnchor: 'article price',
          type: 'number',
          required: true,
          transform: 'stripCurrency|toFloat',
        },
      },
    },
  ],
  pagination: { type: 'none' },
  fetchProfile: 'static',
  confidenceFloor: 0.8,
} as StrategyConfigInput);

const mkFixture = (
  pages: Array<{
    sourceUrl: string;
    html: string;
    expected: Array<{ fields: Record<string, { value: unknown }> }>;
  }>,
): EvalFixture => ({
  name: 'sample',
  config: baseConfig,
  pages,
});

describe('runEval', () => {
  it('passes when the executor matches the expected records', () => {
    const fx = mkFixture([
      {
        sourceUrl: 'https://example.com/a',
        html: article('Hello A', '$9'),
        expected: [{ fields: { title: { value: 'Hello A' }, price: { value: 9 } } }],
      },
      {
        sourceUrl: 'https://example.com/b',
        html: article('Hello B', '$29'),
        expected: [{ fields: { title: { value: 'Hello B' }, price: { value: 29 } } }],
      },
    ]);
    const report = runEval([fx], { now: FIXED_NOW });
    expect(report.totals.fixtures).toBe(1);
    expect(report.totals.fixturesPassed).toBe(1);
    expect(report.totals.pages).toBe(2);
    expect(report.totals.pagesPassed).toBe(2);
    expect(report.totals.fieldsOk).toBe(4);
    expect(report.totals.fieldsFailed).toBe(0);
    expect(report.fixtures[0]!.ok).toBe(true);
  });

  it('reports value-mismatch when an expected value disagrees', () => {
    const fx = mkFixture([
      {
        sourceUrl: 'https://example.com/a',
        html: article('Hello A', '$9'),
        expected: [{ fields: { title: { value: 'Hello A' }, price: { value: 99 } } }],
      },
    ]);
    const report = runEval([fx], { now: FIXED_NOW });
    expect(report.fixtures[0]!.ok).toBe(false);
    const recDiff = report.fixtures[0]!.pages[0]!.records[0]!;
    expect(recDiff.fields['title']?.kind).toBe('ok');
    const pf = recDiff.fields['price'];
    expect(pf?.kind).toBe('value-mismatch');
    if (pf?.kind === 'value-mismatch') {
      expect(pf.expected).toBe(99);
      expect(pf.actual).toBe(9);
    }
  });

  it('flags missing-field when the executor produced no field outcome', () => {
    const fx = mkFixture([
      {
        sourceUrl: 'https://example.com/a',
        html: article('Hello A', '$9'),
        expected: [
          {
            fields: {
              title: { value: 'Hello A' },
              price: { value: 9 },
              author: { value: 'someone' },
            },
          },
        ],
      },
    ]);
    const report = runEval([fx], { now: FIXED_NOW });
    const recDiff = report.fixtures[0]!.pages[0]!.records[0]!;
    expect(recDiff.fields['author']?.kind).toBe('missing-field');
    expect(report.fixtures[0]!.ok).toBe(false);
  });

  it('fails the page when the executor produces extra records', () => {
    // Single-record template, but the expected list is empty.
    const fx = mkFixture([
      {
        sourceUrl: 'https://example.com/a',
        html: article('Hello A', '$9'),
        expected: [],
      },
    ]);
    const report = runEval([fx], { now: FIXED_NOW });
    expect(report.fixtures[0]!.pages[0]!.ok).toBe(false);
    expect(report.fixtures[0]!.pages[0]!.extra.length).toBe(1);
  });

  it('treats exact: false as presence-only', () => {
    const fx = mkFixture([
      {
        sourceUrl: 'https://example.com/a',
        html: article('Hello A', '$9'),
        // price value is wrong but exact: false means we just want the field present
        expected: [
          {
            fields: {
              title: { value: 'Hello A' },
              price: { value: 999, exact: false },
            } as Record<string, { value: unknown; exact?: boolean }>,
          },
        ],
      },
    ]);
    const report = runEval([fx], { now: FIXED_NOW });
    expect(report.fixtures[0]!.ok).toBe(true);
  });

  it('aggregates totals across multiple fixtures', () => {
    const a = mkFixture([
      {
        sourceUrl: 'https://example.com/a',
        html: article('Hello A', '$9'),
        expected: [{ fields: { title: { value: 'Hello A' }, price: { value: 9 } } }],
      },
    ]);
    const b = mkFixture([
      {
        sourceUrl: 'https://example.com/b',
        html: article('Hello B', '$29'),
        expected: [{ fields: { title: { value: 'WRONG' }, price: { value: 29 } } }],
      },
    ]);
    b.name = 'b';
    const report = runEval([a, b], { now: FIXED_NOW });
    expect(report.totals.fixtures).toBe(2);
    expect(report.totals.fixturesPassed).toBe(1);
  });
});
