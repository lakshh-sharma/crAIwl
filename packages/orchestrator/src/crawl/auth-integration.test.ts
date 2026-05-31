/**
 * The crawl loop attaches resolved auth headers to every outbound request.
 * This exercises the path end-to-end: SecretsProvider → resolveAuthHeaders
 * → crawlSite → Fetcher receives the header.
 */

import { describe, expect, it } from 'vitest';
import {
  EnvSecretsProvider,
  parseStrategyConfig,
  resolveAuthHeaders,
  type StrategyConfigInput,
} from '@craiwl/core';
import {
  RobotsCache,
  type FetchRequestOptions,
  type FetchResult,
  type Fetcher,
} from '@craiwl/fetcher';
import { crawlSite } from './crawl.js';

const FIXED_NOW = () => new Date('2026-05-30T12:00:00.000Z');

const config = parseStrategyConfig({
  strategyVersion: '1.1.0',
  createdBy: 'test',
  createdAt: '2026-05-01T00:00:00.000Z',
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
  auth: { type: 'bearer', secret: 'my-api-token' },
} as StrategyConfigInput);

function page(title: string): string {
  return `<!doctype html><html><body><main><h1>${title}</h1></main></body></html>`;
}

describe('crawlSite with auth headers', () => {
  it('attaches resolved auth headers to every fetch and records them per page', async () => {
    const headersSeen: Array<Record<string, string>> = [];
    const fetcher: Fetcher = {
      tier: 'static',
      fetch: async (url, opts?: FetchRequestOptions): Promise<FetchResult> => {
        // Record what auth landed on each call (skip robots).
        if (!url.endsWith('/robots.txt')) {
          headersSeen.push({ ...(opts?.headers ?? {}) });
        }
        return {
          status: 200,
          headers: {},
          body: url.endsWith('/robots.txt') ? '' : page('Hello'),
          finalUrl: url,
          tierUsed: 'static',
          timingMs: 1,
          attempts: 1,
          redirects: 0,
        };
      },
    };
    const robotsCache = new RobotsCache({ fetcher });
    const secrets = new EnvSecretsProvider({
      env: { CRAWL_SECRET_MY_API_TOKEN: 'tk_abcdef' },
    });

    const authHeaders = await resolveAuthHeaders(config.auth!, secrets);

    const result = await crawlSite({
      entryUrl: 'https://example.com/docs',
      config,
      fetcher,
      robotsCache,
      userAgent: 'craiwl-test',
      politeness: { minIntervalMs: 0 },
      authHeaders,
      now: FIXED_NOW,
    });

    expect(result.pagesCrawled).toBe(1);
    expect(headersSeen.length).toBeGreaterThan(0);
    for (const h of headersSeen) {
      expect(h['Authorization']).toBe('Bearer tk_abcdef');
    }
  });

  it('the crawl works without auth when none is supplied', async () => {
    const headersSeen: Array<Record<string, string>> = [];
    const fetcher: Fetcher = {
      tier: 'static',
      fetch: async (url, opts?: FetchRequestOptions): Promise<FetchResult> => {
        if (!url.endsWith('/robots.txt')) headersSeen.push({ ...(opts?.headers ?? {}) });
        return {
          status: 200,
          headers: {},
          body: url.endsWith('/robots.txt') ? '' : page('Hello'),
          finalUrl: url,
          tierUsed: 'static',
          timingMs: 1,
          attempts: 1,
          redirects: 0,
        };
      },
    };
    const result = await crawlSite({
      entryUrl: 'https://example.com/docs',
      config,
      fetcher,
      robotsCache: new RobotsCache({ fetcher }),
      userAgent: 'craiwl-test',
      politeness: { minIntervalMs: 0 },
      now: FIXED_NOW,
    });
    expect(result.pagesCrawled).toBe(1);
    for (const h of headersSeen) {
      expect(h['Authorization']).toBeUndefined();
    }
  });
});
