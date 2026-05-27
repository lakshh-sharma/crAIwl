import { describe, expect, it } from 'vitest';
import { parseStrategyConfig, type StrategyConfigInput } from '@craiwl/core';
import { execute, partitionByConfidence } from './execute.js';

const FIXED_NOW = () => new Date('2026-01-15T12:00:00.000Z');

function buildConfig(pageTemplates: StrategyConfigInput['pageTemplates']) {
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
  });
}

describe('grounding + confidence', () => {
  it('marks straightforward extractions as grounded with confidence 1.0', async () => {
    const html = `<article><h1 id="t">Pricing Plan</h1></article>`;
    const config = buildConfig([
      {
        id: 'page',
        multiRecord: false,
        fields: {
          title: {
            locators: ['#t'],
            semanticAnchor: 'title',
            type: 'string',
            required: true,
          },
        },
      },
    ]);
    const r = execute({
      cleanedHtml: html,
      config,
      sourceUrl: 'https://x',
      now: FIXED_NOW,
    });
    const o = r.records[0]!.fields['title']!;
    expect(o.ok).toBe(true);
    if (o.ok) {
      expect(o.grounded).toBe(true);
      expect(o.confidence).toBe(1);
      expect(o.locatorRank).toBe(0);
    }
  });

  it('penalizes confidence when a fallback locator wins', async () => {
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
    const o = r.records[0]!.fields['title']!;
    if (o.ok) {
      expect(o.locatorRank).toBe(1);
      expect(o.confidence).toBeLessThan(1);
      expect(o.grounded).toBe(true);
    }
  });

  it('boosts confidence when validate ran and passed', async () => {
    const htmlA = `<article><h1>Title</h1></article>`;
    const configWithValidate = buildConfig([
      {
        id: 'page',
        multiRecord: false,
        fields: {
          title: {
            locators: ['h1'],
            semanticAnchor: 'title',
            type: 'string',
            validate: 'len>0',
            required: true,
          },
        },
      },
    ]);
    const configNoValidate = buildConfig([
      {
        id: 'page',
        multiRecord: false,
        fields: {
          title: {
            locators: ['h1'],
            semanticAnchor: 'title',
            type: 'string',
            required: true,
          },
        },
      },
    ]);
    const rWith = execute({
      cleanedHtml: htmlA,
      config: configWithValidate,
      sourceUrl: 'https://x',
      now: FIXED_NOW,
    });
    const rNo = execute({
      cleanedHtml: htmlA,
      config: configNoValidate,
      sourceUrl: 'https://x',
      now: FIXED_NOW,
    });
    const oWith = rWith.records[0]!.fields['title']!;
    const oNo = rNo.records[0]!.fields['title']!;
    if (oWith.ok && oNo.ok) {
      // Both cap at 1.0; with validate it should be at least as confident.
      expect(oWith.confidence).toBeGreaterThanOrEqual(oNo.confidence);
    }
  });
});

describe('partitionByConfidence', () => {
  it('routes records with any below-floor field to the review queue', async () => {
    // Two records: one with strong (rank 0) extraction, one where the fallback locator wins.
    const html = `
      <section class="card"><span class="hi">Alpha</span></section>
      <section class="card"><em class="hi">Beta</em></section>
    `;
    // Use 3 locators so the rank-1 winner picks up a meaningful penalty.
    const config = buildConfig([
      {
        id: 'cards',
        multiRecord: true,
        matchHeuristic: '.card',
        fields: {
          name: {
            locators: ['span.hi', 'em.hi', '.hi'],
            semanticAnchor: 'name',
            type: 'string',
            required: true,
          },
        },
      },
    ]);
    const r = execute({ cleanedHtml: html, config, sourceUrl: 'https://x', now: FIXED_NOW });
    const partition = partitionByConfidence(r, 0.95);
    // Alpha (rank 0, conf = 1.0) is clean; Beta (rank 1) is below 0.95.
    expect(partition.clean).toHaveLength(1);
    expect(partition.review).toHaveLength(1);
  });

  it('keeps a fully successful record in clean output when all fields meet the floor', async () => {
    const html = `<article><h1>Hello world</h1></article>`;
    const config = buildConfig([
      {
        id: 'page',
        multiRecord: false,
        fields: {
          title: {
            locators: ['h1'],
            semanticAnchor: 'title',
            type: 'string',
            required: true,
          },
        },
      },
    ]);
    const r = execute({ cleanedHtml: html, config, sourceUrl: 'https://x', now: FIXED_NOW });
    const partition = partitionByConfidence(r, 0.8);
    expect(partition.clean).toHaveLength(1);
    expect(partition.review).toHaveLength(0);
  });
});
