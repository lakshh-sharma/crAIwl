import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres, { type Sql } from 'postgres';
import { applyDown, applyUp } from './migrator.js';

/**
 * Integration test for the migration round-trip. Runs only when DATABASE_URL
 * is set (e.g. after `pnpm dev:up`). In CI without a database, the suite is
 * skipped — schema-shape coverage is in `schema.test.ts`.
 *
 * Each run isolates itself in a fresh schema named `craiwl_test_<rand>` so
 * concurrent test invocations and leftover state don't collide.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const TABLES = [
  'crawl_job',
  'strategy_config',
  'crawl_run',
  'extracted_record',
  'fetch_attempt',
  'audit_event',
] as const;

describeIfDb('migrations (up/down round-trip)', () => {
  const testSchema = `craiwl_test_${Math.random().toString(36).slice(2, 8)}`;
  let sql: Sql;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1 });
    await sql.unsafe(`CREATE SCHEMA "${testSchema}"`);
    await sql.unsafe(`SET search_path TO "${testSchema}"`);
  });

  afterAll(async () => {
    await sql.unsafe(`DROP SCHEMA IF EXISTS "${testSchema}" CASCADE`);
    await sql.end({ timeout: 5 });
  });

  it('applyUp creates every expected table', async () => {
    const applied = await applyUp(sql);
    expect(applied.length).toBeGreaterThan(0);
    const rows = await sql<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = ${testSchema}
    `;
    const names = rows.map((r) => r.tablename).sort();
    for (const t of TABLES) expect(names).toContain(t);
  });

  it('applyDown drops every table the up migration created', async () => {
    await applyDown(sql);
    const rows = await sql<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = ${testSchema}
    `;
    expect(rows).toHaveLength(0);
  });
});
