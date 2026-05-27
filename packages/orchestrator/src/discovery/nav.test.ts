import { describe, expect, it } from 'vitest';
import { extractNavLinks, scoreDocLikeness } from './nav.js';

const homepage = `<!doctype html>
<html><head><title>Acme</title></head>
<body>
  <header>
    <nav>
      <a href="/docs">Docs</a>
      <a href="/api">API</a>
      <a href="/pricing">Pricing</a>
      <a href="https://github.com/acme/x">GitHub</a>
    </nav>
  </header>
  <main>
    <a href="/blog">Blog</a>
    <a href="/reference">Reference Manual</a>
    <a href="mailto:hi@acme.com">Email us</a>
    <a href="">empty</a>
  </main>
  <footer>
    <a href="/legal">Legal</a>
    <a href="/developers/sdk">SDK</a>
  </footer>
</body></html>`;

describe('extractNavLinks', () => {
  it('resolves relative URLs against the base and drops non-http(s) protocols', async () => {
    const links = extractNavLinks(homepage, 'https://acme.com/');
    const hrefs = links.map((l) => l.href);
    expect(hrefs).toContain('https://acme.com/docs');
    expect(hrefs).toContain('https://acme.com/api');
    expect(hrefs).toContain('https://github.com/acme/x');
    expect(hrefs.find((h) => h.startsWith('mailto:'))).toBeUndefined();
  });

  it('tags each link with its enclosing region (nav > header > footer > body)', async () => {
    const links = extractNavLinks(homepage, 'https://acme.com/');
    const byHref = Object.fromEntries(links.map((l) => [l.href, l.region]));
    expect(byHref['https://acme.com/docs']).toBe('nav');
    expect(byHref['https://acme.com/legal']).toBe('footer');
    expect(byHref['https://acme.com/blog']).toBe('body');
  });

  it('ranks doc-like links above non-doc links', async () => {
    const links = extractNavLinks(homepage, 'https://acme.com/');
    const docLikeHrefs = new Set([
      'https://acme.com/docs',
      'https://acme.com/api',
      'https://acme.com/reference',
      'https://acme.com/developers/sdk',
    ]);
    const nonDocHrefs = new Set([
      'https://acme.com/pricing',
      'https://acme.com/blog',
      'https://acme.com/legal',
    ]);
    const minDoc = Math.min(...links.filter((l) => docLikeHrefs.has(l.href)).map((l) => l.score));
    const maxNonDoc = Math.max(...links.filter((l) => nonDocHrefs.has(l.href)).map((l) => l.score));
    expect(minDoc).toBeGreaterThan(maxNonDoc);
  });

  it('dedupes the same href across regions', async () => {
    const html = `<html><body>
      <nav><a href="/docs">Docs</a></nav>
      <main><a href="/docs">Docs again</a></main>
    </body></html>`;
    const links = extractNavLinks(html, 'https://acme.com/');
    expect(links.filter((l) => l.href === 'https://acme.com/docs')).toHaveLength(1);
  });
});

describe('scoreDocLikeness', () => {
  it('scores higher when path AND text both hint at docs', () => {
    expect(scoreDocLikeness('https://x/docs', 'Documentation', 'nav')).toBeGreaterThan(
      scoreDocLikeness('https://x/docs', 'Click here', 'body'),
    );
  });

  it('rewards exact-keyword link text', () => {
    expect(scoreDocLikeness('https://x/foo', 'API', 'nav')).toBeGreaterThan(
      scoreDocLikeness('https://x/foo', 'Capabilities', 'nav'),
    );
  });

  it('caps at 1', () => {
    expect(
      scoreDocLikeness('https://x/docs/api/reference', 'Docs API Reference Guide', 'nav'),
    ).toBeLessThanOrEqual(1);
  });
});
