import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ScheduleStore } from './store.js';
import { Scheduler } from './scheduler.js';
import { exportConfig } from '../output/config-io.js';
import { parseStrategyConfig } from '@craiwl/core';
import { RobotsCache, type FetchResult, type Fetcher } from '@craiwl/fetcher';

async function setupStore() {
  const baseDir = await mkdtemp(join(tmpdir(), 'craiwl-sched-test-'));
  return { store: new ScheduleStore({ baseDir }), baseDir };
}

const cfg = parseStrategyConfig({
  strategyVersion: '1.0.0',
  createdBy: 'test',
  createdAt: '2026-01-15T12:00:00.000Z',
  lastValidated: null,
  reason: 'compile',
  target: { entryUrl: 'https://example.com/', scope: 'single' },
  goal: 'test',
  pageTemplates: [
    {
      id: 'page',
      multiRecord: false,
      fields: {
        title: {
          locators: ['h2', 'h1'],
          semanticAnchor: 'title',
          type: 'string',
          required: true,
        },
      },
    },
  ],
  pagination: { type: 'none' },
  fetchProfile: 'static',
  confidenceFloor: 0.8,
});

const ok = (body: string): FetchResult => ({
  status: 200,
  headers: {},
  body,
  finalUrl: 'https://example.com/',
  tierUsed: 'static',
  timingMs: 1,
  attempts: 1,
  redirects: 0,
});

const fakeFetcher: Fetcher = {
  tier: 'static',
  fetch: async (url) => {
    if (url.endsWith('/robots.txt')) return ok('');
    return ok('<!doctype html><html><body><main><h1>Hello</h1></main></body></html>');
  },
};

describe('Scheduler', () => {
  it('runs entries whose nextRunAt is due, writes output, and advances nextRunAt', async () => {
    const { store } = await setupStore();
    // Persist a config file the scheduler can load.
    const configPath = join(store.baseDir, 'config.json');
    await writeFile(configPath, exportConfig(cfg), 'utf8');

    const yesterday = new Date('2026-01-14T12:00:00.000Z').toISOString();
    await store.add({
      id: 's-test',
      configPath,
      intervalMs: 60_000,
      outDir: store.baseDir,
      format: 'json',
      createdAt: yesterday,
      nextRunAt: yesterday, // due
    });

    const fixedNow = () => new Date('2026-01-15T12:00:00.000Z');
    const scheduler = new Scheduler({
      store,
      fetcherFactory: () => fakeFetcher,
      robotsCacheFactory: (fetcher) => new RobotsCache({ fetcher }),
      userAgent: 'craiwl-test',
      now: fixedNow,
    });

    const results = await scheduler.runDueOnce();
    expect(results).toHaveLength(1);
    expect(results[0]!.ok).toBe(true);
    expect(results[0]!.outputPath).toMatch(/runs\/run-.*\.json$/);

    const updated = (await store.list())[0]!;
    expect(updated.lastRunAt).toBe('2026-01-15T12:00:00.000Z');
    expect(updated.nextRunAt).toBe('2026-01-15T12:01:00.000Z');
    // First run captures lastRunId so the next tick can diff against it.
    expect(updated.lastRunId).toBe(results[0]!.result!.runId);
  });

  it('diffs the second run against the first and writes the diff file', async () => {
    const { store } = await setupStore();
    const configPath = join(store.baseDir, 'config.json');
    await writeFile(configPath, exportConfig(cfg), 'utf8');

    // First run.
    const yesterday = new Date('2026-05-28T12:00:00.000Z').toISOString();
    await store.add({
      id: 's-diff',
      configPath,
      intervalMs: 60_000,
      outDir: store.baseDir,
      format: 'json',
      createdAt: yesterday,
      nextRunAt: yesterday,
    });

    let title = 'Hello';
    const dynamicFetcher: Fetcher = {
      tier: 'static',
      fetch: async (url) => {
        if (url.endsWith('/robots.txt')) return ok('');
        return ok(`<!doctype html><html><body><main><h1>${title}</h1></main></body></html>`);
      },
    };

    const scheduler1 = new Scheduler({
      store,
      fetcherFactory: () => dynamicFetcher,
      robotsCacheFactory: (f) => new RobotsCache({ fetcher: f }),
      userAgent: 'craiwl-test',
      now: () => new Date('2026-05-29T12:00:00.000Z'),
    });
    const first = await scheduler1.runDueOnce();
    expect(first).toHaveLength(1);
    // First run has nothing to diff against.
    expect(first[0]!.diffPath).toBeUndefined();
    expect(first[0]!.result!.diff).toBeUndefined();

    // Now the page changes and the second run is due.
    title = 'Hello World';
    // Force the next run to be due immediately.
    const after = await store.list();
    await store.update({ ...after[0]!, nextRunAt: '2026-05-29T12:00:00.000Z' });

    const scheduler2 = new Scheduler({
      store,
      fetcherFactory: () => dynamicFetcher,
      robotsCacheFactory: (f) => new RobotsCache({ fetcher: f }),
      userAgent: 'craiwl-test',
      now: () => new Date('2026-05-30T12:00:00.000Z'),
    });
    const second = await scheduler2.runDueOnce();
    expect(second).toHaveLength(1);
    expect(second[0]!.diffPath).toMatch(/runs\/run-.*\.diff\.json$/);
    const diff = second[0]!.result!.diff!;
    // The single record changed (title differs).
    expect(diff.changed.length + diff.added.length).toBeGreaterThan(0);
  });

  it('leaves not-yet-due entries alone', async () => {
    const { store } = await setupStore();
    const future = new Date('2099-01-01T00:00:00.000Z').toISOString();
    await store.add({
      id: 'future',
      configPath: '/missing',
      intervalMs: 60_000,
      outDir: store.baseDir,
      format: 'json',
      createdAt: '2026-01-15T12:00:00.000Z',
      nextRunAt: future,
    });
    const scheduler = new Scheduler({
      store,
      fetcherFactory: () => fakeFetcher,
      robotsCacheFactory: (f) => new RobotsCache({ fetcher: f }),
      userAgent: 'craiwl-test',
    });
    expect(await scheduler.runDueOnce()).toEqual([]);
  });

  it('runNow forces a specific schedule regardless of nextRunAt', async () => {
    const { store } = await setupStore();
    const configPath = join(store.baseDir, 'config.json');
    await writeFile(configPath, exportConfig(cfg), 'utf8');
    const future = new Date('2099-01-01T00:00:00.000Z').toISOString();
    await store.add({
      id: 'forced',
      configPath,
      intervalMs: 60_000,
      outDir: store.baseDir,
      format: 'json',
      createdAt: '2026-01-15T12:00:00.000Z',
      nextRunAt: future,
    });
    const scheduler = new Scheduler({
      store,
      fetcherFactory: () => fakeFetcher,
      robotsCacheFactory: (f) => new RobotsCache({ fetcher: f }),
      userAgent: 'craiwl-test',
      now: () => new Date('2026-01-15T12:00:00.000Z'),
    });
    const r = await scheduler.runNow('forced');
    expect(r.ok).toBe(true);
  });

  it('reports an error result when a schedule references a missing config', async () => {
    const { store } = await setupStore();
    const past = '2026-01-14T12:00:00.000Z';
    await store.add({
      id: 'broken',
      configPath: '/definitely/missing.json',
      intervalMs: 60_000,
      outDir: store.baseDir,
      format: 'json',
      createdAt: past,
      nextRunAt: past,
    });
    const log = vi.fn();
    const scheduler = new Scheduler({
      store,
      fetcherFactory: () => fakeFetcher,
      robotsCacheFactory: (f) => new RobotsCache({ fetcher: f }),
      userAgent: 'craiwl-test',
      now: () => new Date('2026-01-15T12:00:00.000Z'),
      log,
    });
    const [r] = await scheduler.runDueOnce();
    expect(r!.ok).toBe(false);
    expect(r!.error).toBeTruthy();
  });
});
