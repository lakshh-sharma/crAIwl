import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres, { type Sql } from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { randomUUID } from 'node:crypto';
import { applyDown, applyUp } from '../db/migrator.js';
import * as schema from '../db/schema.js';
import { StrategyConfigStore } from './store.js';
import { parseStrategyConfig } from './schema.js';
import type { StrategyConfigInput } from './types.js';

/**
 * Integration test for the persistence/versioning/diff/rollback flow.
 * Skipped when DATABASE_URL is unset; runs against a fresh schema otherwise.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const baseConfig = (entryUrl: string): StrategyConfigInput => ({
  createdBy: 'claude-opus-4-7',
  createdAt: '2026-05-25T00:00:00Z',
  reason: 'compile',
  target: { entryUrl, scope: 'single' },
  goal: 'pull the title',
  pageTemplates: [
    {
      id: 'doc',
      fields: {
        title: {
          locators: ['h1', 'h1.title'],
          semanticAnchor: 'main heading',
          type: 'string',
        },
      },
    },
  ],
  fetchProfile: 'static',
});

describeIfDb('StrategyConfigStore', () => {
  const testSchema = `craiwl_store_${Math.random().toString(36).slice(2, 8)}`;
  let sql: Sql;
  let store: StrategyConfigStore;
  let jobId: string;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1 });
    await sql.unsafe(`CREATE SCHEMA "${testSchema}"`);
    await sql.unsafe(`SET search_path TO "${testSchema}"`);
    await applyUp(sql);
    // Seed a crawl_job to satisfy the FK on strategy_config.
    jobId = randomUUID();
    await sql`INSERT INTO crawl_job (id, goal, starting_url) VALUES (${jobId}, 'test', 'https://example.com')`;
    const db = drizzle(sql, { schema });
    store = new StrategyConfigStore(db);
  });

  afterAll(async () => {
    await applyDown(sql);
    await sql.unsafe(`DROP SCHEMA IF EXISTS "${testSchema}" CASCADE`);
    await sql.end({ timeout: 5 });
  });

  it('save assigns monotonically increasing versions starting at 1', async () => {
    const v1 = await store.save({
      jobId,
      config: parseStrategyConfig(baseConfig('https://example.com/a')),
      author: 'claude-opus-4-7',
      reason: 'compile',
    });
    const v2 = await store.save({
      jobId,
      config: parseStrategyConfig(baseConfig('https://example.com/b')),
      author: 'self-heal:run-1',
      reason: 'self-heal',
    });
    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
  });

  it('load("latest") returns the highest version', async () => {
    const latest = await store.load(jobId, 'latest');
    expect(latest?.version).toBe(2);
    expect(latest?.config.target.entryUrl).toBe('https://example.com/b');
  });

  it('list returns all versions, newest first', async () => {
    const list = await store.list(jobId);
    expect(list).toHaveLength(2);
    expect(list[0]!.version).toBe(2);
    expect(list[1]!.version).toBe(1);
    expect(list[1]!.reason).toBe('compile');
    expect(list[0]!.reason).toBe('self-heal');
  });

  it('diff between two saved versions surfaces the entryUrl change', async () => {
    const diff = await store.diff(jobId, 1, 2);
    expect(diff.identical).toBe(false);
    expect(
      diff.changes.some(
        (c) =>
          c.path === 'target.entryUrl' &&
          c.before === 'https://example.com/a' &&
          c.after === 'https://example.com/b',
      ),
    ).toBe(true);
  });

  it('restoreVersion copies an older payload forward as a new latest version', async () => {
    const restored = await store.restoreVersion(jobId, 1, 'user:alice');
    expect(restored.version).toBe(3);
    expect(restored.config.target.entryUrl).toBe('https://example.com/a');
    expect(restored.reason).toBe('manual-edit');
    expect(restored.createdBy).toBe('user:alice');
    const latest = await store.load(jobId, 'latest');
    expect(latest?.version).toBe(3);
  });
});
