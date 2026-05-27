/**
 * Deterministic StrategyConfig executor.
 *
 * Given a cleaned HTML body and a compiled config, walks the page templates,
 * resolves each field's ranked locators against the DOM, applies transforms,
 * coerces to the declared type, and runs the validate predicate. The first
 * locator that resolves AND whose extracted value passes validation wins.
 *
 * Zero LLM calls. Zero network calls. This is the runtime hot path — the
 * cheap engine that makes the "compile once, run many times" story work.
 *
 * Every successful field carries provenance (the locator that produced it,
 * the raw matched text, the final value). Failed fields carry per-locator
 * diagnostics so the self-heal loop knows whether the locator missed or
 * the validator rejected the value.
 */

import { JSDOM } from 'jsdom';
import {
  compileExpression,
  compileTransformPipeline,
  type CompiledExpression,
  type StrategyConfig,
  type FieldSpec,
  type FieldType,
  type Transform,
} from '@craiwl/core';

export type FieldOutcome =
  | {
      ok: true;
      value: unknown;
      /** Locator that resolved and passed validation. */
      locator: string;
      /** Raw textContent of the matched node before transform/coercion. */
      rawText: string;
      /** Confidence in this extraction. Always 1.0 until the grounding guard lands. */
      confidence: number;
    }
  | {
      ok: false;
      reason: FieldFailureReason;
      attempts: LocatorAttempt[];
    };

export type FieldFailureReason =
  | 'locator-miss'
  | 'validation-fail'
  | 'transform-error'
  | 'type-coercion-fail';

export type LocatorAttempt = {
  locator: string;
  result: 'no-match' | 'transform-failed' | 'type-coercion-failed' | 'validation-failed';
  rawText?: string;
  /** When transform/coercion fails, the value the executor saw. */
  coerced?: unknown;
};

export type ExtractedRecord = {
  templateId: string;
  fields: Record<string, FieldOutcome>;
  sourceUrl: string;
  extractedAt: string;
};

export type ExtractionResult = {
  records: ExtractedRecord[];
  /** Record count per template id. */
  perTemplate: Record<string, number>;
  /** Total successful fields across all records. */
  successCount: number;
  /** Total failed fields across all records. */
  failureCount: number;
  /** Wall-clock time in milliseconds. */
  timingMs: number;
};

export type ExecuteOptions = {
  cleanedHtml: string;
  config: StrategyConfig;
  sourceUrl: string;
  /** Override for "now" (used in tests for stable extractedAt). */
  now?: () => Date;
};

export function execute(opts: ExecuteOptions): ExtractionResult {
  const start = Date.now();
  const now = opts.now ?? (() => new Date());
  const dom = new JSDOM(opts.cleanedHtml);
  const doc = dom.window.document;

  const records: ExtractedRecord[] = [];
  const perTemplate: Record<string, number> = {};
  let successCount = 0;
  let failureCount = 0;

  for (const template of opts.config.pageTemplates) {
    perTemplate[template.id] = 0;

    const roots: Array<Element | Document> =
      template.multiRecord && template.matchHeuristic
        ? queryAll(dom, doc, template.matchHeuristic)
        : [doc];

    for (const root of roots) {
      const fields: Record<string, FieldOutcome> = {};
      for (const [fieldName, spec] of Object.entries(template.fields)) {
        const outcome = extractField(dom, root, spec);
        fields[fieldName] = outcome;
        if (outcome.ok) successCount++;
        else failureCount++;
      }
      records.push({
        templateId: template.id,
        fields,
        sourceUrl: opts.sourceUrl,
        extractedAt: now().toISOString(),
      });
      perTemplate[template.id] = (perTemplate[template.id] ?? 0) + 1;
    }
  }

  return {
    records,
    perTemplate,
    successCount,
    failureCount,
    timingMs: Date.now() - start,
  };
}

function extractField(dom: JSDOM, root: Element | Document, spec: FieldSpec): FieldOutcome {
  const transform: Transform | null = spec.transform
    ? compileTransformPipeline(spec.transform)
    : null;
  const validator: CompiledExpression | null = spec.validate
    ? compileExpression(spec.validate)
    : null;

  const attempts: LocatorAttempt[] = [];

  for (const locator of spec.locators) {
    const node = resolveOne(dom, root, locator);
    if (!node) {
      attempts.push({ locator, result: 'no-match' });
      continue;
    }
    const rawText = textOf(node);

    let working: unknown = rawText;
    if (transform) {
      try {
        working = transform(rawText);
      } catch {
        attempts.push({ locator, result: 'transform-failed', rawText });
        continue;
      }
    }

    const coerced = coerceToType(working, spec.type);
    if (coerced === undefined) {
      attempts.push({ locator, result: 'type-coercion-failed', rawText, coerced: working });
      continue;
    }

    if (validator && !validator.test(coerced)) {
      attempts.push({ locator, result: 'validation-failed', rawText, coerced });
      continue;
    }

    return {
      ok: true,
      value: coerced,
      locator,
      rawText,
      confidence: 1,
    };
  }

  // All locators exhausted. Pick the most-specific failure reason from the
  // attempt log — later locators usually probe deeper, so the last attempt's
  // failure stage is the most informative one to surface.
  const last = attempts[attempts.length - 1];
  let reason: FieldFailureReason = 'locator-miss';
  if (last) {
    if (last.result === 'validation-failed') reason = 'validation-fail';
    else if (last.result === 'transform-failed') reason = 'transform-error';
    else if (last.result === 'type-coercion-failed') reason = 'type-coercion-fail';
  }
  return { ok: false, reason, attempts };
}

function resolveOne(dom: JSDOM, root: Element | Document, locator: string): Element | null {
  const trimmed = locator.trim();
  const isXPath = trimmed.startsWith('/') || trimmed.startsWith('(/');
  try {
    if (!isXPath) {
      return (root as Element | Document).querySelector(trimmed);
    }
    // XPath needs a Document for `evaluate`; scope to `root` by passing it as the context node.
    const doc = (root as Element).ownerDocument ?? (root as Document);
    const res = doc.evaluate(
      trimmed,
      root as Node,
      null,
      dom.window.XPathResult.FIRST_ORDERED_NODE_TYPE,
      null,
    );
    const n = res.singleNodeValue;
    return n && n.nodeType === 1 ? (n as Element) : null;
  } catch {
    return null;
  }
}

function queryAll(dom: JSDOM, doc: Document, locator: string): Element[] {
  const trimmed = locator.trim();
  const isXPath = trimmed.startsWith('/') || trimmed.startsWith('(/');
  try {
    if (!isXPath) {
      return Array.from(doc.querySelectorAll(trimmed));
    }
    const res = doc.evaluate(
      trimmed,
      doc,
      null,
      dom.window.XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null,
    );
    const out: Element[] = [];
    for (let i = 0; i < res.snapshotLength; i++) {
      const n = res.snapshotItem(i);
      if (n && n.nodeType === 1) out.push(n as Element);
    }
    return out;
  } catch {
    return [];
  }
}

function textOf(node: Element): string {
  return (node.textContent ?? '').trim().replace(/\s+/g, ' ');
}

function coerceToType(value: unknown, type: FieldType): unknown {
  switch (type) {
    case 'string':
      if (value === null || value === undefined) return undefined;
      return typeof value === 'string' ? value : String(value);
    case 'number': {
      if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
      const n = Number(value);
      return Number.isFinite(n) ? n : undefined;
    }
    case 'integer': {
      if (typeof value === 'number') return Number.isInteger(value) ? value : undefined;
      const n = Number(value);
      return Number.isInteger(n) ? n : undefined;
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      const s = String(value).trim().toLowerCase();
      if (['true', 'yes', '1', 'on'].includes(s)) return true;
      if (['false', 'no', '0', 'off', ''].includes(s)) return false;
      return undefined;
    }
    case 'date': {
      if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
      }
      const d = new Date(value as string);
      return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
    }
    case 'url': {
      try {
        return new URL(String(value)).toString();
      } catch {
        return undefined;
      }
    }
    default:
      return value;
  }
}
