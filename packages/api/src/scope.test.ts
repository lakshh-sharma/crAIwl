import { describe, expect, it } from 'vitest';
import { EnvSecretsProvider, MockLLMProvider, InMemoryAuditLog } from '@craiwl/core';
import type { FetchRequestOptions, FetchResult, Fetcher } from '@craiwl/fetcher';
import { confirmScope, ScopeConfirmError } from './scope.js';

const FIXED_NOW = () => new Date('2026-06-04T12:00:00.000Z');

const LOREM = Array.from({ length: 6 })
  .map(
    () =>
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
  )
  .join(' ');

const ENTRY_HTML = `<!doctype html><html><head><title>Index</title></head><body><main><article>
  <p class="article-title">Docs index</p>
  <p>${LOREM}</p>
  <ul>
    <li><a href="/a">A</a></li>
    <li><a href="/b">B</a></li>
    <li><a href="https://other.example.com/x">external</a></li>
  </ul>
</article></main></body></html>`;

const responder = (tool: { name: string }): unknown => {
  if (tool.name === 'emit_field_schema') {
    return {
      fields: [
        {
          name: 'title',
          type: 'string',
          required: true,
          description: 'page title',
          inferred: true,
        },
      ],
    };
  }
  if (tool.name === 'emit_strategy') {
    return {
      multiRecord: false,
      fields: [
        {
          name: 'title',
          locators: ['p.article-title', 'article p.article-title'],
          semanticAnchor: 'page title',
        },
      ],
    };
  }
  throw new Error(`unexpected tool: ${tool.name}`);
};

function staticFetcher(handler: (url: string, opts?: FetchRequestOptions) => FetchResult): Fetcher {
  return {
    tier: 'static',
    fetch: async (url, opts) => handler(url, opts),
  };
}

describe('confirmScope', () => {
  it('rejects missing entryUrl', async () => {
    const llm = new MockLLMProvider(responder);
    const fetcher = staticFetcher(() => ({
      status: 200,
      headers: {},
      body: ENTRY_HTML,
      finalUrl: 'https://example.com',
      tierUsed: 'static',
      timingMs: 1,
      attempts: 1,
      redirects: 0,
    }));
    await expect(
      confirmScope({ entryUrl: '', goal: 'titles' }, { fetcher, llm }),
    ).rejects.toBeInstanceOf(ScopeConfirmError);
  });

  it('returns a compiled config and a populated estimate', async () => {
    const llm = new MockLLMProvider(responder);
    const fetcher = staticFetcher(() => ({
      status: 200,
      headers: {},
      body: ENTRY_HTML,
      finalUrl: 'https://example.com/',
      tierUsed: 'static',
      timingMs: 1,
      attempts: 1,
      redirects: 0,
    }));
    const result = await confirmScope(
      { entryUrl: 'https://example.com/', goal: 'extract page titles' },
      { fetcher, llm, now: FIXED_NOW },
    );
    expect(result.config.pageTemplates.length).toBe(1);
    expect(result.estimate.templatesProposed).toBe(1);
    expect(result.estimate.fieldsProposed).toBe(1);
    expect(result.estimate.requiredFields).toBe(1);
    expect(result.estimate.authenticated).toBe(false);
    // Only same-origin links are counted — the external link drops.
    expect(result.estimate.sampleOriginLinks).toBe(2);
    expect(result.estimate.sampleLinks).toEqual(['https://example.com/a', 'https://example.com/b']);
  });

  it('attaches auth to the entry fetch when an auth profile is supplied', async () => {
    const llm = new MockLLMProvider(responder);
    const seen: Array<Record<string, string>> = [];
    const fetcher = staticFetcher((_, opts) => {
      seen.push({ ...(opts?.headers ?? {}) });
      return {
        status: 200,
        headers: {},
        body: ENTRY_HTML,
        finalUrl: 'https://example.com/',
        tierUsed: 'static',
        timingMs: 1,
        attempts: 1,
        redirects: 0,
      };
    });
    const secrets = new EnvSecretsProvider({ env: { CRAWL_SECRET_TOK: 'tk' } });
    const audit = new InMemoryAuditLog();
    const result = await confirmScope(
      {
        entryUrl: 'https://example.com/',
        goal: 'extract page titles',
        auth: { type: 'bearer', secret: 'tok' },
      },
      { fetcher, llm, secrets, auditLog: audit, now: FIXED_NOW },
    );
    expect(result.estimate.authenticated).toBe(true);
    expect(result.config.auth).toEqual({ type: 'bearer', secret: 'tok' });
    expect(seen[0]?.['Authorization']).toBe('Bearer tk');
    // Auth resolution should have emitted a secret-accessed audit event.
    expect(audit.events().some((e) => e.kind === 'secret-accessed')).toBe(true);
  });

  it('refuses to attach auth when no SecretsProvider is configured', async () => {
    const llm = new MockLLMProvider(responder);
    const fetcher = staticFetcher(() => ({
      status: 200,
      headers: {},
      body: ENTRY_HTML,
      finalUrl: 'https://example.com/',
      tierUsed: 'static',
      timingMs: 1,
      attempts: 1,
      redirects: 0,
    }));
    await expect(
      confirmScope(
        {
          entryUrl: 'https://example.com/',
          goal: 'titles',
          auth: { type: 'bearer', secret: 'tok' },
        },
        { fetcher, llm },
      ),
    ).rejects.toBeInstanceOf(ScopeConfirmError);
  });

  it('surfaces a 502 when the entry URL fails', async () => {
    const llm = new MockLLMProvider(responder);
    const fetcher = staticFetcher(() => ({
      status: 503,
      headers: {},
      body: '',
      finalUrl: 'https://example.com/',
      tierUsed: 'static',
      timingMs: 1,
      attempts: 1,
      redirects: 0,
    }));
    try {
      await confirmScope({ entryUrl: 'https://example.com/', goal: 'titles' }, { fetcher, llm });
      throw new Error('expected ScopeConfirmError');
    } catch (err) {
      expect(err).toBeInstanceOf(ScopeConfirmError);
      if (err instanceof ScopeConfirmError) expect(err.status).toBe(502);
    }
  });
});
