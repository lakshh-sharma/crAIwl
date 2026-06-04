/**
 * Eval harness types — the contract for golden-test fixtures.
 *
 * A fixture is a triple: a StrategyConfig, one or more raw HTML pages, and
 * an `expected.json` declaring what records the executor should produce
 * for each page. The harness re-runs cleanHtml + execute against every
 * page and reports per-field diffs. No LLM is involved — this is purely
 * deterministic regression coverage for the cleaner, executor, validator,
 * and confidence/grounding scoring.
 */

import type { ExtractedRecord } from '@craiwl/extractor';
import type { StrategyConfig } from '@craiwl/core';

export type ExpectedField = {
  /** The successful field value the executor should produce. */
  value: unknown;
  /** When set, the executor's value must exactly match. Default true. */
  exact?: boolean;
};

export type ExpectedRecord = {
  /** When present, must match the executor's templateId. */
  templateId?: string;
  /** Per-field expectations. Fields not listed are ignored. */
  fields: Record<string, ExpectedField>;
};

export type FixturePage = {
  /** Synthetic source URL passed to execute (used in ExtractedRecord.sourceUrl). */
  sourceUrl: string;
  /** Raw HTML before cleanHtml. */
  html: string;
  /** Expected output records, in order. */
  expected: ExpectedRecord[];
};

export type EvalFixture = {
  /** Folder/identifier — surfaces in the report. */
  name: string;
  config: StrategyConfig;
  pages: FixturePage[];
};

export type FieldDiff =
  | { kind: 'ok' }
  | { kind: 'missing-field'; expected: ExpectedField }
  | { kind: 'unexpected-failure'; reason: string }
  | { kind: 'value-mismatch'; expected: unknown; actual: unknown };

export type RecordDiff = {
  index: number;
  /** True when every listed expected field matched the actual record. */
  ok: boolean;
  templateIdMismatch?: { expected: string; actual: string };
  fields: Record<string, FieldDiff>;
};

export type PageEvalResult = {
  sourceUrl: string;
  /** Actual records produced by execute(). */
  actual: ExtractedRecord[];
  /** Per-expected-record diff. The array length matches expected[]. */
  records: RecordDiff[];
  /** Records the executor produced that had no expected counterpart. */
  extra: ExtractedRecord[];
  ok: boolean;
  /** Wall-clock for clean + execute on this page (ms). */
  timingMs: number;
};

export type FixtureEvalResult = {
  name: string;
  ok: boolean;
  pages: PageEvalResult[];
};

export type EvalReport = {
  generatedAt: string;
  fixtures: FixtureEvalResult[];
  totals: {
    fixtures: number;
    fixturesPassed: number;
    pages: number;
    pagesPassed: number;
    /** Sum of per-field comparisons that matched. */
    fieldsOk: number;
    /** Sum of per-field comparisons that failed for any reason. */
    fieldsFailed: number;
  };
};
