import { JSDOM, VirtualConsole } from 'jsdom';
import { Readability, isProbablyReaderable } from '@mozilla/readability';

/**
 * Result of cleaning a raw HTML page. The cleaned DOM is the artifact the
 * executor (and locator-generation prompts) run against. The markdown
 * rendering is the lower-token representation used in compile prompts when
 * the LLM benefits from a flatter view. Both are derived from the same
 * underlying content extraction so they stay in sync.
 */
export type CleanedPage = {
  /** Serialized cleaned HTML body — what the executor's selectors run against. */
  html: string;
  /** Plain-text rendering of the cleaned content. */
  textContent: string;
  /** Whether Readability judged this page article-like enough to extract a main region. */
  readerable: boolean;
  /** Title chosen by Readability (or `<title>` if Readability had nothing). */
  title: string | undefined;
  /** Byline / author string if Readability found one. */
  byline: string | undefined;
  /** Detected language tag (`<html lang>`) if present. */
  lang: string | undefined;
};

export type CleanOptions = {
  /**
   * Tags that get removed wholesale before Readability runs. Defaults cover the
   * common boilerplate that Readability sometimes leaves behind on pricing
   * pages and docs (it's tuned for articles, where these are less aggressive).
   */
  stripTags?: string[];
  /**
   * CSS selectors removed wholesale before extraction. Defaults strip cookie
   * banners, ads, and analytics shells.
   */
  stripSelectors?: string[];
  /** Base URL used to resolve relative links/images. */
  baseUrl?: string;
};

const DEFAULT_STRIP_TAGS = [
  'script',
  'noscript',
  'style',
  'iframe',
  'embed',
  'object',
  'svg',
  'canvas',
];

const DEFAULT_STRIP_SELECTORS = [
  'nav',
  'header[role="banner"]',
  'footer',
  '[role="contentinfo"]',
  '[role="navigation"]',
  '[id*="cookie"]',
  '[class*="cookie"]',
  '[id*="banner"]',
  '[class*="banner"]',
  '[id*="newsletter"]',
  '[class*="newsletter"]',
  '[aria-label*="advert"]',
  '[id*="ad-"]',
  '[class*="ad-"]',
  '[class*="ads-"]',
  '.advertisement',
];

/**
 * Cleans raw HTML into a deterministic, denoised DOM. Same input → same
 * output (Readability is deterministic given a fixed jsdom version), so the
 * compile prompt is cacheable.
 */
export function cleanHtml(rawHtml: string, opts: CleanOptions = {}): CleanedPage {
  const virtualConsole = new VirtualConsole(); // swallow JSDOM warnings — we don't run scripts
  const dom = new JSDOM(rawHtml, {
    ...(opts.baseUrl ? { url: opts.baseUrl } : {}),
    virtualConsole,
  });
  const doc = dom.window.document;
  const lang = doc.documentElement.getAttribute('lang') ?? undefined;
  const titleEl = doc.querySelector('title');
  const docTitle = titleEl?.textContent?.trim() || undefined;

  // Strip boilerplate before Readability sees it. Readability has its own
  // heuristics, but pre-stripping nav/footer/cookie shells gives consistently
  // better results on non-article pages (docs, pricing, listings).
  const stripTags = opts.stripTags ?? DEFAULT_STRIP_TAGS;
  for (const tag of stripTags) {
    for (const el of Array.from(doc.querySelectorAll(tag))) el.remove();
  }
  const stripSelectors = opts.stripSelectors ?? DEFAULT_STRIP_SELECTORS;
  for (const sel of stripSelectors) {
    for (const el of Array.from(doc.querySelectorAll(sel))) el.remove();
  }

  // isProbablyReaderable is cheap; use it to record whether the page actually
  // looks article-like. For pricing/docs pages it'll often say no — which is
  // fine, we still run Readability and fall back to the stripped body.
  const readerable = isProbablyReaderable(doc);

  // Readability mutates the document, so clone first.
  const clonedDoc = dom.window.document.cloneNode(true) as Document;
  const reader = new Readability(clonedDoc, {
    keepClasses: true, // selector generation needs class names
    debug: false,
  });
  const article = reader.parse();

  if (article?.content) {
    return {
      html: article.content,
      textContent: (article.textContent ?? '').trim(),
      readerable,
      title: article.title ?? docTitle,
      byline: article.byline ?? undefined,
      lang,
    };
  }

  // Fallback: serialize the boilerplate-stripped body.
  const bodyHtml = doc.body?.innerHTML ?? doc.documentElement.outerHTML;
  const bodyText = doc.body?.textContent?.trim() ?? '';
  return {
    html: bodyHtml,
    textContent: bodyText,
    readerable,
    title: docTitle,
    byline: undefined,
    lang,
  };
}
