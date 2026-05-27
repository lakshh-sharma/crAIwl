import { describe, expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';
import { discoverSitemaps, type SitemapFetch } from './sitemap.js';
import { parseRobotsTxt } from '@craiwl/fetcher';

const urlset = (...urls: Array<{ loc: string; lastmod?: string }>) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n')}
</urlset>`;

const sitemapindex = (...locs: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${locs.map((l) => `  <sitemap><loc>${l}</loc></sitemap>`).join('\n')}
</sitemapindex>`;

const fakeFetcher = (
  map: Record<string, { status?: number; body: Buffer | string }>,
): SitemapFetch => {
  return async (url: string) => {
    const hit = map[url];
    if (!hit) return { status: 404, body: Buffer.alloc(0) };
    const body = typeof hit.body === 'string' ? Buffer.from(hit.body, 'utf8') : hit.body;
    return { status: hit.status ?? 200, body };
  };
};

describe('discoverSitemaps', () => {
  it('falls back to /sitemap.xml and parses urlset entries', async () => {
    const fetchImpl = fakeFetcher({
      'https://example.com/sitemap.xml': {
        body: urlset(
          { loc: 'https://example.com/a', lastmod: '2025-01-02' },
          { loc: 'https://example.com/b' },
        ),
      },
    });
    const r = await discoverSitemaps('https://example.com', { fetchImpl });
    expect(r.urls).toEqual([
      { loc: 'https://example.com/a', lastmod: '2025-01-02' },
      { loc: 'https://example.com/b' },
    ]);
    expect(r.visited).toEqual(['https://example.com/sitemap.xml']);
    expect(r.skipped).toEqual([]);
  });

  it('prefers sitemap URLs from robots.txt when available', async () => {
    const robots = parseRobotsTxt(
      'Sitemap: https://example.com/custom-sitemap.xml\nUser-agent: *\nAllow: /\n',
    );
    const fetchImpl = fakeFetcher({
      'https://example.com/custom-sitemap.xml': { body: urlset({ loc: 'https://example.com/x' }) },
      'https://example.com/sitemap.xml': { status: 404, body: '' },
    });
    const r = await discoverSitemaps('https://example.com', { robots, fetchImpl });
    expect(r.visited).toContain('https://example.com/custom-sitemap.xml');
    expect(r.urls.map((u) => u.loc)).toEqual(['https://example.com/x']);
  });

  it('follows sitemap-index chains up to maxDepth', async () => {
    const fetchImpl = fakeFetcher({
      'https://example.com/sitemap.xml': {
        body: sitemapindex('https://example.com/a.xml', 'https://example.com/b.xml'),
      },
      'https://example.com/a.xml': { body: urlset({ loc: 'https://example.com/page-1' }) },
      'https://example.com/b.xml': { body: urlset({ loc: 'https://example.com/page-2' }) },
    });
    const r = await discoverSitemaps('https://example.com', { fetchImpl });
    expect(r.urls.map((u) => u.loc).sort()).toEqual([
      'https://example.com/page-1',
      'https://example.com/page-2',
    ]);
    expect(r.visited).toHaveLength(3);
  });

  it('stops descending past maxDepth and records skipped', async () => {
    const fetchImpl = fakeFetcher({
      'https://example.com/sitemap.xml': { body: sitemapindex('https://example.com/level-1.xml') },
      'https://example.com/level-1.xml': { body: sitemapindex('https://example.com/level-2.xml') },
      'https://example.com/level-2.xml': { body: urlset({ loc: 'https://example.com/deep' }) },
    });
    const r = await discoverSitemaps('https://example.com', { fetchImpl, maxDepth: 1 });
    expect(r.urls).toEqual([]);
    expect(r.skipped.find((s) => s.url === 'https://example.com/level-2.xml')).toBeDefined();
  });

  it('decompresses .gz sitemaps', async () => {
    const xml = urlset({ loc: 'https://example.com/gz-page' });
    const fetchImpl = fakeFetcher({
      'https://example.com/sitemap.xml.gz': { body: gzipSync(Buffer.from(xml, 'utf8')) },
      'https://example.com/sitemap.xml': { status: 404, body: '' },
    });
    const robots = parseRobotsTxt('Sitemap: https://example.com/sitemap.xml.gz\n');
    const r = await discoverSitemaps('https://example.com', { robots, fetchImpl });
    expect(r.urls.map((u) => u.loc)).toEqual(['https://example.com/gz-page']);
  });

  it('detects gzip by magic bytes even without a .gz suffix', async () => {
    const xml = urlset({ loc: 'https://example.com/magic' });
    const fetchImpl = fakeFetcher({
      'https://example.com/sitemap.xml': { body: gzipSync(Buffer.from(xml, 'utf8')) },
    });
    const r = await discoverSitemaps('https://example.com', { fetchImpl });
    expect(r.urls.map((u) => u.loc)).toEqual(['https://example.com/magic']);
  });

  it('dedupes URLs across multiple sitemaps', async () => {
    const fetchImpl = fakeFetcher({
      'https://example.com/sitemap.xml': {
        body: sitemapindex('https://example.com/a.xml', 'https://example.com/b.xml'),
      },
      'https://example.com/a.xml': { body: urlset({ loc: 'https://example.com/dup' }) },
      'https://example.com/b.xml': {
        body: urlset({ loc: 'https://example.com/dup' }, { loc: 'https://example.com/uniq' }),
      },
    });
    const r = await discoverSitemaps('https://example.com', { fetchImpl });
    expect(r.urls.map((u) => u.loc).sort()).toEqual([
      'https://example.com/dup',
      'https://example.com/uniq',
    ]);
  });

  it('skips a missing sitemap.xml without throwing', async () => {
    const fetchImpl = fakeFetcher({});
    const r = await discoverSitemaps('https://example.com', { fetchImpl });
    expect(r.urls).toEqual([]);
    expect(r.skipped[0]!.reason).toMatch(/status-404/);
  });

  it('survives parse errors on a single sitemap', async () => {
    const fetchImpl = fakeFetcher({
      'https://example.com/sitemap.xml': { body: '<<<not xml>>>' },
    });
    const r = await discoverSitemaps('https://example.com', { fetchImpl });
    expect(r.urls).toEqual([]);
    // Either parse-error or not-a-sitemap is acceptable depending on parser behavior; both indicate graceful handling.
    expect(r.skipped[0]!.reason).toMatch(/parse-error|not-a-sitemap/);
  });

  it('caps URLs at maxUrls', async () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ loc: `https://example.com/p${i}` }));
    const fetchImpl = fakeFetcher({
      'https://example.com/sitemap.xml': { body: urlset(...many) },
    });
    const r = await discoverSitemaps('https://example.com', { fetchImpl, maxUrls: 3 });
    expect(r.urls).toHaveLength(3);
  });
});
