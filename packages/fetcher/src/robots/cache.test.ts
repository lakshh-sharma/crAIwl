import { describe, expect, it, vi } from 'vitest';
import { RobotsCache } from './cache.js';
import type { FetchRequestOptions, FetchResult, Fetcher } from '../types.js';

const ok = (body: string): FetchResult => ({
  status: 200,
  headers: {},
  body,
  finalUrl: 'https://example.com/robots.txt',
  tierUsed: 'static',
  timingMs: 1,
  attempts: 1,
  redirects: 0,
});

const notFound: FetchResult = {
  status: 404,
  headers: {},
  body: '',
  finalUrl: '',
  tierUsed: 'static',
  timingMs: 1,
  attempts: 1,
  redirects: 0,
};

const fakeFetcher = (
  impl: (url: string, opts?: FetchRequestOptions) => Promise<FetchResult>,
): Fetcher => ({ tier: 'static', fetch: impl });

describe('RobotsCache', () => {
  it('fetches /robots.txt once per host and reuses the parsed rules', async () => {
    const spy = vi.fn(async () => ok('User-agent: *\nDisallow: /private/\n'));
    const cache = new RobotsCache({ fetcher: fakeFetcher(spy) });

    expect(await cache.isAllowed('https://example.com/private/page', 'craiwl')).toBe(false);
    expect(await cache.isAllowed('https://example.com/public/page', 'craiwl')).toBe(true);

    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]![0]).toBe('https://example.com/robots.txt');
  });

  it('treats 404 robots.txt as allow-all and caches the empty result', async () => {
    const spy = vi.fn(async () => notFound);
    const cache = new RobotsCache({ fetcher: fakeFetcher(spy) });

    expect(await cache.isAllowed('https://example.com/anything', 'craiwl')).toBe(true);
    expect(await cache.isAllowed('https://example.com/another', 'craiwl')).toBe(true);
    expect(spy).toHaveBeenCalledOnce();
  });

  it('falls back to allow-all when the fetch throws', async () => {
    const cache = new RobotsCache({
      fetcher: fakeFetcher(async () => {
        throw new Error('network down');
      }),
    });
    expect(await cache.isAllowed('https://example.com/anything', 'craiwl')).toBe(true);
  });

  it('keeps separate entries per origin', async () => {
    const spy = vi.fn(async (url: string) => {
      if (url.startsWith('https://a.example')) return ok('User-agent: *\nDisallow: /\n');
      return ok('User-agent: *\nAllow: /\n');
    });
    const cache = new RobotsCache({ fetcher: fakeFetcher(spy) });
    expect(await cache.isAllowed('https://a.example/p', 'craiwl')).toBe(false);
    expect(await cache.isAllowed('https://b.example/p', 'craiwl')).toBe(true);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('refetches after the TTL expires', async () => {
    let counter = 0;
    const spy = vi.fn(async () => {
      counter++;
      return ok(counter === 1 ? 'User-agent: *\nDisallow: /\n' : 'User-agent: *\nAllow: /\n');
    });
    const cache = new RobotsCache({ fetcher: fakeFetcher(spy), ttlMs: 10 });
    expect(await cache.isAllowed('https://example.com/x', 'craiwl')).toBe(false);
    await new Promise((r) => setTimeout(r, 20));
    expect(await cache.isAllowed('https://example.com/x', 'craiwl')).toBe(true);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('returns crawl-delay through the cache', async () => {
    const cache = new RobotsCache({
      fetcher: fakeFetcher(async () => ok('User-agent: *\nCrawl-delay: 3\n')),
    });
    expect(await cache.getCrawlDelay('https://example.com/x', 'craiwl')).toBe(3);
  });
});
