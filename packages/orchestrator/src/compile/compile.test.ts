import { describe, expect, it } from 'vitest';
import { MockLLMProvider } from '@craiwl/core';
import { compile, CompileError } from './compile.js';

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

const fixedNow = () => new Date('2026-01-15T12:00:00.000Z');

/**
 * Helper: the orchestrator makes TWO LLM calls — first `emit_field_schema`,
 * then `emit_strategy`. This responder dispatches on tool name.
 */
const pricingResponder = (tool: { name: string }) => {
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
  if (tool.name === 'emit_strategy') {
    return {
      multiRecord: true,
      matchHeuristic: '.pricing-card',
      fields: [
        {
          name: 'plan-name',
          locators: ['.pricing-card .plan-name', '.pricing-card h3'],
          semanticAnchor: 'plan title in the pricing card header',
        },
        {
          name: 'price',
          locators: ['.pricing-card .price', '.pricing-card div.price'],
          semanticAnchor: 'monthly price of the plan',
          transform: 'stripCurrency|toFloat',
          validate: 'value>=0 && value<100000',
        },
      ],
    };
  }
  throw new Error(`unexpected tool: ${tool.name}`);
};

describe('compile', () => {
  it('produces a valid StrategyConfig from a goal + cleaned page', async () => {
    const llm = new MockLLMProvider(pricingResponder);
    const r = await compile({
      entryUrl: 'https://example.com/pricing',
      cleanedHtml: pricingHtml,
      goal: 'extract pricing tiers',
      llm,
      now: fixedNow,
    });

    expect(r.config.target.entryUrl).toBe('https://example.com/pricing');
    expect(r.config.goal).toBe('extract pricing tiers');
    expect(r.config.reason).toBe('compile');
    expect(r.config.fetchProfile).toBe('static');
    expect(r.config.createdBy).toBe('mock-llm');
    expect(r.config.createdAt).toBe('2026-01-15T12:00:00.000Z');
    expect(r.config.pageTemplates).toHaveLength(1);

    const tpl = r.config.pageTemplates[0]!;
    expect(tpl.multiRecord).toBe(true);
    expect(tpl.matchHeuristic).toBe('.pricing-card');
    expect(Object.keys(tpl.fields)).toEqual(['plan-name', 'price']);
    expect(tpl.fields['price']!.transform).toBe('stripCurrency|toFloat');
    expect(tpl.fields['price']!.validate).toBe('value>=0 && value<100000');
  });

  it('aggregates token usage across both LLM calls', async () => {
    const llm = new MockLLMProvider(pricingResponder);
    const r = await compile({
      entryUrl: 'https://example.com/pricing',
      cleanedHtml: pricingHtml,
      goal: 'extract pricing tiers',
      llm,
      now: fixedNow,
    });
    expect(r.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it('lets user-specified fields override LLM-inferred ones', async () => {
    const llm = new MockLLMProvider((tool) => {
      if (tool.name === 'emit_field_schema') {
        return {
          fields: [
            {
              name: 'plan-name',
              type: 'string',
              required: true,
              description: 'llm-inferred',
              inferred: true,
            },
          ],
        };
      }
      return {
        multiRecord: false,
        fields: [
          {
            name: 'plan-name',
            locators: ['.pricing-card .plan-name', '.pricing-card h3'],
            semanticAnchor: 'plan name',
          },
        ],
      };
    });
    const r = await compile({
      entryUrl: 'https://example.com/pricing',
      cleanedHtml: pricingHtml,
      goal: 'pricing',
      userFields: [
        { name: 'plan-name', type: 'string', required: true, description: 'user-supplied title' },
      ],
      llm,
      now: fixedNow,
    });
    expect(r.fields[0]).toMatchObject({ inferred: false, description: 'user-supplied title' });
    expect(r.config.pageTemplates[0]!.fields['plan-name']!.description).toBe('user-supplied title');
  });

  it('throws CompileError when a required field has zero working locators', async () => {
    const llm = new MockLLMProvider((tool) => {
      if (tool.name === 'emit_field_schema') {
        return {
          fields: [
            {
              name: 'plan-name',
              type: 'string',
              required: true,
              description: 'plan',
              inferred: true,
            },
          ],
        };
      }
      return {
        multiRecord: false,
        fields: [
          {
            name: 'plan-name',
            locators: ['.does-not-exist', '.also-missing'],
            semanticAnchor: 'plan',
          },
        ],
      };
    });
    await expect(
      compile({
        entryUrl: 'https://example.com/pricing',
        cleanedHtml: pricingHtml,
        goal: 'pricing',
        llm,
      }),
    ).rejects.toBeInstanceOf(CompileError);
  });

  it('honors a custom fetchProfile and scope', async () => {
    const llm = new MockLLMProvider(pricingResponder);
    const r = await compile({
      entryUrl: 'https://example.com/pricing',
      cleanedHtml: pricingHtml,
      goal: 'pricing',
      scope: 'section',
      fetchProfile: 'headless',
      llm,
      now: fixedNow,
    });
    expect(r.config.target.scope).toBe('section');
    expect(r.config.fetchProfile).toBe('headless');
  });

  it('emits a single-record template when the model decides multiRecord=false', async () => {
    const docHtml = `<article><h1 id="t">Doc</h1><p class="s">summary</p></article>`;
    const llm = new MockLLMProvider((tool) => {
      if (tool.name === 'emit_field_schema') {
        return {
          fields: [
            {
              name: 'title',
              type: 'string',
              required: true,
              description: 'doc title',
              inferred: true,
            },
            {
              name: 'summary',
              type: 'string',
              required: false,
              description: 'doc summary',
              inferred: true,
            },
          ],
        };
      }
      return {
        multiRecord: false,
        fields: [
          { name: 'title', locators: ['#t', 'h1'], semanticAnchor: 'title' },
          { name: 'summary', locators: ['.s', 'p.s'], semanticAnchor: 'summary' },
        ],
      };
    });
    const r = await compile({
      entryUrl: 'https://example.com/docs/page',
      cleanedHtml: docHtml,
      goal: 'doc article',
      llm,
      now: fixedNow,
    });
    expect(r.config.pageTemplates[0]!.multiRecord).toBe(false);
    expect(r.config.pageTemplates[0]!.matchHeuristic).toBeUndefined();
  });
});
