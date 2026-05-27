import { describe, expect, it } from 'vitest';
import { MockLLMProvider } from '@craiwl/core';
import { synthesizeLocators } from './synthesize.js';
import type { FieldSchemaItem } from './field-schema.js';

const pricingHtml = `<!doctype html>
<html><body>
  <main>
    <section class="pricing-card" data-tier="basic">
      <h3 class="plan-name">Basic</h3>
      <div class="price">$9</div>
      <ul class="features"><li>Feature 1</li></ul>
    </section>
    <section class="pricing-card" data-tier="pro">
      <h3 class="plan-name">Pro</h3>
      <div class="price">$29</div>
      <ul class="features"><li>Feature 2</li></ul>
    </section>
  </main>
</body></html>`;

const docHtml = `<!doctype html>
<html><body>
  <article class="doc">
    <h1 id="page-title">Quickstart</h1>
    <p class="doc-summary">Learn the basics in five minutes.</p>
    <time datetime="2025-01-01">January 1, 2025</time>
  </article>
</body></html>`;

const fields = (...items: Partial<FieldSchemaItem>[]): FieldSchemaItem[] =>
  items.map(
    (i) =>
      ({
        name: 'x',
        type: 'string',
        required: true,
        description: '',
        inferred: true,
        ...i,
      }) as FieldSchemaItem,
  );

const respondWith = (payload: unknown) => new MockLLMProvider(() => payload);

describe('synthesizeLocators', () => {
  it('keeps locators that resolve against the DOM and drops ones that do not', async () => {
    const llm = respondWith({
      multiRecord: true,
      matchHeuristic: '.pricing-card',
      fields: [
        {
          name: 'plan-name',
          locators: ['.pricing-card .plan-name', '.does-not-exist'],
          semanticAnchor: 'the plan name in the card header',
        },
        {
          name: 'price',
          locators: ['.pricing-card .price', '.pricing-card div.price'],
          semanticAnchor: 'monthly price of the plan',
          transform: 'stripCurrency|toFloat',
          validate: 'value>=0 && value<100000',
        },
      ],
    });
    const r = await synthesizeLocators({
      cleanedHtml: pricingHtml,
      fields: fields(
        { name: 'plan-name', type: 'string', required: true },
        { name: 'price', type: 'number', required: true },
      ),
      llm,
    });
    expect(r.multiRecord).toBe(true);
    expect(r.matchHeuristic).toBe('.pricing-card');

    const byName = Object.fromEntries(r.fields.map((f) => [f.name, f]));
    expect(byName['plan-name']!.locators).toEqual(['.pricing-card .plan-name']);
    expect(byName['price']!.locators).toEqual(['.pricing-card .price', '.pricing-card div.price']);
    expect(byName['price']!.transform).toBe('stripCurrency|toFloat');
    expect(byName['price']!.validate).toBe('value>=0 && value<100000');
    expect(r.unresolvedRequired).toEqual([]);
  });

  it('flags a required field when every proposed locator fails', async () => {
    const llm = respondWith({
      multiRecord: false,
      fields: [
        {
          name: 'title',
          locators: ['.no-match-one', '.no-match-two'],
          semanticAnchor: 'page title',
        },
      ],
    });
    const r = await synthesizeLocators({
      cleanedHtml: docHtml,
      fields: fields({ name: 'title', type: 'string', required: true }),
      llm,
    });
    expect(r.fields).toEqual([]);
    expect(r.unresolvedRequired).toEqual(['title']);
  });

  it('drops a non-required field with zero working locators without flagging unresolvedRequired', async () => {
    const llm = respondWith({
      multiRecord: false,
      fields: [
        {
          name: 'title',
          locators: ['#page-title', 'h1'],
          semanticAnchor: 'title',
        },
        {
          name: 'subtitle',
          locators: ['.does-not-exist', '.also-missing'],
          semanticAnchor: 'subtitle',
        },
      ],
    });
    const r = await synthesizeLocators({
      cleanedHtml: docHtml,
      fields: fields(
        { name: 'title', type: 'string', required: true },
        { name: 'subtitle', type: 'string', required: false },
      ),
      llm,
    });
    expect(r.fields.map((f) => f.name)).toEqual(['title']);
    expect(r.unresolvedRequired).toEqual([]);
  });

  it('ignores fields the model invents that are not in the input schema', async () => {
    const llm = respondWith({
      multiRecord: false,
      fields: [
        { name: 'title', locators: ['#page-title', 'h1'], semanticAnchor: 'title' },
        {
          name: 'hallucinated-field',
          locators: ['.no-such', '.no-other'],
          semanticAnchor: 'fake',
        },
      ],
    });
    const r = await synthesizeLocators({
      cleanedHtml: docHtml,
      fields: fields({ name: 'title', type: 'string', required: true }),
      llm,
    });
    expect(r.fields.map((f) => f.name)).toEqual(['title']);
  });

  it('exposes per-locator diagnostics, including ones that were rejected', async () => {
    const llm = respondWith({
      multiRecord: false,
      fields: [
        {
          name: 'title',
          locators: ['#page-title', '.does-not-exist'],
          semanticAnchor: 'title',
        },
      ],
    });
    const r = await synthesizeLocators({
      cleanedHtml: docHtml,
      fields: fields({ name: 'title', type: 'string', required: true }),
      llm,
    });
    const tests = r.fields[0]!.locatorTests;
    expect(tests).toHaveLength(2);
    expect(tests[0]).toMatchObject({ resolves: true, matchCount: 1 });
    expect(tests[1]).toMatchObject({ resolves: false, matchCount: 0 });
  });

  it('passes the cleaned DOM through the chunker before sending to the model', async () => {
    let receivedUserText = '';
    const llm = new MockLLMProvider((_, opts) => {
      receivedUserText = opts.messages[0]!.content;
      return {
        multiRecord: false,
        fields: [{ name: 'title', locators: ['#page-title', 'h1'], semanticAnchor: 'title' }],
      };
    });
    await synthesizeLocators({
      cleanedHtml: docHtml,
      fields: fields({ name: 'title', type: 'string', required: true }),
      llm,
    });
    expect(receivedUserText).toContain('Cleaned DOM:');
    expect(receivedUserText).toContain('Quickstart');
  });

  it('supports XPath locators', async () => {
    const llm = respondWith({
      multiRecord: false,
      fields: [
        {
          name: 'title',
          locators: ['//h1[@id="page-title"]', '//article//h1'],
          semanticAnchor: 'title',
        },
      ],
    });
    const r = await synthesizeLocators({
      cleanedHtml: docHtml,
      fields: fields({ name: 'title', type: 'string', required: true }),
      llm,
    });
    expect(r.fields[0]!.locators).toHaveLength(2);
  });
});
