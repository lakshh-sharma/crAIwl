/**
 * Renders a DashboardSummary as a self-contained HTML page.
 *
 * No external assets, no JS framework — one <style> block, a header card
 * with the totals, and a sortable table of runs. The whole thing is a
 * single file the user can email, drop in S3, or open with `open`.
 */

import type { DashboardRunRow, DashboardSummary } from './aggregate.js';

export function renderDashboardHtml(summary: DashboardSummary): string {
  const head = `<head>
<meta charset="utf-8">
<title>crAIwl — runs</title>
<style>${STYLE}</style>
</head>`;

  const header = renderHeader(summary);
  const table =
    summary.rows.length === 0
      ? '<p class="empty">No runs yet. Use <code>--manifest</code> on a crawl, or wire up a schedule.</p>'
      : `<table>${renderTableHeader()}<tbody>${summary.rows.map(renderRow).join('')}</tbody></table>`;

  return `<!doctype html>
<html lang="en">
${head}
<body>
<main>
  <h1>crAIwl runs</h1>
  ${header}
  ${table}
  <footer>Generated ${escape(summary.generatedAt)}</footer>
</main>
</body>
</html>
`;
}

function renderHeader(s: DashboardSummary): string {
  const t = s.totals;
  const range = s.range
    ? `<span class="range">${escape(s.range.earliest)} → ${escape(s.range.latest)}</span>`
    : '';
  return `<section class="totals">
  <div class="card"><span class="metric">${t.runs}</span><span class="label">runs</span></div>
  <div class="card"><span class="metric">${t.successfulRuns}</span><span class="label">successful</span></div>
  <div class="card"><span class="metric">${t.pagesCrawled}</span><span class="label">pages</span></div>
  <div class="card"><span class="metric">${t.recordsTotal}</span><span class="label">records (${t.recordsClean} clean)</span></div>
  <div class="card"><span class="metric">$${t.estimatedUsd.toFixed(4)}</span><span class="label">spent</span></div>
  ${t.httpAuthFailures > 0 ? `<div class="card alert"><span class="metric">${t.httpAuthFailures}</span><span class="label">auth failures</span></div>` : ''}
</section>
${range}`;
}

function renderTableHeader(): string {
  return `<thead><tr>
    <th>Started</th>
    <th>Goal</th>
    <th>Entry</th>
    <th class="num">Pages</th>
    <th class="num">Records</th>
    <th class="num">Cost</th>
    <th class="num">Duration</th>
    <th>Flags</th>
  </tr></thead>`;
}

function renderRow(r: DashboardRunRow): string {
  const flags: string[] = [];
  if (r.authenticated) flags.push('<span class="flag flag-auth">auth</span>');
  if (r.httpAuthFailures > 0)
    flags.push(`<span class="flag flag-bad">${r.httpAuthFailures} 401/403</span>`);
  if (r.robotsBypasses > 0)
    flags.push(`<span class="flag flag-warn">${r.robotsBypasses} robots</span>`);
  if (r.pagesFailed > 0) flags.push(`<span class="flag flag-warn">${r.pagesFailed} failed</span>`);

  return `<tr>
    <td><span class="ts">${escape(r.startedAt)}</span><br><code class="rid">${escape(r.runId)}</code></td>
    <td>${escape(r.goal)}</td>
    <td class="entry"><a href="${escape(r.entryUrl)}">${escape(truncate(r.entryUrl, 50))}</a></td>
    <td class="num">${r.pagesCrawled}</td>
    <td class="num">${r.recordsTotal}<span class="muted"> (${r.recordsClean})</span></td>
    <td class="num">$${r.estimatedUsd.toFixed(4)}</td>
    <td class="num">${formatDuration(r.durationMs)}</td>
    <td>${flags.join(' ')}</td>
  </tr>`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STYLE = `
:root { color-scheme: light dark; }
body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, system-ui, sans-serif; margin: 0; padding: 2rem; background: #fafafa; color: #1a1a1a; }
@media (prefers-color-scheme: dark) { body { background: #0f0f10; color: #e5e5e5; } a { color: #6bb7ff; } .card { background: #1c1c1f; } table { background: #1c1c1f; } th { background: #25252a; } tr:nth-child(even) td { background: #1f1f22; } }
main { max-width: 1100px; margin: 0 auto; }
h1 { margin: 0 0 1rem; font-weight: 600; }
.totals { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0.75rem; margin: 0 0 1rem; }
.card { background: #fff; padding: 0.75rem 1rem; border-radius: 8px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); display: flex; flex-direction: column; }
.card.alert { border-left: 3px solid #d33; }
.metric { font-size: 1.5rem; font-weight: 600; }
.label { font-size: 0.85rem; opacity: 0.7; }
.range { font-size: 0.85rem; opacity: 0.6; display: block; margin: 0 0 1rem; }
table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
th, td { padding: 0.6rem 0.75rem; text-align: left; vertical-align: top; }
th { background: #f3f3f3; font-weight: 600; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.03em; }
tr:nth-child(even) td { background: #f7f7f7; }
.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.ts { font-size: 0.85rem; opacity: 0.85; }
.rid { font-size: 0.75rem; opacity: 0.55; }
.entry { max-width: 280px; overflow: hidden; text-overflow: ellipsis; }
.muted { opacity: 0.5; }
.flag { display: inline-block; padding: 1px 6px; margin-right: 4px; border-radius: 4px; font-size: 0.75rem; }
.flag-auth { background: #2d6cdf22; color: #2d6cdf; }
.flag-warn { background: #d3950022; color: #b27800; }
.flag-bad { background: #d3333322; color: #d33333; font-weight: 600; }
footer { margin-top: 1.5rem; font-size: 0.75rem; opacity: 0.5; }
.empty { padding: 2rem; background: #fff; border-radius: 8px; }
code { font: 0.85em ui-monospace, SFMono-Regular, Menlo, monospace; }
`;
