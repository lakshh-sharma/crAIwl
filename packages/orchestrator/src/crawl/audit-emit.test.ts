/**
 * crawlSite emits auth-attached + http-auth-failure into the supplied audit log.
 */

import { describe, expect, it } from 'vitest';
import {
  InMemoryAuditLog,
  parseStrategyConfig,
  resolveAuthHeaders,
  EnvSecretsProvider,
  type AuditEvent,
  type StrategyConfigInput,
} from '@craiwl/core';
import {
  RobotsCache,
  type FetchRequestOptions,
  type FetchResult,
  type Fetcher,
} from '@craiwl/fetcher';
import { crawlSite } from './crawl.js';

const FIXED_NOW = () => new Date('2026-06-02T12:00:00.000Z');

const cfg = parseStrategyConfig({
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
          locators: ['h1'],
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

const page = '<!doctype html><html><body><main><h1>Hello</h1></main></body></html>';

function staticFetcher(handler: (url: string) => FetchResult): Fetcher {
  return {
    tier: 'static',
    fetch: async (url, _opts?: FetchRequestOptions) => handler(url),
  };
}

describe('crawlSite audit emission', () => {
  it('emits one auth-attached event per non-robots fetch', async () => {
    const audit = new InMemoryAuditLog();
    const fetcher = staticFetcher((url) => ({
      status: 200,
      headers: {},
      body: url.endsWith('/robots.txt') ? '' : page,
      finalUrl: url,
      tierUsed: 'static',
      timingMs: 1,
      attempts: 1,
      redirects: 0,
    }));
    const secrets = new EnvSecretsProvider({ env: { CRAWL_SECRET_MY_API_TOKEN: 'tk' } });
    const authHeaders = await resolveAuthHeaders(cfg.auth!, secrets);

    const result = await crawlSite({
      entryUrl: 'https://example.com/docs',
      config: cfg,
      fetcher,
      robotsCache: new RobotsCache({ fetcher }),
      userAgent: 'craiwl-test',
      politeness: { minIntervalMs: 0 },
      authHeaders,
      auditLog: audit,
      now: FIXED_NOW,
    });

    expect(result.pagesCrawled).toBe(1);
    const authAttached = audit.events().filter((e: AuditEvent) => e.kind === 'auth-attached');
    expect(authAttached.length).toBe(1);
    const first = authAttached[0]!;
    if (first.kind === 'auth-attached') {
      expect(first.url).toBe('https://example.com/docs');
      expect(first.secretName).toBe('my-api-token');
      expect(first.authType).toBe('bearer');
      expect(first.headerNames).toContain('Authorization');
    }
  });

  it('emits http-auth-failure on a 401 — and the URL is still recorded', async () => {
    const audit = new InMemoryAuditLog();
    const fetcher = staticFetcher((url) => ({
      status: url.endsWith('/robots.txt') ? 200 : 401,
      headers: {},
      body: '',
      finalUrl: url,
      tierUsed: 'static',
      timingMs: 1,
      attempts: 1,
      redirects: 0,
    }));
    const secrets = new EnvSecretsProvider({ env: { CRAWL_SECRET_MY_API_TOKEN: 'tk' } });
    const authHeaders = await resolveAuthHeaders(cfg.auth!, secrets);

    await crawlSite({
      entryUrl: 'https://example.com/docs',
      config: cfg,
      fetcher,
      robotsCache: new RobotsCache({ fetcher }),
      userAgent: 'craiwl-test',
      politeness: { minIntervalMs: 0 },
      authHeaders,
      auditLog: audit,
      now: FIXED_NOW,
    });

    const fails = audit.events().filter((e: AuditEvent) => e.kind === 'http-auth-failure');
    expect(fails.length).toBe(1);
    const f = fails[0]!;
    if (f.kind === 'http-auth-failure') {
      expect(f.status).toBe(401);
      expect(f.url).toBe('https://example.com/docs');
    }
  });

  it('records no auth events on an unauthenticated run', async () => {
    const audit = new InMemoryAuditLog();
    const fetcher = staticFetcher((url) => ({
      status: 200,
      headers: {},
      body: url.endsWith('/robots.txt') ? '' : page,
      finalUrl: url,
      tierUsed: 'static',
      timingMs: 1,
      attempts: 1,
      redirects: 0,
    }));
    await crawlSite({
      entryUrl: 'https://example.com/docs',
      config: cfg,
      fetcher,
      robotsCache: new RobotsCache({ fetcher }),
      userAgent: 'craiwl-test',
      politeness: { minIntervalMs: 0 },
      auditLog: audit,
      now: FIXED_NOW,
    });
    const authEvents = audit.events().filter((e: AuditEvent) => e.kind === 'auth-attached');
    expect(authEvents.length).toBe(0);
  });
});
