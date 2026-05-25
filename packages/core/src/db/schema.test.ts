import { describe, it, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import {
  auditEvent,
  crawlJob,
  crawlRun,
  extractedRecord,
  fetchAttempt,
  strategyConfigTable,
} from './schema.js';

function columnNames(table: Parameters<typeof getTableConfig>[0]): string[] {
  return getTableConfig(table)
    .columns.map((c) => c.name)
    .sort();
}

function indexNames(table: Parameters<typeof getTableConfig>[0]): string[] {
  return getTableConfig(table)
    .indexes.map((i) => i.config.name)
    .filter((n): n is string => typeof n === 'string')
    .sort();
}

describe('db schema', () => {
  it('crawl_job has required columns + indexes', () => {
    expect(getTableConfig(crawlJob).name).toBe('crawl_job');
    expect(columnNames(crawlJob)).toEqual(
      [
        'id',
        'created_at',
        'updated_at',
        'goal',
        'starting_url',
        'requested_fields',
        'output_formats',
        'robots_policy',
        'scope',
        'max_pages',
        'max_depth',
        'status',
      ].sort(),
    );
    expect(indexNames(crawlJob)).toContain('crawl_job_status_idx');
  });

  it('strategy_config uses (job_id, version) as composite primary key', () => {
    const cfg = getTableConfig(strategyConfigTable);
    expect(cfg.name).toBe('strategy_config');
    const pk = cfg.primaryKeys[0];
    expect(pk).toBeDefined();
    expect(pk!.columns.map((c) => c.name).sort()).toEqual(['job_id', 'version']);
  });

  it('strategy_config records provenance fields required by CRAWL-005', () => {
    const cols = columnNames(strategyConfigTable);
    expect(cols).toContain('payload');
    expect(cols).toContain('created_by');
    expect(cols).toContain('created_at');
    expect(cols).toContain('last_validated');
    expect(cols).toContain('reason');
  });

  it('crawl_run indexes by job_id', () => {
    expect(indexNames(crawlRun)).toContain('crawl_run_job_idx');
  });

  it('extracted_record indexes by (run_id, page_url)', () => {
    expect(indexNames(extractedRecord)).toContain('extracted_record_run_page_idx');
  });

  it('fetch_attempt indexes by run_id', () => {
    expect(indexNames(fetchAttempt)).toContain('fetch_attempt_run_idx');
  });

  it('audit_event indexes by job_id and created_at', () => {
    const idx = indexNames(auditEvent);
    expect(idx).toContain('audit_event_job_idx');
    expect(idx).toContain('audit_event_created_at_idx');
  });
});
