import { describe, expect, it } from 'vitest';
import type { ExtractedRecord } from '@craiwl/extractor';
import { serializeAsCsv, serializeAsJson, serializeAsMarkdown } from './serialize.js';
import type { RunManifest } from './manifest.js';

const manifest: RunManifest = {
  runId: 'run-abc',
  startedAt: '2026-01-15T12:00:00.000Z',
  finishedAt: '2026-01-15T12:00:10.000Z',
  goal: 'pricing tiers',
  entryUrl: 'https://example.com/pricing',
  config: {
    version: '1.0.0',
    createdBy: 'mock-llm',
    createdAt: '2026-01-15T12:00:00.000Z',
    fetchProfile: 'static',
    confidenceFloor: 0.8,
  },
  counts: {
    pagesCrawled: 1,
    recordsTotal: 2,
    recordsClean: 2,
    recordsReview: 0,
    pagesSkipped: 0,
    pagesFailed: 0,
  },
  fieldCoverage: { 'pricing.plan-name': 1, 'pricing.price': 1 },
};

const records: ExtractedRecord[] = [
  {
    templateId: 'pricing',
    sourceUrl: 'https://example.com/pricing',
    extractedAt: '2026-01-15T12:00:05.000Z',
    fields: {
      'plan-name': {
        ok: true,
        value: 'Basic',
        locator: '.plan-name',
        locatorRank: 0,
        rawText: 'Basic',
        grounded: true,
        confidence: 1,
      },
      price: {
        ok: true,
        value: 9,
        locator: '.price',
        locatorRank: 0,
        rawText: '$9',
        grounded: true,
        confidence: 1,
      },
    },
  },
  {
    templateId: 'pricing',
    sourceUrl: 'https://example.com/pricing',
    extractedAt: '2026-01-15T12:00:05.000Z',
    fields: {
      'plan-name': {
        ok: true,
        value: 'Pro',
        locator: '.plan-name',
        locatorRank: 0,
        rawText: 'Pro',
        grounded: true,
        confidence: 1,
      },
      price: { ok: false, reason: 'locator-miss', attempts: [] },
    },
  },
];

describe('serializeAsJson', () => {
  it('emits the manifest plus records with projected values and per-field outcomes', () => {
    const out = serializeAsJson(records, manifest);
    expect(out.contentType).toBe('application/json');
    const parsed = JSON.parse(out.body);
    expect(parsed.manifest.runId).toBe('run-abc');
    expect(parsed.records).toHaveLength(2);
    expect(parsed.records[0]).toMatchObject({
      _source_url: 'https://example.com/pricing',
      _template_id: 'pricing',
      'plan-name': 'Basic',
      price: 9,
    });
    expect(parsed.records[1].price).toBeNull();
    expect(parsed.records[1]._outcomes.price.ok).toBe(false);
  });
});

describe('serializeAsCsv', () => {
  it('emits a header + one row per record with stable column order', () => {
    const out = serializeAsCsv(records);
    expect(out.contentType).toBe('text/csv');
    const lines = out.body.trim().split('\n');
    expect(lines[0]).toBe('_source_url,_template_id,plan-name,price');
    expect(lines[1]).toBe('https://example.com/pricing,pricing,Basic,9');
    expect(lines[2]).toBe('https://example.com/pricing,pricing,Pro,');
  });

  it('quotes cells containing commas, quotes, or newlines', () => {
    const recs: ExtractedRecord[] = [
      {
        templateId: 'p',
        sourceUrl: 'https://x/',
        extractedAt: '2026-01-15T12:00:00.000Z',
        fields: {
          name: {
            ok: true,
            value: 'Doe, Jane "Quoted"',
            locator: 'h1',
            locatorRank: 0,
            rawText: 'x',
            grounded: true,
            confidence: 1,
          },
        },
      },
    ];
    const out = serializeAsCsv(recs);
    expect(out.body).toContain('"Doe, Jane ""Quoted"""');
  });
});

describe('serializeAsMarkdown', () => {
  it('renders a heading, metadata block, and a results table', () => {
    const out = serializeAsMarkdown(records, manifest);
    expect(out.contentType).toBe('text/markdown');
    expect(out.body).toContain('# Crawl results: pricing tiers');
    expect(out.body).toContain('https://example.com/pricing');
    expect(out.body).toContain('| plan-name | price |');
    expect(out.body).toContain('| Basic | 9 |');
  });

  it('handles the no-records case gracefully', () => {
    const out = serializeAsMarkdown([], {
      ...manifest,
      counts: { ...manifest.counts, recordsTotal: 0 },
    });
    expect(out.body).toContain('_No records extracted._');
  });
});
