import { describe, expect, it } from 'vitest';
import { probeDocPaths, DEFAULT_DOC_PATHS } from './probe.js';
import type { Fetcher, FetchResult } from '@craiwl/fetcher';

const ok = (url: string, len = 1024): FetchResult => ({
  status: 200,
  headers: {},
  body: 'x'.repeat(len),
  finalUrl: url,
  tierUsed: 'static',
  timingMs: 1,
  attempts: 1,
  redirects: 0,
});

const miss = (url: string): FetchResult => ({
  status: 404,
  headers: {},
  body: '',
  finalUrl: url,
  tierUsed: 'static',
  timingMs: 1,
  attempts: 1,
  redirects: 0,
});

const fakeFetcher = (map: (url: string) => FetchResult | Promise<FetchResult>): Fetcher => ({
  tier: 'static',
  fetch: async (url) => map(url),
});

describe('probeDocPaths', () => {
  it('returns a result per default path, marking 2xx + substantial bodies as resolved', async () => {
    const fetcher = fakeFetcher((url) => {
      if (url.endsWith('/docs') || url.endsWith('/api')) return ok(url);
      return miss(url);
    });
    const results = await probeDocPaths('https://example.com', { fetcher });
    expect(results).toHaveLength(DEFAULT_DOC_PATHS.length);
    const resolved = results.filter((r) => r.resolved).map((r) => r.path);
    expect(resolved).toEqual(['/docs', '/api']);
  });

  it('marks 200 with a tiny body as unresolved', async () => {
    const fetcher = fakeFetcher((url) => ok(url, 10));
    const results = await probeDocPaths('https://example.com', { fetcher, minContentLength: 256 });
    for (const r of results) expect(r.resolved).toBe(false);
  });

  it('records origin even when fetch throws', async () => {
    const fetcher = fakeFetcher(() => {
      throw new Error('boom');
    });
    const results = await probeDocPaths('https://example.com', { fetcher, paths: ['/docs'] });
    expect(results[0]).toMatchObject({ status: 0, resolved: false, path: '/docs' });
  });

  it('respects a custom path list and preserves input order', async () => {
    const fetcher = fakeFetcher((url) => ok(url));
    const results = await probeDocPaths('https://example.com', {
      fetcher,
      paths: ['/zeta', '/alpha', '/beta'],
    });
    expect(results.map((r) => r.path)).toEqual(['/zeta', '/alpha', '/beta']);
  });

  it('runs probes concurrently up to the concurrency cap', async () => {
    let inFlight = 0;
    let peak = 0;
    const fetcher: Fetcher = {
      tier: 'static',
      fetch: async (url) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return ok(url);
      },
    };
    await probeDocPaths('https://example.com', { fetcher, concurrency: 3 });
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });
});
