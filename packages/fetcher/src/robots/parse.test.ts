import { describe, expect, it } from 'vitest';
import { getCrawlDelay, isAllowed, parseRobotsTxt } from './parse.js';

describe('parseRobotsTxt', () => {
  it('parses user-agent groups, allow/disallow, sitemap, and crawl-delay', () => {
    const text = `
      # comment
      User-agent: Googlebot
      Disallow: /private/
      Allow: /private/public

      User-agent: *
      Disallow: /tmp/
      Crawl-delay: 2

      Sitemap: https://example.com/sitemap.xml
    `;
    const rules = parseRobotsTxt(text);
    expect(rules.groups).toHaveLength(2);
    expect(rules.groups[0]!.userAgents).toEqual(['googlebot']);
    expect(rules.groups[0]!.rules.map((r) => r.kind + ' ' + r.pattern)).toEqual([
      'disallow /private/',
      'allow /private/public',
    ]);
    expect(rules.groups[1]!.crawlDelaySec).toBe(2);
    expect(rules.sitemaps).toEqual(['https://example.com/sitemap.xml']);
    expect(rules.wellFormed).toBe(true);
  });

  it('treats empty Disallow as "no rule" (allow everything for that group)', () => {
    const text = `User-agent: *\nDisallow:\n`;
    const rules = parseRobotsTxt(text);
    expect(rules.groups[0]!.rules).toHaveLength(0);
    expect(isAllowed(rules, '/anything', 'craiwl')).toBe(true);
  });

  it('ignores rules outside any group and marks not-well-formed', () => {
    const text = `Disallow: /lost\nUser-agent: *\nDisallow: /found`;
    const rules = parseRobotsTxt(text);
    expect(rules.wellFormed).toBe(false);
    expect(rules.groups).toHaveLength(1);
    expect(rules.groups[0]!.rules[0]!.pattern).toBe('/found');
  });
});

describe('isAllowed: RFC 9309 longest-match', () => {
  const text = `
    User-agent: *
    Disallow: /private/
    Allow: /private/public/
    Disallow: /docs$
  `;
  const rules = parseRobotsTxt(text);

  it('disallows by default match', () => {
    expect(isAllowed(rules, '/private/inner', 'craiwl')).toBe(false);
  });

  it('allow wins when its pattern is longer', () => {
    expect(isAllowed(rules, '/private/public/file', 'craiwl')).toBe(true);
  });

  it('allows paths the file does not mention', () => {
    expect(isAllowed(rules, '/anything-else', 'craiwl')).toBe(true);
  });

  it('honors the $ end-anchor', () => {
    // /docs$ only matches the exact /docs URL, not /docs/page
    expect(isAllowed(rules, '/docs', 'craiwl')).toBe(false);
    expect(isAllowed(rules, '/docs/page', 'craiwl')).toBe(true);
  });

  it('tiebreaks equal-length allow vs disallow in favor of allow', () => {
    const text = `User-agent: *\nDisallow: /x\nAllow: /x`;
    const r = parseRobotsTxt(text);
    expect(isAllowed(r, '/x', 'craiwl')).toBe(true);
  });
});

describe('isAllowed: wildcards', () => {
  const text = `
    User-agent: *
    Disallow: /*.pdf$
    Allow: /
  `;
  const rules = parseRobotsTxt(text);

  it('matches via *', () => {
    expect(isAllowed(rules, '/papers/file.pdf', 'craiwl')).toBe(false);
    expect(isAllowed(rules, '/papers/file.html', 'craiwl')).toBe(true);
  });
});

describe('isAllowed: user-agent selection', () => {
  const text = `
    User-agent: Googlebot
    Disallow: /

    User-agent: *
    Allow: /
  `;
  const rules = parseRobotsTxt(text);

  it('matches the most-specific UA by case-insensitive prefix', () => {
    expect(isAllowed(rules, '/any', 'Googlebot-News/2.1')).toBe(false);
    expect(isAllowed(rules, '/any', 'craiwl/0.1')).toBe(true);
  });

  it('uses * as fallback when no specific group matches', () => {
    expect(isAllowed(rules, '/x', 'random-bot')).toBe(true);
  });
});

describe('getCrawlDelay', () => {
  const text = `
    User-agent: craiwl
    Crawl-delay: 5

    User-agent: *
    Crawl-delay: 2
  `;
  const rules = parseRobotsTxt(text);

  it('returns the specific UA crawl-delay when matched', () => {
    expect(getCrawlDelay(rules, 'craiwl/0.1')).toBe(5);
  });

  it('falls back to *', () => {
    expect(getCrawlDelay(rules, 'other-bot')).toBe(2);
  });

  it('returns undefined when no group declares one', () => {
    expect(getCrawlDelay(parseRobotsTxt('User-agent: *\nDisallow: /'), 'x')).toBeUndefined();
  });
});

describe('isAllowed: missing/empty file', () => {
  it('allows everything for an empty robots.txt', () => {
    const rules = parseRobotsTxt('');
    expect(isAllowed(rules, '/whatever', 'craiwl')).toBe(true);
  });

  it('allows everything when robots.txt has no rules for the UA', () => {
    const rules = parseRobotsTxt('User-agent: Other\nDisallow: /\n');
    expect(isAllowed(rules, '/whatever', 'craiwl')).toBe(true);
  });
});

describe('parseRobotsTxt: comments and casing', () => {
  it('strips trailing # comments', () => {
    const rules = parseRobotsTxt('User-agent: * # everyone\nDisallow: /admin # secret\n');
    expect(rules.groups[0]!.userAgents).toEqual(['*']);
    expect(rules.groups[0]!.rules[0]!.pattern).toBe('/admin');
  });

  it('lower-cases user-agent tokens but preserves path case', () => {
    const rules = parseRobotsTxt('User-agent: CrAIwl\nDisallow: /Private\n');
    expect(rules.groups[0]!.userAgents).toEqual(['craiwl']);
    expect(isAllowed(rules, '/Private', 'craiwl')).toBe(false);
    expect(isAllowed(rules, '/private', 'craiwl')).toBe(true); // path is case-sensitive
  });
});
