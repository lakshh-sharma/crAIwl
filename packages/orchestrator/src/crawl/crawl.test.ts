import { describe, expect, it, vi } from 'vitest';
import {
  RobotsCache,
  type FetchRequestOptions,
  type FetchResult,
  type Fetcher,
} from '@craiwl/fetcher';
import { parseStrategyConfig, type StrategyConfigInput } from '@craiwl/core';
import { crawlSite } from './crawl.js';

const config = parseStrategyConfig({
  strategyVersion: '1.0.0',
  createdBy: 'test',
  createdAt: '2026-01-15T12:00:00.000Z',
  lastValidated: null,
  reason: 'compile',
  target: { entryUrl: 'https://example.com/docs', scope: 'section' },
  goal: 'docs titles',
  pageTemplates: [
    {
      id: 'page',
      multiRecord: false,
      fields: {
        title: {
          // Readability demotes <h1> → <h2> during cleanHtml; we test against
          // the cleaned shape, which is also what compile would see.
          locators: ['h2', 'h1'],
          semanticAnchor: 'page title',
          type: 'string',
          required: true,
        },
      },
    },
  ],
  pagination: { type: 'none' },
  fetchProfile: 'static',
  confidenceFloor: 0.8,
} as StrategyConfigInput);

function page(title: string, links: string[] = []): string {
  const anchors = links.map((l) => `<a href="${l}">link</a>`).join('');
  return `<!doctype html><html><body><main><h1>${title}</h1>${anchors}</main></body></html>`;
}

function makeFetcher(
  map: Record<string, { status?: number; body: string; headers?: Record<string, string> }>,
): Fetcher {
  return {
    tier: 'static',
    fetch: async (url: string, _opts?: FetchRequestOptions): Promise<FetchResult> => {
      const hit = map[url];
      if (!hit) {
        return {
          status: 404,
          headers: {},
          body: '',
          finalUrl: url,
          tierUsed: 'static',
          timingMs: 1,
          attempts: 1,
          redirects: 0,
        };
      }
      return {
        status: hit.status ?? 200,
        headers: hit.headers ?? {},
        body: hit.body,
        finalUrl: url,
        tierUsed: 'static',
        timingMs: 1,
        attempts: 1,
        redirects: 0,
      };
    },
  };
}

function makeRobotsCache(body: string): RobotsCache {
  const fetcher = makeFetcher({ 'https://example.com/robots.txt': { body } });
  return new RobotsCache({ fetcher });
}

const FIXED_NOW = () => new Date('2026-01-15T12:00:00.000Z');

describe('crawlSite', () => {
  it('crawls the entry URL plus on-page links within scope', async () => {
    const fetcher = makeFetcher({
      'https://example.com/docs': {
        body: page('Index', ['/docs/intro', '/docs/setup', '/blog/post']),
      },
      'https://example.com/docs/intro': { body: page('Intro') },
      'https://example.com/docs/setup': { body: page('Setup') },
    });
    const robotsCache = makeRobotsCache('User-agent: *\nAllow: /\n');

    const result = await crawlSite({
      entryUrl: 'https://example.com/docs',
      config,
      fetcher,
      robotsCache,
      userAgent: 'craiwl-test',
      politeness: { minIntervalMs: 0, perDomainConcurrency: 4 },
      now: FIXED_NOW,
    });

    const titles = result.records.map(
      (r) => (r.fields['title'] as { ok: true; value: string }).value,
    );
    expect(titles.sort()).toEqual(['Index', 'Intro', 'Setup']);
    expect(result.pagesCrawled).toBe(3);
    expect(result.failures).toEqual([]);
    // /blog/post was out of scope (entry was /docs).
    expect(result.skipped.find((s) => s.url.includes('blog'))?.reason).toBe('out-of-scope');
  });

  it('respects robots.txt disallow under the default policy', async () => {
    const fetcher = makeFetcher({
      'https://example.com/docs': { body: page('Index', ['/docs/secret']) },
      'https://example.com/docs/secret': { body: page('Secret') },
    });
    const robotsCache = makeRobotsCache('User-agent: *\nDisallow: /docs/secret\n');

    const result = await crawlSite({
      entryUrl: 'https://example.com/docs',
      config,
      fetcher,
      robotsCache,
      userAgent: 'craiwl-test',
      politeness: { minIntervalMs: 0 },
      now: FIXED_NOW,
    });

    const urls = result.pagesPerUrl.map((p) => p.url);
    expect(urls).toEqual(['https://example.com/docs']);
    expect(result.skipped.find((s) => s.url.includes('secret'))?.reason).toBe('disallowed-respect');
  });

  it('warn policy crawls disallowed URLs and writes an audit event', async () => {
    const fetcher = makeFetcher({
      'https://example.com/docs': { body: page('Index', ['/docs/secret']) },
      'https://example.com/docs/secret': { body: page('Secret') },
    });
    const robotsCache = makeRobotsCache('User-agent: *\nDisallow: /docs/secret\n');

    const result = await crawlSite({
      entryUrl: 'https://example.com/docs',
      config,
      fetcher,
      robotsCache,
      userAgent: 'craiwl-test',
      robotsPolicy: 'warn',
      politeness: { minIntervalMs: 0 },
      now: FIXED_NOW,
    });

    expect(result.pagesCrawled).toBe(2);
    expect(result.auditEvents).toHaveLength(1);
    expect(result.auditEvents[0]!.policy).toBe('warn');
  });

  it('honors maxPages even when the link graph would crawl more', async () => {
    const links = ['/docs/a', '/docs/b', '/docs/c', '/docs/d'];
    const fetcher = makeFetcher({
      'https://example.com/docs': { body: page('Index', links) },
      'https://example.com/docs/a': { body: page('A') },
      'https://example.com/docs/b': { body: page('B') },
      'https://example.com/docs/c': { body: page('C') },
      'https://example.com/docs/d': { body: page('D') },
    });
    const robotsCache = makeRobotsCache('');

    const result = await crawlSite({
      entryUrl: 'https://example.com/docs',
      config,
      fetcher,
      robotsCache,
      userAgent: 'craiwl-test',
      maxPages: 3,
      politeness: { minIntervalMs: 0, perDomainConcurrency: 4 },
      now: FIXED_NOW,
    });

    expect(result.pagesCrawled).toBe(3);
    expect(result.skipped.some((s) => s.reason === 'past-max-pages')).toBe(true);
  });

  it('records failures and continues with the rest of the frontier', async () => {
    const fetcher = makeFetcher({
      'https://example.com/docs': { body: page('Index', ['/docs/a', '/docs/b']) },
      'https://example.com/docs/a': { status: 500, body: '' },
      'https://example.com/docs/b': { body: page('B') },
    });
    const robotsCache = makeRobotsCache('');

    const result = await crawlSite({
      entryUrl: 'https://example.com/docs',
      config,
      fetcher,
      robotsCache,
      userAgent: 'craiwl-test',
      politeness: { minIntervalMs: 0, perDomainConcurrency: 4 },
      now: FIXED_NOW,
    });

    expect(result.failures.find((f) => f.url.includes('/a'))?.error).toBe('http-500');
    expect(result.pagesCrawled).toBe(2); // Index + /b
  });

  it('reports progress after each page', async () => {
    const fetcher = makeFetcher({
      'https://example.com/docs': { body: page('Index', ['/docs/a']) },
      'https://example.com/docs/a': { body: page('A') },
    });
    const robotsCache = makeRobotsCache('');
    const onProgress = vi.fn();

    await crawlSite({
      entryUrl: 'https://example.com/docs',
      config,
      fetcher,
      robotsCache,
      userAgent: 'craiwl-test',
      onProgress,
      politeness: { minIntervalMs: 0, perDomainConcurrency: 4 },
      now: FIXED_NOW,
    });

    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress.mock.calls[1]![0]).toMatchObject({
      pagesDone: 2,
      recordsExtracted: 2,
    });
  });

  it('aborts mid-crawl when the signal fires', async () => {
    const fetcher = makeFetcher({
      'https://example.com/docs': {
        body: page('Index', ['/docs/a', '/docs/b', '/docs/c']),
      },
      'https://example.com/docs/a': { body: page('A') },
      'https://example.com/docs/b': { body: page('B') },
      'https://example.com/docs/c': { body: page('C') },
    });
    const robotsCache = makeRobotsCache('');
    const ac = new AbortController();
    ac.abort();

    const result = await crawlSite({
      entryUrl: 'https://example.com/docs',
      config,
      fetcher,
      robotsCache,
      userAgent: 'craiwl-test',
      signal: ac.signal,
      politeness: { minIntervalMs: 0 },
      now: FIXED_NOW,
    });

    expect(result.skipped.some((s) => s.reason === 'aborted')).toBe(true);
  });
});
