import { describe, expect, it } from 'vitest';
import { aggregate } from './aggregate.js';
import type { RunManifest } from '../output/manifest.js';

const FIXED_NOW = () => new Date('2026-06-02T12:00:00.000Z');

const mk = (overrides: Partial<RunManifest>): RunManifest => ({
  runId: 'run-x',
  startedAt: '2026-06-01T00:00:00.000Z',
  finishedAt: '2026-06-01T00:01:00.000Z',
  goal: 'titles',
  entryUrl: 'https://example.com',
  config: {
    version: '1.1.0',
    createdBy: 'mock',
    createdAt: '2026-05-01T00:00:00.000Z',
    fetchProfile: 'static',
    confidenceFloor: 0.8,
  },
  counts: {
    pagesCrawled: 5,
    recordsTotal: 5,
    recordsClean: 5,
    recordsReview: 0,
    pagesSkipped: 0,
    pagesFailed: 0,
  },
  fieldCoverage: {},
  cost: {
    llm: { totalCalls: 0, inputTokens: 0, outputTokens: 0, estimatedUsd: 0, byPhase: {} },
    pages: { total: 5, byTier: {} },
    records: { total: 5, perKtokenIn: 0, perKtokenOut: 0 },
    durationMs: 60_000,
    model: 'mock',
  },
  compliance: {
    authProfile: null,
    secretsAccessed: [],
    pagesAuthenticated: 0,
    robotsBypasses: 0,
    httpAuthFailures: 0,
  },
  ...overrides,
});

describe('aggregate', () => {
  it('sorts runs newest-first', () => {
    const s = aggregate(
      [
        mk({ runId: 'r1', startedAt: '2026-06-01T00:00:00.000Z' }),
        mk({ runId: 'r2', startedAt: '2026-06-03T00:00:00.000Z' }),
        mk({ runId: 'r3', startedAt: '2026-06-02T00:00:00.000Z' }),
      ],
      { now: FIXED_NOW },
    );
    expect(s.rows.map((r) => r.runId)).toEqual(['r2', 'r3', 'r1']);
    expect(s.range).toEqual({
      earliest: '2026-06-01T00:00:00.000Z',
      latest: '2026-06-03T00:00:00.000Z',
    });
  });

  it('returns an empty/null summary for zero runs', () => {
    const s = aggregate([], { now: FIXED_NOW });
    expect(s.totals.runs).toBe(0);
    expect(s.range).toBeNull();
    expect(s.rows).toEqual([]);
  });

  it('totals across runs and rounds USD to 4 decimals', () => {
    const s = aggregate(
      [
        mk({
          runId: 'r1',
          cost: {
            llm: {
              totalCalls: 1,
              inputTokens: 100,
              outputTokens: 200,
              estimatedUsd: 0.0001,
              byPhase: {},
            },
            pages: { total: 5, byTier: {} },
            records: { total: 5, perKtokenIn: 0, perKtokenOut: 0 },
            durationMs: 60_000,
            model: 'mock',
          },
          counts: {
            pagesCrawled: 5,
            recordsTotal: 5,
            recordsClean: 5,
            recordsReview: 0,
            pagesSkipped: 0,
            pagesFailed: 0,
          },
        }),
        mk({
          runId: 'r2',
          cost: {
            llm: {
              totalCalls: 1,
              inputTokens: 100,
              outputTokens: 200,
              estimatedUsd: 0.0002,
              byPhase: {},
            },
            pages: { total: 3, byTier: {} },
            records: { total: 3, perKtokenIn: 0, perKtokenOut: 0 },
            durationMs: 60_000,
            model: 'mock',
          },
          counts: {
            pagesCrawled: 3,
            recordsTotal: 3,
            recordsClean: 3,
            recordsReview: 0,
            pagesSkipped: 0,
            pagesFailed: 0,
          },
        }),
      ],
      { now: FIXED_NOW },
    );
    expect(s.totals.pagesCrawled).toBe(8);
    expect(s.totals.recordsTotal).toBe(8);
    expect(s.totals.estimatedUsd).toBe(0.0003);
  });

  it('flags authenticated runs and surfaces auth-failure counts', () => {
    const s = aggregate(
      [
        mk({
          runId: 'r1',
          compliance: {
            authProfile: { type: 'bearer', secretNames: ['t'] },
            secretsAccessed: ['t'],
            pagesAuthenticated: 5,
            robotsBypasses: 0,
            httpAuthFailures: 2,
          },
        }),
      ],
      { now: FIXED_NOW },
    );
    expect(s.rows[0]!.authenticated).toBe(true);
    expect(s.rows[0]!.httpAuthFailures).toBe(2);
    expect(s.totals.httpAuthFailures).toBe(2);
  });

  it('honors maxRows, dropping the oldest', () => {
    const manifests = Array.from({ length: 5 }, (_, i) =>
      mk({ runId: `r${i}`, startedAt: `2026-06-0${i + 1}T00:00:00.000Z` }),
    );
    const s = aggregate(manifests, { now: FIXED_NOW, maxRows: 3 });
    expect(s.rows.map((r) => r.runId)).toEqual(['r4', 'r3', 'r2']);
  });
});
