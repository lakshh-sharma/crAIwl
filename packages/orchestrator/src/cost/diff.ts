/**
 * Run-to-run record diff.
 *
 * Compares the records from two crawls and reports what changed at the
 * record level. The diff is what makes scheduled re-runs useful: most of
 * the value isn't the full dump on every tick, it's "here's what's new
 * and what disappeared since last time."
 *
 * Stable record identity is the hard part. We use:
 *
 *   key = `${sourceUrl}#${templateId}#${index-on-page}`
 *
 * Single-record pages collapse to one key per URL, which is what users
 * intuit. Multi-record pages key on position-in-page, which is stable for
 * lists where order is meaningful (pricing tiers, list pages) and noisy
 * when records get reordered — in that case the diff will show a change.
 * A configurable identity field is the obvious next iteration.
 */

import type { ExtractedRecord, FieldOutcome } from '@craiwl/extractor';

export type FieldChange = {
  field: string;
  /** Value in the previous run (null when failed/missing). */
  before: unknown;
  /** Value in the current run (null when failed/missing). */
  after: unknown;
};

export type ChangedRecord = {
  key: string;
  before: ExtractedRecord;
  after: ExtractedRecord;
  fieldChanges: FieldChange[];
};

export type RunDiff = {
  added: ExtractedRecord[];
  removed: ExtractedRecord[];
  changed: ChangedRecord[];
  /** Records whose values matched exactly across runs. */
  unchangedCount: number;
  /** Convenience: total records in each run. */
  previousCount: number;
  currentCount: number;
};

export function diffRuns(previous: ExtractedRecord[], current: ExtractedRecord[]): RunDiff {
  const prevByKey = indexRecords(previous);
  const currByKey = indexRecords(current);

  const added: ExtractedRecord[] = [];
  const removed: ExtractedRecord[] = [];
  const changed: ChangedRecord[] = [];
  let unchanged = 0;

  // Preserve current-run iteration order so the diff feels stable in output.
  for (const [key, currentRec] of currByKey) {
    const prevRec = prevByKey.get(key);
    if (!prevRec) {
      added.push(currentRec);
      continue;
    }
    const fieldChanges = compareFields(prevRec, currentRec);
    if (fieldChanges.length === 0) {
      unchanged++;
    } else {
      changed.push({ key, before: prevRec, after: currentRec, fieldChanges });
    }
  }

  for (const [key, prevRec] of prevByKey) {
    if (!currByKey.has(key)) removed.push(prevRec);
  }

  return {
    added,
    removed,
    changed,
    unchangedCount: unchanged,
    previousCount: previous.length,
    currentCount: current.length,
  };
}

/**
 * Build a stable map from record key to record. Multiple records with the
 * same (sourceUrl, templateId) keep their position-in-page as the tiebreaker.
 */
function indexRecords(records: ExtractedRecord[]): Map<string, ExtractedRecord> {
  const positions = new Map<string, number>();
  const out = new Map<string, ExtractedRecord>();
  for (const rec of records) {
    const groupKey = `${rec.sourceUrl}#${rec.templateId}`;
    const idx = positions.get(groupKey) ?? 0;
    positions.set(groupKey, idx + 1);
    out.set(`${groupKey}#${idx}`, rec);
  }
  return out;
}

function compareFields(a: ExtractedRecord, b: ExtractedRecord): FieldChange[] {
  const fieldNames = new Set<string>([...Object.keys(a.fields), ...Object.keys(b.fields)]);
  const changes: FieldChange[] = [];
  for (const name of fieldNames) {
    const before = valueOf(a.fields[name]);
    const after = valueOf(b.fields[name]);
    if (!sameValue(before, after)) {
      changes.push({ field: name, before, after });
    }
  }
  return changes;
}

function valueOf(outcome: FieldOutcome | undefined): unknown {
  if (!outcome) return null;
  return outcome.ok ? outcome.value : null;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  // JSON-stringify equality is sufficient for the v1 scalar/array/object shapes
  // the executor emits. Anything more elaborate would risk silently treating
  // semantically different values as equal.
  return JSON.stringify(a) === JSON.stringify(b);
}
