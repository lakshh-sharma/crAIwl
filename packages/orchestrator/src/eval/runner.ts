/**
 * Eval harness — runs cleanHtml + execute against a fixture corpus and
 * produces a structured report. Pure determinism: same inputs → same
 * report, no LLM, no network.
 *
 * Use this to catch regressions in:
 *   - cleanHtml (Readability output, boilerplate stripping)
 *   - execute (locator resolution, transform pipeline, type coercion)
 *   - confidence + grounding scoring
 *   - partitionByConfidence
 *
 * Skips the compile step entirely — the StrategyConfig is part of the
 * fixture. Use a separate compile-replay harness if you ever need to
 * cover the compile path.
 */

import { cleanHtml, execute } from '@craiwl/extractor';
import { diffRecord } from './diff.js';
import type {
  EvalFixture,
  EvalReport,
  FixtureEvalResult,
  PageEvalResult,
  RecordDiff,
} from './types.js';

export type RunEvalOptions = {
  /** Override clock for stable extractedAt in fixtures. */
  now?: () => Date;
};

export function runEval(fixtures: EvalFixture[], opts: RunEvalOptions = {}): EvalReport {
  const now = opts.now ?? (() => new Date());
  const generatedAt = now().toISOString();

  const fixtureResults: FixtureEvalResult[] = fixtures.map((f) => evalFixture(f, now));

  const totals = {
    fixtures: fixtureResults.length,
    fixturesPassed: fixtureResults.filter((f) => f.ok).length,
    pages: 0,
    pagesPassed: 0,
    fieldsOk: 0,
    fieldsFailed: 0,
  };
  for (const fx of fixtureResults) {
    for (const p of fx.pages) {
      totals.pages++;
      if (p.ok) totals.pagesPassed++;
      for (const r of p.records) {
        for (const d of Object.values(r.fields)) {
          if (d.kind === 'ok') totals.fieldsOk++;
          else totals.fieldsFailed++;
        }
      }
    }
  }

  return { generatedAt, fixtures: fixtureResults, totals };
}

function evalFixture(fx: EvalFixture, now: () => Date): FixtureEvalResult {
  const pages = fx.pages.map((page) => evalPage(fx, page, now));
  return { name: fx.name, ok: pages.every((p) => p.ok), pages };
}

function evalPage(
  fx: EvalFixture,
  page: EvalFixture['pages'][number],
  now: () => Date,
): PageEvalResult {
  const t0 = Date.now();
  const cleaned = cleanHtml(page.html);
  const extraction = execute({
    cleanedHtml: cleaned.html,
    config: fx.config,
    sourceUrl: page.sourceUrl,
    now,
  });
  const timingMs = Date.now() - t0;

  const recordDiffs: RecordDiff[] = page.expected.map((exp, i) => {
    const actual = extraction.records[i];
    if (!actual) {
      const fields: Record<string, { kind: 'missing-field'; expected: { value: unknown } }> = {};
      for (const [name, want] of Object.entries(exp.fields)) {
        fields[name] = { kind: 'missing-field', expected: want };
      }
      return { index: i, ok: false, fields };
    }
    return diffRecord(exp, actual, i);
  });

  const extra = extraction.records.slice(page.expected.length);
  const ok = recordDiffs.every((d) => d.ok) && extra.length === 0;

  return {
    sourceUrl: page.sourceUrl,
    actual: extraction.records,
    records: recordDiffs,
    extra,
    ok,
    timingMs,
  };
}
