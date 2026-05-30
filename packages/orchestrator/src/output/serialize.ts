/**
 * Output serializers: JSON, CSV, Markdown.
 *
 * The three formats share a flattening rule: each successful field becomes
 * a column with its `value`, prefixed by `_source_url` and `_template_id`
 * for provenance. Failed fields show up as empty cells (CSV/MD) or null
 * (JSON). JSON additionally retains the full per-field outcome under
 * `_outcomes` so downstream consumers can recover grounding / confidence
 * if they want to. CSV and Markdown stay narrow on purpose — humans don't
 * want a column per diagnostic.
 */

import type { ExtractedRecord } from '@craiwl/extractor';
import type { RunManifest } from './manifest.js';

export type SerializedOutput = {
  body: string;
  contentType: string;
  /** Suggested filename extension (no leading dot). */
  extension: 'json' | 'csv' | 'md';
};

export function serializeAsJson(
  records: ExtractedRecord[],
  manifest: RunManifest,
): SerializedOutput {
  const payload = {
    manifest,
    records: records.map((rec) => ({
      _source_url: rec.sourceUrl,
      _template_id: rec.templateId,
      _extracted_at: rec.extractedAt,
      ...projectValues(rec),
      _outcomes: rec.fields,
    })),
  };
  return {
    body: `${JSON.stringify(payload, null, 2)}\n`,
    contentType: 'application/json',
    extension: 'json',
  };
}

export function serializeAsCsv(records: ExtractedRecord[]): SerializedOutput {
  const columns = collectColumns(records);
  const header = ['_source_url', '_template_id', ...columns].map(csvCell).join(',');
  const rows = records.map((rec) => {
    const values = projectValues(rec);
    return [rec.sourceUrl, rec.templateId, ...columns.map((c) => formatScalar(values[c]))]
      .map(csvCell)
      .join(',');
  });
  return {
    body: `${[header, ...rows].join('\n')}\n`,
    contentType: 'text/csv',
    extension: 'csv',
  };
}

export function serializeAsMarkdown(
  records: ExtractedRecord[],
  manifest: RunManifest,
): SerializedOutput {
  const columns = collectColumns(records);
  const heading = `# Crawl results: ${manifest.goal}`;
  const meta = [
    `- **Run**: \`${manifest.runId}\` (${manifest.startedAt} → ${manifest.finishedAt})`,
    `- **Entry URL**: ${manifest.entryUrl}`,
    `- **Config**: \`${manifest.config.createdBy}\` v${manifest.config.version}`,
    `- **Pages crawled**: ${manifest.counts.pagesCrawled} (${manifest.counts.pagesSkipped} skipped, ${manifest.counts.pagesFailed} failed)`,
    `- **Records**: ${manifest.counts.recordsTotal} (${manifest.counts.recordsClean} clean, ${manifest.counts.recordsReview} review)`,
    `- **Cost**: $${manifest.cost.llm.estimatedUsd.toFixed(4)} — ${manifest.cost.llm.totalCalls} LLM call(s), ${manifest.cost.llm.inputTokens} in / ${manifest.cost.llm.outputTokens} out`,
  ].join('\n');

  if (records.length === 0) {
    return {
      body: `${heading}\n\n${meta}\n\n_No records extracted._\n`,
      contentType: 'text/markdown',
      extension: 'md',
    };
  }

  const header = `| source_url | ${columns.join(' | ')} |`;
  const sep = `| --- | ${columns.map(() => '---').join(' | ')} |`;
  const rows = records.map((rec) => {
    const values = projectValues(rec);
    return `| ${escapeMd(rec.sourceUrl)} | ${columns.map((c) => escapeMd(formatScalar(values[c]))).join(' | ')} |`;
  });

  return {
    body: `${heading}\n\n${meta}\n\n${header}\n${sep}\n${rows.join('\n')}\n`,
    contentType: 'text/markdown',
    extension: 'md',
  };
}

function projectValues(rec: ExtractedRecord): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, outcome] of Object.entries(rec.fields)) {
    out[name] = outcome.ok ? outcome.value : null;
  }
  return out;
}

function collectColumns(records: ExtractedRecord[]): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const rec of records) {
    for (const fieldName of Object.keys(rec.fields)) {
      if (!seen.has(fieldName)) {
        seen.add(fieldName);
        order.push(fieldName);
      }
    }
  }
  return order;
}

function formatScalar(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  // Anything else (arrays, objects) — JSON-encode so the cell stays unambiguous.
  return JSON.stringify(v);
}

function csvCell(value: string): string {
  if (value.includes('"') || value.includes(',') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function escapeMd(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
