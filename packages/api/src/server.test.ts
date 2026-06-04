import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MockLLMProvider } from '@craiwl/core';
import type { FetchRequestOptions, FetchResult, Fetcher } from '@craiwl/fetcher';
import { createServer, type CraiwlServer } from './server.js';

const LOREM = Array.from({ length: 6 })
  .map(
    () =>
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
  )
  .join(' ');

const ENTRY_HTML = `<!doctype html><html><head><title>Index</title></head><body><main><article>
  <p class="article-title">Docs</p>
  <p>${LOREM}</p>
  <p>${LOREM}</p>
</article></main></body></html>`;

const responder = (tool: { name: string }): unknown => {
  if (tool.name === 'emit_field_schema')
    return {
      fields: [
        { name: 'title', type: 'string', required: true, description: 'title', inferred: true },
      ],
    };
  if (tool.name === 'emit_strategy')
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
  throw new Error(`unexpected tool: ${tool.name}`);
};

const okFetcher = (): Fetcher => ({
  tier: 'static',
  fetch: async (_url: string, _opts?: FetchRequestOptions): Promise<FetchResult> => ({
    status: 200,
    headers: {},
    body: ENTRY_HTML,
    finalUrl: 'https://example.com/',
    tierUsed: 'static',
    timingMs: 1,
    attempts: 1,
    redirects: 0,
  }),
});

describe('createServer', () => {
  let s: CraiwlServer;
  let base: string;

  beforeEach(async () => {
    s = createServer({ fetcher: okFetcher(), llm: new MockLLMProvider(responder) });
    const port = await s.listen(0);
    base = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await s.close();
  });

  it('serves GET /healthz', async () => {
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('404s on unknown routes', async () => {
    const res = await fetch(`${base}/nope`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('not-found');
  });

  it('400s POST /scope/confirm with an empty body', async () => {
    const res = await fetch(`${base}/scope/confirm`, { method: 'POST' });
    expect(res.status).toBe(400);
  });

  it('400s POST /scope/confirm with invalid JSON', async () => {
    const res = await fetch(`${base}/scope/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not-json',
    });
    expect(res.status).toBe(400);
  });

  it('200s POST /scope/confirm with a valid body', async () => {
    const res = await fetch(`${base}/scope/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entryUrl: 'https://example.com/', goal: 'titles' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      config: { pageTemplates: unknown[] };
      estimate: { templatesProposed: number; fieldsProposed: number };
    };
    expect(body.config.pageTemplates.length).toBe(1);
    expect(body.estimate.templatesProposed).toBe(1);
    expect(body.estimate.fieldsProposed).toBe(1);
  });

  it('surfaces ScopeConfirmError status codes verbatim', async () => {
    const res = await fetch(`${base}/scope/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entryUrl: '', goal: 'titles' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('scope-confirm-failed');
  });

  it('rejects bodies larger than maxBodyBytes', async () => {
    await s.close();
    s = createServer({
      fetcher: okFetcher(),
      llm: new MockLLMProvider(responder),
      maxBodyBytes: 100,
    });
    const port = await s.listen(0);
    base = `http://127.0.0.1:${port}`;
    const huge = 'x'.repeat(500);
    const res = await fetch(`${base}/scope/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entryUrl: 'https://example.com/', goal: huge }),
    });
    expect(res.status).toBe(400);
  });
});
