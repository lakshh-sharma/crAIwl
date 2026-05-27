/**
 * Roundtrip: compile → execute on the same page.
 *
 * This is the first place the two phases of the product meet. If this test
 * passes, the contract between the LLM-driven compile output and the
 * deterministic executor is sound — locators that synthesize cleanly also
 * extract cleanly without a network or model call.
 */

import { describe, expect, it } from 'vitest';
import { MockLLMProvider } from '@craiwl/core';
import { execute } from '@craiwl/extractor';
import { compile } from './compile.js';

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
  </main>
</body></html>`;

const respond = (tool: { name: string }) => {
  if (tool.name === 'emit_field_schema') {
    return {
      fields: [
        {
          name: 'plan-name',
          type: 'string',
          required: true,
          description: 'plan title',
          inferred: true,
        },
        {
          name: 'price',
          type: 'number',
          required: true,
          description: 'monthly price',
          inferred: true,
        },
      ],
    };
  }
  return {
    multiRecord: true,
    matchHeuristic: '.pricing-card',
    fields: [
      {
        name: 'plan-name',
        locators: ['.plan-name', 'h3'],
        semanticAnchor: 'plan name',
      },
      {
        name: 'price',
        locators: ['.price', 'div.price'],
        semanticAnchor: 'monthly price',
        transform: 'stripCurrency|toFloat',
        validate: 'value>=0 && value<10000',
      },
    ],
  };
};

describe('compile + execute end-to-end', () => {
  it('compiles a config and executes it back against the same page', async () => {
    const llm = new MockLLMProvider(respond);
    const { config } = await compile({
      entryUrl: 'https://example.com/pricing',
      cleanedHtml: pricingHtml,
      goal: 'extract pricing tiers',
      llm,
      now: () => new Date('2026-01-15T12:00:00.000Z'),
    });

    const result = execute({
      cleanedHtml: pricingHtml,
      config,
      sourceUrl: 'https://example.com/pricing',
      now: () => new Date('2026-01-15T12:00:00.000Z'),
    });

    expect(result.records).toHaveLength(2);
    expect(result.failureCount).toBe(0);

    const plans = result.records.map(
      (r) => (r.fields['plan-name'] as { ok: true; value: string }).value,
    );
    const prices = result.records.map(
      (r) => (r.fields['price'] as { ok: true; value: number }).value,
    );
    expect(plans).toEqual(['Basic', 'Pro']);
    expect(prices).toEqual([9, 29]);
  });
});
