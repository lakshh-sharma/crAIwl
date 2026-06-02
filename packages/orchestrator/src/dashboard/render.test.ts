import { describe, expect, it } from 'vitest';
import { renderDashboardHtml } from './render.js';
import type { DashboardSummary } from './aggregate.js';

const empty: DashboardSummary = {
  generatedAt: '2026-06-02T12:00:00.000Z',
  range: null,
  totals: {
    runs: 0,
    pagesCrawled: 0,
    recordsTotal: 0,
    recordsClean: 0,
    estimatedUsd: 0,
    httpAuthFailures: 0,
    successfulRuns: 0,
  },
  rows: [],
};

describe('renderDashboardHtml', () => {
  it('renders an empty-state when there are no runs', () => {
    const html = renderDashboardHtml(empty);
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('No runs yet');
    expect(html).not.toContain('<tbody>');
  });

  it('escapes HTML in goal and URL so a malicious manifest cannot inject markup', () => {
    const summary: DashboardSummary = {
      ...empty,
      totals: { ...empty.totals, runs: 1, successfulRuns: 1 },
      range: { earliest: '2026-06-01T00:00:00.000Z', latest: '2026-06-01T00:00:00.000Z' },
      rows: [
        {
          runId: 'r1',
          startedAt: '2026-06-01T00:00:00.000Z',
          finishedAt: '2026-06-01T00:01:00.000Z',
          durationMs: 60_000,
          goal: '<script>alert(1)</script>',
          entryUrl: 'https://example.com/"><img>',
          pagesCrawled: 5,
          pagesFailed: 0,
          recordsTotal: 5,
          recordsClean: 5,
          estimatedUsd: 0.01,
          authenticated: false,
          httpAuthFailures: 0,
          robotsBypasses: 0,
        },
      ],
    };
    const html = renderDashboardHtml(summary);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&quot;');
  });

  it('shows an alert card when there have been auth failures', () => {
    const summary: DashboardSummary = {
      ...empty,
      totals: { ...empty.totals, runs: 1, httpAuthFailures: 3, successfulRuns: 0 },
      range: { earliest: '2026-06-01T00:00:00.000Z', latest: '2026-06-01T00:00:00.000Z' },
      rows: [
        {
          runId: 'r1',
          startedAt: '2026-06-01T00:00:00.000Z',
          finishedAt: '2026-06-01T00:01:00.000Z',
          durationMs: 60_000,
          goal: 'titles',
          entryUrl: 'https://example.com',
          pagesCrawled: 5,
          pagesFailed: 0,
          recordsTotal: 0,
          recordsClean: 0,
          estimatedUsd: 0,
          authenticated: true,
          httpAuthFailures: 3,
          robotsBypasses: 0,
        },
      ],
    };
    const html = renderDashboardHtml(summary);
    expect(html).toContain('alert');
    expect(html).toContain('auth failures');
    expect(html).toContain('flag-auth');
    expect(html).toContain('401/403');
  });
});
