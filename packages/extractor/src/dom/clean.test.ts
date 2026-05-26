import { describe, it, expect } from 'vitest';
import { cleanHtml, htmlToMarkdown } from './index.js';

const wrap = (body: string, head = '') =>
  `<!doctype html><html lang="en"><head><title>Test</title>${head}</head><body>${body}</body></html>`;

describe('cleanHtml: boilerplate removal', () => {
  it('removes nav, footer, and cookie banners', () => {
    const html = wrap(`
      <nav><a href="/">Home</a></nav>
      <div id="cookie-banner">We use cookies <button>Accept</button></div>
      <main>
        <h1>Article Title</h1>
        <p>${'Real content '.repeat(40)}</p>
        <p>${'More real content '.repeat(40)}</p>
      </main>
      <footer>Copyright 2026</footer>
    `);
    const cleaned = cleanHtml(html);
    expect(cleaned.html).not.toContain('cookie-banner');
    expect(cleaned.html).not.toContain('Copyright 2026');
    expect(cleaned.html).not.toContain('Home</a>');
    expect(cleaned.textContent).toContain('Real content');
  });

  it('strips script and style tags', () => {
    const html = wrap(
      `
      <main>
        <h1>Title</h1>
        <p>${'Body content '.repeat(40)}</p>
      </main>
    `,
      '<style>body { color: red; }</style><script>window.x = 1;</script>',
    );
    const cleaned = cleanHtml(html);
    expect(cleaned.html).not.toContain('window.x');
    expect(cleaned.html).not.toContain('color: red');
  });

  it('honors custom stripSelectors', () => {
    const html = wrap(`
      <div class="newsletter-signup">Subscribe</div>
      <main>
        <h1>Title</h1>
        <p>${'Real content '.repeat(40)}</p>
      </main>
    `);
    const cleaned = cleanHtml(html, { stripSelectors: ['.newsletter-signup', 'footer'] });
    expect(cleaned.html).not.toContain('newsletter-signup');
    expect(cleaned.html).not.toContain('Subscribe');
  });
});

describe('cleanHtml: structure preservation', () => {
  it('keeps headings, lists, links, and tables for selector generation', () => {
    const html = wrap(`
      <main>
        <h1>Pricing</h1>
        <h2>Tiers</h2>
        <ul>
          <li>Free</li>
          <li>Pro</li>
        </ul>
        <table>
          <thead><tr><th>Plan</th><th>Price</th></tr></thead>
          <tbody>
            <tr><td>Free</td><td>$0</td></tr>
            <tr><td>Pro</td><td>$10</td></tr>
          </tbody>
        </table>
        <p><a href="/contact">Contact sales</a> for enterprise.</p>
      </main>
    `);
    const cleaned = cleanHtml(html);
    // The page title shows up somewhere — Readability promotes H1 onto
    // `title`, leaves it in content, or both; any of those is fine.
    const titleSeen =
      cleaned.title?.includes('Pricing') ||
      cleaned.html.includes('Pricing') ||
      cleaned.textContent.includes('Pricing');
    expect(titleSeen).toBe(true);
    expect(cleaned.html).toMatch(/<h2[^>]*>Tiers<\/h2>/);
    expect(cleaned.html).toContain('<ul>');
    expect(cleaned.html).toContain('<li>Free</li>');
    expect(cleaned.html).toContain('<table>');
    expect(cleaned.html).toMatch(/href="[^"]*\/contact"/);
  });

  it('preserves data-* attributes used as anchors for selectors', () => {
    const html = wrap(`
      <main>
        <h1>Pricing</h1>
        <div data-tier="free">
          <h3 class="tier-name">Free</h3>
          <span data-testid="price">$0</span>
        </div>
        <div data-tier="pro">
          <h3 class="tier-name">Pro</h3>
          <span data-testid="price">$10</span>
        </div>
        <p>${'Some narrative '.repeat(40)}</p>
      </main>
    `);
    const cleaned = cleanHtml(html);
    expect(cleaned.html).toContain('data-tier="free"');
    expect(cleaned.html).toContain('data-tier="pro"');
    expect(cleaned.html).toContain('data-testid="price"');
    expect(cleaned.html).toContain('class="tier-name"');
  });
});

describe('cleanHtml: metadata extraction', () => {
  it('captures title, lang', () => {
    const html = wrap(`<main><h1>X</h1><p>${'long '.repeat(40)}</p></main>`);
    const cleaned = cleanHtml(html);
    expect(cleaned.title).toBeDefined();
    expect(cleaned.lang).toBe('en');
  });
});

describe('cleanHtml: determinism', () => {
  it('produces identical output for identical input', () => {
    const html = wrap(`
      <nav>nav</nav>
      <main>
        <h1>Same</h1>
        <p>${'Deterministic content '.repeat(40)}</p>
      </main>
      <footer>f</footer>
    `);
    const a = cleanHtml(html);
    const b = cleanHtml(html);
    expect(a).toEqual(b);
  });
});

describe('cleanHtml: token-reduction benchmark', () => {
  const FIXTURES: Array<{ name: string; html: string }> = [
    {
      name: 'docs-page',
      html: wrap(`
        <nav>${'<a href="/x">Link</a>'.repeat(30)}</nav>
        <aside>${'<div>sidebar</div>'.repeat(20)}</aside>
        <main>
          <h1>API Reference</h1>
          <h2>POST /api/users</h2>
          <p>${'Creates a new user. '.repeat(20)}</p>
          <pre><code class="language-bash">curl -X POST /api/users</code></pre>
        </main>
        <footer>${'<a>x</a>'.repeat(30)}</footer>
      `),
    },
    {
      name: 'pricing-page',
      html: wrap(`
        <header role="banner">${'<a>nav</a>'.repeat(20)}</header>
        <div id="cookie-banner">${'cookies '.repeat(40)}</div>
        <main>
          <h1>Pricing</h1>
          <div data-tier="free"><h3>Free</h3><span data-testid="price">$0</span><p>${'Try us '.repeat(20)}</p></div>
          <div data-tier="pro"><h3>Pro</h3><span data-testid="price">$10</span><p>${'For teams '.repeat(20)}</p></div>
        </main>
        <footer>${'<a>x</a>'.repeat(30)}</footer>
      `),
    },
    {
      name: 'blog-post',
      html: wrap(`
        <nav>${'<a>n</a>'.repeat(40)}</nav>
        <article>
          <h1>Why crawlers are hard</h1>
          <p>${'The web is hostile. '.repeat(40)}</p>
          <p>${'TLS fingerprinting changed everything. '.repeat(30)}</p>
        </article>
        <aside>${'<div>related</div>'.repeat(20)}</aside>
        <footer>${'f'.repeat(200)}</footer>
      `),
    },
    {
      name: 'listing-page',
      html: wrap(`
        <nav>${'<a>n</a>'.repeat(30)}</nav>
        <main>
          <h1>All posts</h1>
          ${Array.from({ length: 8 })
            .map(
              (_, i) =>
                `<article><h2><a href="/p/${i}">Post ${i}</a></h2><p>${'Excerpt '.repeat(15)}</p></article>`,
            )
            .join('')}
        </main>
        <footer>${'<a>x</a>'.repeat(30)}</footer>
      `),
    },
    {
      name: 'simple-doc',
      html: wrap(`
        <header role="banner">${'<a>nav</a>'.repeat(20)}</header>
        <main>
          <h1>Getting Started</h1>
          <p>${'Install with pnpm add. '.repeat(20)}</p>
          <ol>
            <li>${'Step one '.repeat(10)}</li>
            <li>${'Step two '.repeat(10)}</li>
            <li>${'Step three '.repeat(10)}</li>
          </ol>
        </main>
        <footer>${'<a>x</a>'.repeat(30)}</footer>
      `),
    },
  ];

  it('reduces token estimate on every fixture and reports the ratio', () => {
    const charsToTokens = (n: number) => Math.ceil(n / 4); // rough estimate
    const rows: Array<[string, number, number, number]> = [];
    for (const fx of FIXTURES) {
      const cleaned = cleanHtml(fx.html);
      const beforeTokens = charsToTokens(fx.html.length);
      const afterTokens = charsToTokens(cleaned.html.length);
      rows.push([fx.name, beforeTokens, afterTokens, +(afterTokens / beforeTokens).toFixed(2)]);
      // Every fixture should shrink — that's the whole point.
      expect(afterTokens).toBeLessThan(beforeTokens);
    }
    console.error('\nclean-html token reduction:');
    console.error('  fixture          before  after   ratio');
    for (const r of rows) {
      console.error(
        `  ${r[0].padEnd(15)}  ${String(r[1]).padStart(5)}  ${String(r[2]).padStart(5)}  ${r[3]}`,
      );
    }
  });
});

describe('htmlToMarkdown', () => {
  it('renders headings, links, and lists as markdown', () => {
    const md = htmlToMarkdown(
      '<h1>Title</h1><p>Hello <a href="/x">there</a></p><ul><li>one</li><li>two</li></ul>',
    );
    expect(md).toContain('# Title');
    expect(md).toContain('[there](/x)');
    expect(md).toMatch(/[-*]\s+one[\s\S]*[-*]\s+two/);
  });

  it('drops images by default', () => {
    const md = htmlToMarkdown('<p>before<img src="/x.png" alt="x">after</p>');
    expect(md).not.toContain('x.png');
  });

  it('preserves fenced code blocks with language hints', () => {
    const md = htmlToMarkdown('<pre><code class="language-ts">const x = 1;</code></pre>');
    expect(md).toContain('```ts');
    expect(md).toContain('const x = 1;');
  });
});
