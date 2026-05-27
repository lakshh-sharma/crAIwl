import { describe, expect, it } from 'vitest';
import { parseStrategyConfig, type StrategyConfigInput } from '@craiwl/core';
import { execute } from './execute.js';

const FIXED_NOW = () => new Date('2026-01-15T12:00:00.000Z');

function buildConfig(
  pageTemplates: StrategyConfigInput['pageTemplates'],
  overrides: Partial<StrategyConfigInput> = {},
) {
  return parseStrategyConfig({
    strategyVersion: '1.0.0',
    createdBy: 'test',
    createdAt: '2026-01-15T12:00:00.000Z',
    lastValidated: null,
    reason: 'compile',
    target: { entryUrl: 'https://example.com/', scope: 'single' },
    goal: 'test',
    pageTemplates,
    pagination: { type: 'none' },
    fetchProfile: 'static',
    confidenceFloor: 0.8,
    ...overrides,
  });
}

const pricingHtml = `<!doctype html>
<html><body>
  <main>
    <section class="pricing-card" data-tier="basic">
      <h3 class="plan-name">Basic</h3>
      <div class="price">$9</div>
    </section>
    <section class="pricing-card" data-tier="pro">
      <h3 class="plan-name">Pro</h3>
      <div class="price">$29</div>
    </section>
    <section class="pricing-card" data-tier="enterprise">
      <h3 class="plan-name">Enterprise</h3>
      <div class="price">Contact us</div>
    </section>
  </main>
</body></html>`;

describe('execute: single-record page', () => {
  it('extracts each field from the first locator that resolves', async () => {
    const html = `<article><h1 id="t">Title</h1><p class="summary">A summary.</p></article>`;
    const config = buildConfig([
      {
        id: 'page',
        multiRecord: false,
        fields: {
          title: {
            locators: ['#t', 'h1'],
            semanticAnchor: 'title',
            type: 'string',
            required: true,
          },
          summary: {
            locators: ['.summary'],
            semanticAnchor: 'summary',
            type: 'string',
            required: false,
          },
        },
      },
    ]);

    const r = execute({
      cleanedHtml: html,
      config,
      sourceUrl: 'https://example.com/page',
      now: FIXED_NOW,
    });
    expect(r.records).toHaveLength(1);
    const rec = r.records[0]!;
    expect(rec.fields['title']).toMatchObject({
      ok: true,
      value: 'Title',
      locator: '#t',
      rawText: 'Title',
    });
    expect(rec.fields['summary']).toMatchObject({ ok: true, value: 'A summary.' });
    expect(rec.sourceUrl).toBe('https://example.com/page');
    expect(rec.extractedAt).toBe('2026-01-15T12:00:00.000Z');
  });

  it('falls back to the next locator when the first one misses', async () => {
    const html = `<article><h1>Title</h1></article>`;
    const config = buildConfig([
      {
        id: 'page',
        multiRecord: false,
        fields: {
          title: {
            locators: ['#missing', 'h1'],
            semanticAnchor: 'title',
            type: 'string',
            required: true,
          },
        },
      },
    ]);
    const r = execute({ cleanedHtml: html, config, sourceUrl: 'https://x', now: FIXED_NOW });
    const outcome = r.records[0]!.fields['title']!;
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.locator).toBe('h1');
  });

  it('reports locator-miss when no locator resolves', async () => {
    const html = `<article></article>`;
    const config = buildConfig([
      {
        id: 'page',
        multiRecord: false,
        fields: {
          title: {
            locators: ['#nope', '.nope'],
            semanticAnchor: 'title',
            type: 'string',
            required: true,
          },
        },
      },
    ]);
    const r = execute({ cleanedHtml: html, config, sourceUrl: 'https://x', now: FIXED_NOW });
    const outcome = r.records[0]!.fields['title']!;
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe('locator-miss');
      expect(outcome.attempts).toHaveLength(2);
    }
  });
});

describe('execute: multi-record page', () => {
  it('emits one record per matchHeuristic match', async () => {
    const config = buildConfig([
      {
        id: 'pricing',
        multiRecord: true,
        matchHeuristic: '.pricing-card',
        fields: {
          plan: {
            locators: ['.plan-name'],
            semanticAnchor: 'plan name',
            type: 'string',
            required: true,
          },
          price: {
            locators: ['.price'],
            semanticAnchor: 'price',
            type: 'string',
            required: true,
          },
        },
      },
    ]);
    const r = execute({
      cleanedHtml: pricingHtml,
      config,
      sourceUrl: 'https://x/pricing',
      now: FIXED_NOW,
    });
    expect(r.records).toHaveLength(3);
    expect(r.perTemplate).toEqual({ pricing: 3 });
    const plans = r.records.map((rec) => (rec.fields['plan'] as { ok: true; value: string }).value);
    expect(plans).toEqual(['Basic', 'Pro', 'Enterprise']);
  });

  it('scopes field locators to the matched element, not the whole page', async () => {
    const html = `<section class="card"><span class="n">A</span></section>
                  <section class="card"><span class="n">B</span></section>`;
    const config = buildConfig([
      {
        id: 'cards',
        multiRecord: true,
        matchHeuristic: '.card',
        fields: {
          n: { locators: ['.n'], semanticAnchor: 'n', type: 'string', required: true },
        },
      },
    ]);
    const r = execute({ cleanedHtml: html, config, sourceUrl: 'https://x', now: FIXED_NOW });
    const values = r.records.map((rec) => (rec.fields['n'] as { ok: true; value: string }).value);
    expect(values).toEqual(['A', 'B']);
  });
});

describe('execute: transforms + validate + type coercion', () => {
  it('applies transforms before validation', async () => {
    const config = buildConfig([
      {
        id: 'pricing',
        multiRecord: true,
        matchHeuristic: '.pricing-card',
        fields: {
          price: {
            locators: ['.price'],
            semanticAnchor: 'price',
            type: 'number',
            transform: 'stripCurrency|toFloat',
            validate: 'value>=0 && value<10000',
            required: false,
          },
        },
      },
    ]);
    const r = execute({
      cleanedHtml: pricingHtml,
      config,
      sourceUrl: 'https://x',
      now: FIXED_NOW,
    });
    // Basic + Pro should pass; Enterprise ("Contact us") fails toFloat coercion.
    const outcomes = r.records.map((rec) => rec.fields['price']!);
    expect(outcomes[0]).toMatchObject({ ok: true, value: 9 });
    expect(outcomes[1]).toMatchObject({ ok: true, value: 29 });
    expect(outcomes[2]!.ok).toBe(false);
  });

  it('reports validation-fail when the value resolves but fails validate', async () => {
    const html = `<div class="price">99999</div>`;
    const config = buildConfig([
      {
        id: 'page',
        multiRecord: false,
        fields: {
          price: {
            locators: ['.price'],
            semanticAnchor: 'price',
            type: 'number',
            validate: 'value<1000',
            required: true,
          },
        },
      },
    ]);
    const r = execute({ cleanedHtml: html, config, sourceUrl: 'https://x', now: FIXED_NOW });
    const outcome = r.records[0]!.fields['price']!;
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('validation-fail');
  });

  it('coerces date strings to ISO-8601', async () => {
    const html = `<time>2025-01-15T12:00:00Z</time>`;
    const config = buildConfig([
      {
        id: 'page',
        multiRecord: false,
        fields: {
          published: {
            locators: ['time'],
            semanticAnchor: 'date',
            type: 'date',
            required: true,
          },
        },
      },
    ]);
    const r = execute({ cleanedHtml: html, config, sourceUrl: 'https://x', now: FIXED_NOW });
    const outcome = r.records[0]!.fields['published']!;
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.value).toMatch(/^2025-01-15T/);
  });

  it('coerces url-typed fields', async () => {
    const html = `<a class="link" href="https://example.com/x">https://example.com/x</a>`;
    const config = buildConfig([
      {
        id: 'page',
        multiRecord: false,
        fields: {
          link: {
            locators: ['.link'],
            semanticAnchor: 'link',
            type: 'url',
            required: true,
          },
        },
      },
    ]);
    const r = execute({ cleanedHtml: html, config, sourceUrl: 'https://x', now: FIXED_NOW });
    const outcome = r.records[0]!.fields['link']!;
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.value).toBe('https://example.com/x');
  });

  it('handles XPath locators', async () => {
    const html = `<article><h1>Title</h1></article>`;
    const config = buildConfig([
      {
        id: 'page',
        multiRecord: false,
        fields: {
          title: {
            locators: ['//h1'],
            semanticAnchor: 'title',
            type: 'string',
            required: true,
          },
        },
      },
    ]);
    const r = execute({ cleanedHtml: html, config, sourceUrl: 'https://x', now: FIXED_NOW });
    expect(r.records[0]!.fields['title']).toMatchObject({ ok: true, value: 'Title' });
  });
});

describe('execute: accounting', () => {
  it('counts successes + failures and reports timing', async () => {
    const html = `<article><h1>Title</h1></article>`;
    const config = buildConfig([
      {
        id: 'page',
        multiRecord: false,
        fields: {
          title: { locators: ['h1'], semanticAnchor: 't', type: 'string', required: true },
          missing: { locators: ['.nope'], semanticAnchor: 'm', type: 'string', required: false },
        },
      },
    ]);
    const r = execute({ cleanedHtml: html, config, sourceUrl: 'https://x', now: FIXED_NOW });
    expect(r.successCount).toBe(1);
    expect(r.failureCount).toBe(1);
    expect(r.timingMs).toBeGreaterThanOrEqual(0);
  });
});
