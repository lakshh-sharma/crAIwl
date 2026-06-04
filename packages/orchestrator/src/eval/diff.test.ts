import { describe, expect, it } from 'vitest';
import { diffField, diffRecord } from './diff.js';
import type { ExtractedRecord, FieldOutcome } from '@craiwl/extractor';

const okOutcome = (value: unknown): FieldOutcome => ({
  ok: true,
  value,
  locator: '.x',
  locatorRank: 0,
  rawText: String(value),
  grounded: true,
  confidence: 1,
});

describe('diffField', () => {
  it('ok when values match exactly', () => {
    expect(diffField({ value: 42 }, okOutcome(42))).toEqual({ kind: 'ok' });
  });

  it('value-mismatch when types disagree', () => {
    const d = diffField({ value: '42' }, okOutcome(42));
    expect(d.kind).toBe('value-mismatch');
  });

  it('deep-compares nested arrays and objects', () => {
    const a = { value: [{ x: 1, y: [2, 3] }] };
    const b = { value: [{ y: [2, 3], x: 1 }] };
    expect(diffField(a, okOutcome(b.value))).toEqual({ kind: 'ok' });
  });

  it('unexpected-failure when the executor reported a failure', () => {
    const d = diffField({ value: 1 }, { ok: false, reason: 'locator-miss', attempts: [] });
    expect(d).toEqual({ kind: 'unexpected-failure', reason: 'locator-miss' });
  });

  it('missing-field when the executor did not run the field', () => {
    const d = diffField({ value: 1 }, undefined);
    expect(d.kind).toBe('missing-field');
  });

  it('skips the value check when exact: false', () => {
    const d = diffField({ value: 'whatever', exact: false }, okOutcome('other'));
    expect(d).toEqual({ kind: 'ok' });
  });
});

describe('diffRecord', () => {
  const baseActual = (fields: Record<string, FieldOutcome>): ExtractedRecord => ({
    templateId: 'page',
    fields,
    sourceUrl: 'https://example.com',
    extractedAt: '2026-06-04T00:00:00.000Z',
  });

  it('passes when every listed field matches', () => {
    const d = diffRecord(
      { fields: { title: { value: 'A' } } },
      baseActual({ title: okOutcome('A') }),
      0,
    );
    expect(d.ok).toBe(true);
  });

  it('flags templateId mismatch', () => {
    const d = diffRecord(
      { templateId: 'detail', fields: { title: { value: 'A' } } },
      baseActual({ title: okOutcome('A') }),
      0,
    );
    expect(d.ok).toBe(false);
    expect(d.templateIdMismatch).toEqual({ expected: 'detail', actual: 'page' });
  });
});
