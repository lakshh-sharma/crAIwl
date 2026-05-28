/**
 * End-to-end: the crawl loop hits a redesigned page, self-heal patches the
 * config mid-crawl, and subsequent pages of the same shape extract cleanly
 * without paying another repair LLM call.
 */

import { describe, expect, it } from 'vitest';
import { MockLLMProvider, parseStrategyConfig, type StrategyConfigInput } from '@craiwl/core';
import { RobotsCache, type FetchResult, type Fetcher } from '@craiwl/fetcher';
import { crawlSite } from './crawl.js';

const FIXED_NOW = () => new Date('2026-05-29T12:00:00.000Z');

const config = parseStrategyConfig({
  strategyVersion: '1.0.0',
  createdBy: 'test',
  createdAt: '2026-05-01T00:00:00.000Z',
  lastValidated: null,
  reason: 'compile',
  target: { entryUrl: 'https://example.com/docs', scope: 'section' },
  goal: 'doc titles',
  pageTemplates: [
    {
      id: 'page',
      multiRecord: false,
      fields: {
        title: {
          locators: ['h1#legacy-id', 'h1.legacy-class'],
          semanticAnchor: 'main heading',
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
  // The redesigned shape: h1 wrapped in a .article-title class, the old id/class are gone.
  return `<!doctype html><html><body><main><article><h1 class="article-title">${title}</h1>${anchors}</article></main></body></html>`;
}

function makeFetcher(map: Record<string, { status?: number; body: string }>): Fetcher {
  return {
    tier: 'static',
    fetch: async (url): Promise<FetchResult> => {
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
        headers: {},
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

function makeRobotsCache(): RobotsCache {
  return new RobotsCache({
    fetcher: makeFetcher({ 'https://example.com/robots.txt': { body: '' } }),
  });
}

describe('crawlSite with self-heal', () => {
  it('repairs the broken locator on the first page and reuses it for the rest', async () => {
    const fetcher = makeFetcher({
      'https://example.com/docs': {
        body: page('Index', ['/docs/a', '/docs/b']),
      },
      'https://example.com/docs/a': { body: page('Page A') },
      'https://example.com/docs/b': { body: page('Page B') },
    });

    let repairCalls = 0;
    const llm = new MockLLMProvider(() => {
      // Readability rewrites h1 → h2 during cleanHtml, so we point at the wrapper class.
      repairCalls++;
      return { newLocators: ['.article-title', 'h1'] };
    });

    const result = await crawlSite({
      entryUrl: 'https://example.com/docs',
      config,
      fetcher,
      robotsCache: makeRobotsCache(),
      userAgent: 'craiwl-test',
      politeness: { minIntervalMs: 0, perDomainConcurrency: 4 },
      selfHeal: { llm, maxRepairs: 5 },
      now: FIXED_NOW,
    });

    // Every page yields a record (post-heal).
    expect(result.pagesCrawled).toBe(3);
    const titles = result.records
      .map((r) => r.fields['title'])
      .filter((o): o is Extract<typeof o, { ok: true }> => o.ok)
      .map((o) => o.value);
    expect(titles.sort()).toEqual(['Index', 'Page A', 'Page B']);

    // The first page paid one repair call; the remaining pages reused the
    // patched config in memory.
    expect(repairCalls).toBe(1);
    expect(result.repairs).toHaveLength(1);
    expect(result.repairs[0]!.attempts[0]).toMatchObject({
      ok: true,
      fieldName: 'title',
    });

    // finalConfig carries the new locator + a self-heal version stamp.
    expect(result.finalConfig.reason).toBe('self-heal');
    expect(result.finalConfig.pageTemplates[0]!.fields['title']!.locators).toContain(
      '.article-title',
    );
  });

  it('honors the maxRepairs cap', async () => {
    const fetcher = makeFetcher({
      'https://example.com/docs': { body: page('Index') },
    });
    let calls = 0;
    const llm = new MockLLMProvider(() => {
      calls++;
      // Return locators that DON'T resolve so the budget actually drains
      // (each call counts as one used budget slot regardless of outcome).
      return { newLocators: ['.never-1', '.never-2'] };
    });

    const result = await crawlSite({
      entryUrl: 'https://example.com/docs',
      config,
      fetcher,
      robotsCache: makeRobotsCache(),
      userAgent: 'craiwl-test',
      politeness: { minIntervalMs: 0 },
      selfHeal: { llm, maxRepairs: 1 },
      now: FIXED_NOW,
    });

    expect(calls).toBe(1);
    // The single attempt was made; the cap prevents nothing on a 1-page crawl,
    // but the budget IS consumed.
    expect(result.repairs).toHaveLength(1);
  });

  it('no-op when self-heal is not configured', async () => {
    const fetcher = makeFetcher({
      'https://example.com/docs': { body: page('Index') },
    });
    const result = await crawlSite({
      entryUrl: 'https://example.com/docs',
      config,
      fetcher,
      robotsCache: makeRobotsCache(),
      userAgent: 'craiwl-test',
      politeness: { minIntervalMs: 0 },
      now: FIXED_NOW,
    });
    expect(result.repairs).toEqual([]);
    expect(result.finalConfig).toBe(config);
    expect(result.likelyRedesign).toBe(false);
  });
});
