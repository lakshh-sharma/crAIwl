import { describe, expect, it } from 'vitest';
import { detectLocatorKind, parseHtml, testLocator, testLocatorOnDom } from './locator-validate.js';

const html = `<!doctype html>
<html><body>
  <main>
    <article class="post">
      <h1 id="title">Hello</h1>
      <p class="byline">By Acme</p>
      <div class="price" data-currency="usd">$19</div>
    </article>
    <article class="post">
      <h1>Goodbye</h1>
      <div class="price">$29</div>
    </article>
  </main>
</body></html>`;

describe('detectLocatorKind', () => {
  it('treats leading // and / as XPath', () => {
    expect(detectLocatorKind('//h1')).toBe('xpath');
    expect(detectLocatorKind('/html/body')).toBe('xpath');
    expect(detectLocatorKind('(//div)[1]')).toBe('xpath');
  });

  it('treats anything else as CSS', () => {
    expect(detectLocatorKind('article.post > h1')).toBe('css');
    expect(detectLocatorKind('#title')).toBe('css');
    expect(detectLocatorKind('[data-currency="usd"]')).toBe('css');
  });
});

describe('testLocator', () => {
  it('resolves CSS selectors and counts matches', () => {
    const r = testLocator(html, 'article.post .price');
    expect(r.resolves).toBe(true);
    expect(r.matchCount).toBe(2);
    expect(r.sampleText).toBe('$19');
  });

  it('returns resolves=false when the CSS selector matches nothing', () => {
    const r = testLocator(html, '.nope');
    expect(r).toMatchObject({ resolves: false, matchCount: 0 });
  });

  it('resolves XPath expressions', () => {
    const r = testLocator(html, '//article[contains(@class,"post")]/h1');
    expect(r.kind).toBe('xpath');
    expect(r.resolves).toBe(true);
    expect(r.matchCount).toBe(2);
    expect(r.sampleText).toBe('Hello');
  });

  it('returns an error message for invalid CSS', () => {
    const r = testLocator(html, '.broken[[');
    expect(r.resolves).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it('handles invalid XPath without throwing', () => {
    const r = testLocator(html, '//div[bad(');
    expect(r.resolves).toBe(false);
    expect(r.matchCount).toBe(0);
  });

  it('truncates long sample text with an ellipsis', () => {
    const longText = 'x'.repeat(200);
    const r = testLocator(`<div>${longText}</div>`, 'div');
    expect(r.sampleText!.endsWith('…')).toBe(true);
    expect(r.sampleText!.length).toBeLessThanOrEqual(121);
  });

  it('reuses a parsed DOM across multiple locator tests', () => {
    const dom = parseHtml(html);
    const r1 = testLocatorOnDom(dom, '#title');
    const r2 = testLocatorOnDom(dom, '.price');
    expect(r1.resolves).toBe(true);
    expect(r2.matchCount).toBe(2);
  });
});
