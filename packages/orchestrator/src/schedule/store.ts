/**
 * Filesystem-backed schedule + run storage.
 *
 * The store keeps three things on disk under a base directory (default
 * `~/.craiwl/`):
 *
 *   schedules.json   — list of scheduled jobs
 *   configs/<id>.json — saved StrategyConfigs (referenced by schedules)
 *   runs/<runId>.<ext> — serialized output of each run
 *
 * This isn't a database — it's the smallest persistent layer that lets a
 * single-user CLI keep recurring jobs across restarts. Postgres + Drizzle
 * are already wired in `core/db`; swapping the store onto that is a
 * future change that doesn't touch the scheduler logic.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

export type ScheduleEntry = {
  id: string;
  /** Absolute path to the exported StrategyConfig file. */
  configPath: string;
  /** Interval between runs in milliseconds. */
  intervalMs: number;
  /** Where serialized run outputs should be written. */
  outDir: string;
  /** Output format. */
  format: 'json' | 'csv' | 'md';
  createdAt: string;
  lastRunAt?: string;
  /** Next scheduled fire time (ISO). */
  nextRunAt: string;
};

export type ScheduleStoreOptions = {
  /** Base directory. Defaults to `~/.craiwl/`. */
  baseDir?: string;
};

const SCHEDULES_FILE = 'schedules.json';
const RUNS_DIR = 'runs';

export class ScheduleStore {
  readonly baseDir: string;

  constructor(opts: ScheduleStoreOptions = {}) {
    this.baseDir = opts.baseDir ?? join(homedir(), '.craiwl');
  }

  async ensureDirs(): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
    await mkdir(join(this.baseDir, RUNS_DIR), { recursive: true });
  }

  async list(): Promise<ScheduleEntry[]> {
    try {
      const raw = await readFile(join(this.baseDir, SCHEDULES_FILE), 'utf8');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed as ScheduleEntry[];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  async save(entries: ScheduleEntry[]): Promise<void> {
    await this.ensureDirs();
    await writeFile(
      join(this.baseDir, SCHEDULES_FILE),
      `${JSON.stringify(entries, null, 2)}\n`,
      'utf8',
    );
  }

  async add(entry: ScheduleEntry): Promise<void> {
    const current = await this.list();
    if (current.some((e) => e.id === entry.id)) {
      throw new Error(`schedule "${entry.id}" already exists`);
    }
    current.push(entry);
    await this.save(current);
  }

  async remove(id: string): Promise<boolean> {
    const current = await this.list();
    const filtered = current.filter((e) => e.id !== id);
    if (filtered.length === current.length) return false;
    await this.save(filtered);
    return true;
  }

  async update(entry: ScheduleEntry): Promise<void> {
    const current = await this.list();
    const idx = current.findIndex((e) => e.id === entry.id);
    if (idx === -1) throw new Error(`schedule "${entry.id}" not found`);
    current[idx] = entry;
    await this.save(current);
  }

  /** Returns the absolute path where a run's serialized output should land. */
  runOutputPath(runId: string, extension: string): string {
    return join(this.baseDir, RUNS_DIR, `${runId}.${extension}`);
  }

  async writeRunOutput(runId: string, extension: string, body: string): Promise<string> {
    await this.ensureDirs();
    const path = this.runOutputPath(runId, extension);
    await writeFile(path, body, 'utf8');
    return path;
  }
}
