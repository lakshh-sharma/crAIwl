import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ScheduleStore, type ScheduleEntry } from './store.js';

function fresh() {
  return mkdtemp(join(tmpdir(), 'craiwl-sched-')).then((baseDir) => new ScheduleStore({ baseDir }));
}

const sample = (id: string): ScheduleEntry => ({
  id,
  configPath: '/tmp/config.json',
  intervalMs: 3600 * 1000,
  outDir: '/tmp/out',
  format: 'json',
  createdAt: '2026-01-15T12:00:00.000Z',
  nextRunAt: '2026-01-15T13:00:00.000Z',
});

describe('ScheduleStore', () => {
  it('returns an empty list when nothing has been persisted yet', async () => {
    const store = await fresh();
    expect(await store.list()).toEqual([]);
  });

  it('persists and round-trips an entry', async () => {
    const store = await fresh();
    await store.add(sample('s1'));
    expect(await store.list()).toEqual([sample('s1')]);
  });

  it('rejects duplicate ids', async () => {
    const store = await fresh();
    await store.add(sample('dup'));
    await expect(store.add(sample('dup'))).rejects.toThrow(/already exists/);
  });

  it('removes by id and reports whether anything was removed', async () => {
    const store = await fresh();
    await store.add(sample('a'));
    await store.add(sample('b'));
    expect(await store.remove('a')).toBe(true);
    expect(await store.remove('nope')).toBe(false);
    expect((await store.list()).map((e) => e.id)).toEqual(['b']);
  });

  it('updates an entry in place', async () => {
    const store = await fresh();
    await store.add(sample('only'));
    await store.update({ ...sample('only'), lastRunAt: '2026-01-15T14:00:00.000Z' });
    const list = await store.list();
    expect(list[0]!.lastRunAt).toBe('2026-01-15T14:00:00.000Z');
  });

  it('writes run output under the runs/ dir', async () => {
    const store = await fresh();
    const path = await store.writeRunOutput('run-xyz', 'json', '{"hello":"world"}\n');
    expect(path.endsWith('/runs/run-xyz.json')).toBe(true);
    expect(await readFile(path, 'utf8')).toBe('{"hello":"world"}\n');
  });
});
