import { describe, expect, it } from 'vitest';
import { MockLLMProvider } from '@craiwl/core';
import { inferFieldSchema } from './field-schema.js';

const respondWith = (fields: unknown[]) => new MockLLMProvider(() => ({ fields }));

describe('inferFieldSchema', () => {
  it('returns the LLM-proposed fields when the user supplies none', async () => {
    const llm = respondWith([
      {
        name: 'plan-name',
        type: 'string',
        required: true,
        description: 'Name of the pricing plan.',
        inferred: true,
      },
      {
        name: 'price',
        type: 'number',
        required: true,
        description: 'Monthly price in USD.',
        inferred: true,
      },
    ]);
    const r = await inferFieldSchema(llm, { goal: 'extract pricing plans' });
    expect(r.fields.map((f) => f.name)).toEqual(['plan-name', 'price']);
    expect(r.fields.every((f) => f.inferred)).toBe(true);
  });

  it('layers user-specified fields on top of inferred ones, user wins on name collisions', async () => {
    const llm = respondWith([
      {
        name: 'plan-name',
        type: 'string',
        required: true,
        description: 'inferred description',
        inferred: true,
      },
      {
        name: 'price',
        type: 'number',
        required: true,
        description: 'inferred description',
        inferred: true,
      },
    ]);
    const r = await inferFieldSchema(llm, {
      goal: 'pricing plans',
      userFields: [
        { name: 'plan-name', type: 'string', required: true, description: 'plan title' },
        { name: 'feature-count', type: 'integer' },
      ],
    });
    const byName = Object.fromEntries(r.fields.map((f) => [f.name, f]));
    expect(byName['plan-name']).toMatchObject({ inferred: false, description: 'plan title' });
    expect(byName['feature-count']).toMatchObject({
      inferred: false,
      type: 'integer',
      required: false,
    });
    expect(byName['price']).toMatchObject({ inferred: true });
  });

  it('normalizes field names to snake_case', async () => {
    const llm = respondWith([
      { name: 'Plan Name', type: 'string', required: true, description: 'name', inferred: true },
      { name: 'price-USD', type: 'number', required: false, description: 'price', inferred: true },
    ]);
    const r = await inferFieldSchema(llm, { goal: 'pricing' });
    expect(r.fields.map((f) => f.name)).toEqual(['plan-name', 'price-usd']);
  });

  it('includes page context in the prompt when provided', async () => {
    let receivedUserText = '';
    const llm = new MockLLMProvider((_, opts) => {
      receivedUserText = opts.messages[0]!.content;
      return {
        fields: [
          {
            name: 'title',
            type: 'string',
            required: true,
            description: 'doc title',
            inferred: true,
          },
        ],
      };
    });
    await inferFieldSchema(llm, { goal: 'docs', pageContext: '<h1>Hello</h1><p>doc body</p>' });
    expect(receivedUserText).toContain('<h1>Hello</h1>');
    expect(receivedUserText).toContain('Goal: docs');
  });

  it('truncates oversized page context to keep token budget bounded', async () => {
    let receivedUserText = '';
    const llm = new MockLLMProvider((_, opts) => {
      receivedUserText = opts.messages[0]!.content;
      return {
        fields: [{ name: 'x', type: 'string', required: false, description: 'x', inferred: true }],
      };
    });
    const huge = 'A'.repeat(10_000);
    await inferFieldSchema(llm, { goal: 'docs', pageContext: huge });
    // The 4kB cap plus the wrapper text should be well under 5kB.
    expect(receivedUserText.length).toBeLessThan(5_000);
  });

  it('carries the model identifier and usage through for provenance', async () => {
    const llm = new MockLLMProvider(
      () => ({
        fields: [{ name: 'x', type: 'string', required: false, description: 'x', inferred: true }],
      }),
      'mock-claude-test',
    );
    const r = await inferFieldSchema(llm, { goal: 'g' });
    expect(r.model).toBe('mock-claude-test');
    expect(r.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it('dedupes user fields with the same normalized name', async () => {
    const llm = respondWith([
      { name: 'extra', type: 'string', required: false, description: 'extra', inferred: true },
    ]);
    const r = await inferFieldSchema(llm, {
      goal: 'x',
      userFields: [
        { name: 'Plan Name', type: 'string' },
        { name: 'plan-name', type: 'string' }, // same normalized
      ],
    });
    expect(r.fields.filter((f) => f.name === 'plan-name')).toHaveLength(1);
  });
});
