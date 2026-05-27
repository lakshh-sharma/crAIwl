/**
 * Locator validation against the source DOM.
 *
 * The LLM is asked for ranked locator candidates per field; we don't trust
 * them blindly. Every candidate is tested against the actual cleaned DOM at
 * compile time and any locator that doesn't resolve is dropped before the
 * config is ever written. This is the cheap guard rail that keeps malformed
 * locators out of the executor.
 */

import { JSDOM } from 'jsdom';

export type LocatorKind = 'css' | 'xpath';

export type LocatorTestResult = {
  locator: string;
  kind: LocatorKind;
  resolves: boolean;
  matchCount: number;
  /** First matched node's textContent (trimmed), useful for self-checks. */
  sampleText?: string;
  error?: string;
};

export function detectLocatorKind(locator: string): LocatorKind {
  const trimmed = locator.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('/') || trimmed.startsWith('(/')
    ? 'xpath'
    : 'css';
}

/**
 * Test a single locator against an HTML document. Returns whether it
 * resolves to at least one node, the match count, and (when possible) a
 * snippet of the first match's text for debugging.
 */
export function testLocator(html: string, locator: string): LocatorTestResult {
  const dom = new JSDOM(html);
  return testAgainstDocument(dom, locator);
}

/**
 * Same as `testLocator` but takes a long-lived JSDOM so callers can validate
 * many locators against one parse without paying the parse cost each time.
 */
export function testLocatorOnDom(dom: JSDOM, locator: string): LocatorTestResult {
  return testAgainstDocument(dom, locator);
}

function testAgainstDocument(dom: JSDOM, rawLocator: string): LocatorTestResult {
  const locator = rawLocator.trim();
  const kind = detectLocatorKind(locator);
  const doc = dom.window.document;
  try {
    if (kind === 'css') {
      const nodes = doc.querySelectorAll(locator);
      const result: LocatorTestResult = {
        locator,
        kind,
        resolves: nodes.length > 0,
        matchCount: nodes.length,
      };
      const sample = sampleText(nodes[0] ?? null);
      if (sample !== null) result.sampleText = sample;
      return result;
    }
    const xpathResult = doc.evaluate(
      locator,
      doc,
      null,
      dom.window.XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null,
    );
    const count = xpathResult.snapshotLength;
    const result: LocatorTestResult = {
      locator,
      kind,
      resolves: count > 0,
      matchCount: count,
    };
    const sample = sampleText(count > 0 ? xpathResult.snapshotItem(0) : null);
    if (sample !== null) result.sampleText = sample;
    return result;
  } catch (err) {
    return {
      locator,
      kind,
      resolves: false,
      matchCount: 0,
      error: (err as Error).message,
    };
  }
}

function sampleText(node: Node | null): string | null {
  if (!node) return null;
  const text = (node.textContent ?? '').trim();
  if (!text) return null;
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

/** Make a fresh JSDOM. Callers that test multiple locators should reuse this. */
export function parseHtml(html: string): JSDOM {
  return new JSDOM(html);
}
