/**
 * Homepage nav parsing + doc-likeness scoring.
 *
 * The scoring is intentionally simple — keyword hits in the URL path or link
 * text, weighted by which region the link lives in (`<nav>` > `<header>` >
 * `<footer>` > body). The score is a hint for the orchestrator's confirm-scope
 * step, not a hard filter; the human always sees the candidate set before a
 * crawl runs.
 */

import { JSDOM } from 'jsdom';

export type NavRegion = 'nav' | 'header' | 'footer' | 'body';

export type NavLink = {
  href: string;
  text: string;
  score: number;
  region: NavRegion;
};

const DOC_KEYWORDS = [
  'doc',
  'docs',
  'documentation',
  'api',
  'reference',
  'guide',
  'guides',
  'tutorial',
  'tutorials',
  'manual',
  'handbook',
  'sdk',
  'developer',
  'developers',
  'learn',
];

const REGION_WEIGHT: Record<NavRegion, number> = {
  nav: 0.2,
  header: 0.1,
  footer: 0.05,
  body: 0,
};

export function extractNavLinks(html: string, baseUrl: string): NavLink[] {
  const dom = new JSDOM(html, { url: baseUrl });
  const doc = dom.window.document;

  const out: NavLink[] = [];
  const seen = new Set<string>();

  // Region-tagged passes — most specific wins per URL.
  const passes: Array<{ sel: string; region: NavRegion }> = [
    { sel: 'nav a[href]', region: 'nav' },
    { sel: 'header a[href]', region: 'header' },
    { sel: 'footer a[href]', region: 'footer' },
    { sel: 'a[href]', region: 'body' },
  ];

  for (const { sel, region } of passes) {
    const nodes = doc.querySelectorAll(sel);
    for (const a of nodes) {
      const rawHref = a.getAttribute('href');
      if (!rawHref) continue;
      let abs: URL;
      try {
        abs = new URL(rawHref, baseUrl);
      } catch {
        continue;
      }
      if (abs.protocol !== 'http:' && abs.protocol !== 'https:') continue;
      const href = abs.toString();
      if (seen.has(href)) continue;
      seen.add(href);
      const text = (a.textContent ?? '').trim();
      out.push({ href, text, region, score: scoreDocLikeness(href, text, region) });
    }
  }

  out.sort((a, b) => b.score - a.score || a.href.localeCompare(b.href));
  return out;
}

export function scoreDocLikeness(href: string, text: string, region: NavRegion): number {
  const url = href.toLowerCase();
  const t = text.toLowerCase().trim();

  let pathHits = 0;
  for (const k of DOC_KEYWORDS) {
    if (
      url.includes(`/${k}/`) ||
      url.includes(`/${k}.`) ||
      url.endsWith(`/${k}`) ||
      url.includes(`.${k}.`) ||
      url.includes(`${k}.`)
    ) {
      pathHits++;
    }
  }

  let textHits = 0;
  for (const k of DOC_KEYWORDS) {
    if (t === k || t.startsWith(`${k} `) || t.endsWith(` ${k}`) || t.includes(` ${k} `)) {
      textHits++;
    }
  }

  let score = 0;
  score += Math.min(pathHits * 0.4, 0.6);
  score += Math.min(textHits * 0.3, 0.4);
  score += REGION_WEIGHT[region];

  return Math.min(score, 1);
}
