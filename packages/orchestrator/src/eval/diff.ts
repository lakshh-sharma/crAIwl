/**
 * Per-record diff used by the eval runner.
 *
 * Comparison rules:
 *   - Records are paired by position in the expected[] array.
 *   - Only fields listed in expected.fields are checked — fields the
 *     executor produces but the fixture doesn't mention are ignored.
 *   - Failed field outcomes (ok=false) are always reported.
 *   - Expected.value === null OR explicit { expected: { ... }, exact: false }
 *     skips the value check (presence-only).
 */

import type { ExtractedRecord, FieldOutcome } from '@craiwl/extractor';
import type { ExpectedField, ExpectedRecord, FieldDiff, RecordDiff } from './types.js';

export function diffRecord(
  expected: ExpectedRecord,
  actual: ExtractedRecord,
  index: number,
): RecordDiff {
  const fields: Record<string, FieldDiff> = {};
  for (const [name, want] of Object.entries(expected.fields)) {
    const outcome: FieldOutcome | undefined = actual.fields[name];
    fields[name] = diffField(want, outcome);
  }
  const ok = Object.values(fields).every((d) => d.kind === 'ok');
  const out: RecordDiff = { index, ok, fields };
  if (expected.templateId && expected.templateId !== actual.templateId) {
    out.templateIdMismatch = { expected: expected.templateId, actual: actual.templateId };
    out.ok = false;
  }
  return out;
}

export function diffField(want: ExpectedField, actual: FieldOutcome | undefined): FieldDiff {
  if (actual === undefined) return { kind: 'missing-field', expected: want };
  if (!actual.ok) return { kind: 'unexpected-failure', reason: actual.reason };

  const exact = want.exact !== false;
  if (!exact) return { kind: 'ok' };

  if (deepEqual(want.value, actual.value)) return { kind: 'ok' };
  return { kind: 'value-mismatch', expected: want.value, actual: actual.value };
}

/**
 * Structural equality covering primitives, arrays, and plain objects.
 * Order matters for arrays; key order does not for objects. NaN matches NaN.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (typeof a === 'object') {
    if (Array.isArray(b)) return false;
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const aKeys = Object.keys(ao);
    const bKeys = Object.keys(bo);
    if (aKeys.length !== bKeys.length) return false;
    for (const k of aKeys) if (!deepEqual(ao[k], bo[k])) return false;
    return true;
  }
  return false;
}
