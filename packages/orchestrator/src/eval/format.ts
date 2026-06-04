/**
 * Human-readable report formatter for the CLI.
 *
 * Prints a per-fixture verdict, per-page summary, and the first few
 * field-level diffs when something fails — enough to point at the
 * regression without dumping the whole executor output.
 */

import type { EvalReport, FieldDiff, RecordDiff } from './types.js';

export function formatReport(report: EvalReport): string {
  const lines: string[] = [];
  lines.push(`eval — ${report.totals.fixturesPassed}/${report.totals.fixtures} fixtures pass`);
  lines.push(
    `       ${report.totals.pagesPassed}/${report.totals.pages} pages · ${report.totals.fieldsOk} fields ok · ${report.totals.fieldsFailed} fields failed`,
  );
  lines.push('');

  for (const fx of report.fixtures) {
    const status = fx.ok ? 'PASS' : 'FAIL';
    lines.push(`${status}  ${fx.name}`);
    for (const page of fx.pages) {
      if (page.ok) {
        lines.push(`  · ${page.sourceUrl}  (${page.timingMs}ms)`);
        continue;
      }
      lines.push(`  ✗ ${page.sourceUrl}  (${page.timingMs}ms)`);
      if (page.extra.length > 0) {
        lines.push(`      extra records: ${page.extra.length}`);
      }
      for (const rec of page.records) {
        if (rec.ok) continue;
        if (rec.templateIdMismatch) {
          lines.push(
            `      record #${rec.index}: template ${rec.templateIdMismatch.expected} → got ${rec.templateIdMismatch.actual}`,
          );
        }
        for (const [field, diff] of Object.entries(rec.fields)) {
          if (diff.kind === 'ok') continue;
          lines.push(`      record #${rec.index} · ${field}: ${describeDiff(diff)}`);
        }
      }
    }
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

function describeDiff(d: FieldDiff): string {
  switch (d.kind) {
    case 'missing-field':
      return `missing (expected ${JSON.stringify(d.expected.value)})`;
    case 'unexpected-failure':
      return `executor reported ${d.reason}`;
    case 'value-mismatch':
      return `expected ${JSON.stringify(d.expected)}, got ${JSON.stringify(d.actual)}`;
    case 'ok':
      return 'ok';
  }
}

/** Convenience for callers that aggregate diffs. */
export function failedRecords(report: EvalReport): RecordDiff[] {
  const out: RecordDiff[] = [];
  for (const fx of report.fixtures)
    for (const p of fx.pages) for (const r of p.records) if (!r.ok) out.push(r);
  return out;
}
