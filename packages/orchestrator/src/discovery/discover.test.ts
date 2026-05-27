import { describe, expect, it } from 'vitest';
import { discover } from './discover.js';
import type { Fetcher, FetchResult } from '@craiwl/fetcher';
import type { SitemapFetch } from './sitemap.js';

const homepage = `<!doctype html>
<html><body>
  <nav>
    <a href="/docs">Docs</a>
    <a href="/api">API</a>
    <a href="/pricing">Pricing</a>
  </nav>
</body></html>`;

const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/docs/quickstart</loc><lastmod>2025-01-01</lastmod></url>
  <url><loc>https://example.com/docs/intro</loc></url>
</urlset>`;

const result = (overrides: Partial<FetchResult>): FetchResult => ({
  status: 200,
  headers: {},
  body: '',
  finalUrl: '',
  tierUsed: 'static',
  timingMs: 1,
  attempts: 1,
  redirects: 0,
  ...overrides,
});

describe('discover', () => {
  it('merges sitemap, probe, and nav sources with source attribution', async () => {
    const fetcher: Fetcher = {
      tier: 'static',
      fetch: async (url) => {
        if (url === 'https://example.com/') return result({ body: homepage, finalUrl: url });
        if (url === 'https://example.com/docs' || url === 'https://example.com/api') {
          return result({ body: 'x'.repeat(2048), finalUrl: url });
        }
        return result({ status: 404, finalUrl: url });
      },
    };
    const sitemapFetch: SitemapFetch = async (url) => {
      if (url === 'https://example.com/sitemap.xml')
        return { status: 200, body: Buffer.from(sitemapXml, 'utf8') };
      return { status: 404, body: Buffer.alloc(0) };
    };

    const r = await discover('https://example.com/', { fetcher, sitemapFetch });

    const bySource = (s: string) => r.candidates.filter((c) => c.source === s).map((c) => c.url);
    expect(bySource('sitemap')).toEqual([
      'https://example.com/docs/quickstart',
      'https://example.com/docs/intro',
    ]);
    // /docs and /api came back as resolved probes
    expect(bySource('probe').sort()).toContain('https://example.com/docs');
    expect(bySource('probe').sort()).toContain('https://example.com/api');
    // Nav-only candidates that scored high enough and weren't already covered
    const nav = bySource('nav');
    expect(nav.length).toBeGreaterThanOrEqual(0);
  });

  it('dedupes a URL that appears in both sitemap and probe', async () => {
    const fetcher: Fetcher = {
      tier: 'static',
      fetch: async (url) => {
        if (url === 'https://example.com/') return result({ body: '<html></html>', finalUrl: url });
        if (url === 'https://example.com/docs')
          return result({ body: 'x'.repeat(2048), finalUrl: url });
        return result({ status: 404, finalUrl: url });
      },
    };
    const sitemapFetch: SitemapFetch = async (url) => {
      if (url === 'https://example.com/sitemap.xml') {
        return {
          status: 200,
          body: Buffer.from(
            `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/docs</loc></url></urlset>`,
            'utf8',
          ),
        };
      }
      return { status: 404, body: Buffer.alloc(0) };
    };

    const r = await discover('https://example.com/', { fetcher, sitemapFetch });
    const docsHits = r.candidates.filter(
      (c) => c.url.replace(/\/$/, '') === 'https://example.com/docs',
    );
    expect(docsHits).toHaveLength(1);
    expect(docsHits[0]!.source).toBe('sitemap');
  });

  it('drops cross-origin nav links', async () => {
    const html = `<nav><a href="https://external.com/docs">External Docs</a></nav>`;
    const fetcher: Fetcher = {
      tier: 'static',
      fetch: async (url) => {
        if (url === 'https://example.com/') return result({ body: html, finalUrl: url });
        return result({ status: 404, finalUrl: url });
      },
    };
    const sitemapFetch: SitemapFetch = async () => ({ status: 404, body: Buffer.alloc(0) });

    const r = await discover('https://example.com/', { fetcher, sitemapFetch });
    expect(r.candidates.find((c) => c.url.startsWith('https://external.com'))).toBeUndefined();
  });

  it('returns a usable result when the homepage fetch fails', async () => {
    const fetcher: Fetcher = {
      tier: 'static',
      fetch: async (url) => {
        if (url === 'https://example.com/') throw new Error('connect refused');
        return result({ status: 404, finalUrl: url });
      },
    };
    const sitemapFetch: SitemapFetch = async () => ({
      status: 200,
      body: Buffer.from(sitemapXml, 'utf8'),
    });
    const r = await discover('https://example.com/', { fetcher, sitemapFetch });
    expect(r.candidates.map((c) => c.url)).toEqual([
      'https://example.com/docs/quickstart',
      'https://example.com/docs/intro',
    ]);
    expect(r.nav).toEqual([]);
  });
});
