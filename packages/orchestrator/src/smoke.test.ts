/**
 * End-to-end smoke test.
 *
 * Boots a real HTTP server with a small index + two leaf pages and runs the
 * entire pipeline — fetch entry → compile (mocked LLM) → crawl → extract →
 * partition → audit + manifest. Exercises Tier0Fetcher, RobotsCache, the
 * frontier, the politeness gate, and every output the CLI relies on,
 * without hitting Anthropic or the network.
 *
 * If this fails, something deep in the wiring is broken — it's the test we
 * want to look at first when a new release smells off.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { MockLLMProvider } from '@craiwl/core';
import { Tier0Fetcher, RobotsCache } from '@craiwl/fetcher';
import { runJob } from './output/run.js';

const FIXED_NOW = () => new Date('2026-06-02T12:00:00.000Z');

// Readability strips the leading <h1> on the assumption it's the article
// title (which it surfaces separately). The fixture uses a classed <p>
// instead so the title element survives into the cleaned HTML — that's
// what the executor's locator runs against.
const LOREM = Array.from({ length: 8 })
  .map(
    () =>
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
  )
  .join(' ');

const INDEX = `<!doctype html><html><head><title>Docs index</title></head><body><main><article>
  <p class="article-title">Docs</p>
  <p>Welcome to the docs site. ${LOREM}</p>
  <p>${LOREM}</p>
  <ul>
    <li><a href="/a">Article A</a></li>
    <li><a href="/b">Article B</a></li>
    <li><a href="/c">Article C</a></li>
  </ul>
</article></main></body></html>`;

const article = (title: string, body: string): string =>
  `<!doctype html><html><head><title>${title}</title></head><body><main><article>
    <p class="article-title">${title}</p>
    <p>${body}. ${LOREM}</p>
    <p>${LOREM}</p>
  </article></main></body></html>`;

/**
 * Two-call responder — the orchestrator does field-schema then locator
 * synthesis. The strategy targets the article's <h1> and a single-record
 * shape so every page contributes one record.
 */
const responder = (tool: { name: string }): unknown => {
  if (tool.name === 'emit_field_schema') {
    return {
      fields: [
        {
          name: 'title',
          type: 'string',
          required: true,
          description: 'article title',
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
          semanticAnchor: 'article title at the top of the page',
        },
      ],
    };
  }
  throw new Error(`unexpected tool: ${tool.name}`);
};

type Routes = Record<string, { status: number; body: string }>;

const ROUTES: Routes = {
  '/': { status: 200, body: INDEX },
  '/a': { status: 200, body: article('Hello A', 'first article') },
  '/b': { status: 200, body: article('Hello B', 'second article') },
  '/c': { status: 200, body: article('Hello C', 'third article') },
  '/robots.txt': { status: 200, body: '' },
};

describe('end-to-end smoke', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const route = ROUTES[req.url ?? '/'];
      if (!route) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
        return;
      }
      res.writeHead(route.status, { 'content-type': 'text/html; charset=utf-8' });
      res.end(route.body);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it('compiles a config, crawls every page, and extracts every title', async () => {
    const fetcher = new Tier0Fetcher({ userAgent: 'craiwl-smoke' });
    const robotsCache = new RobotsCache({ fetcher });
    const llm = new MockLLMProvider(responder);

    const result = await runJob({
      entryUrl: `${base}/`,
      goal: 'extract article titles from the docs site',
      fetcher,
      robotsCache,
      userAgent: 'craiwl-smoke',
      llm,
      // section scope keeps us inside this origin; default depth+pages are fine
      now: FIXED_NOW,
    });

    // The compile step ran twice (field-schema + synthesis).
    expect(llm.calls.length).toBe(2);

    // Index plus three articles — entry contributes a record via 'Docs', so
    // we expect four titles total.
    expect(result.crawl.pagesCrawled).toBeGreaterThanOrEqual(4);
    const titles = result.records
      .map((r) => (r.fields['title']?.ok ? r.fields['title']!.value : null))
      .filter((v): v is string => typeof v === 'string')
      .sort();
    expect(titles).toContain('Hello A');
    expect(titles).toContain('Hello B');
    expect(titles).toContain('Hello C');

    // Manifest is sane.
    expect(result.manifest.counts.pagesCrawled).toBe(result.crawl.pagesCrawled);
    expect(result.manifest.compliance.authProfile).toBeNull();
    expect(result.manifest.compliance.robotsBypasses).toBe(0);
    expect(result.manifest.compliance.httpAuthFailures).toBe(0);

    // No failures.
    expect(result.crawl.failures).toEqual([]);
  });
});
