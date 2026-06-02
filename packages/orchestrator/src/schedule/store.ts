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
import type { ExtractedRecord } from '@craiwl/extractor';
import type { AuditLog } from '@craiwl/core';
import { toJsonl } from '@craiwl/core';
import type { RunDiff } from '../cost/index.js';
import type { RunManifest } from '../output/manifest.js';

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
  /** Run id of the most recent successful run — keyed for diff lookups. */
  lastRunId?: string;
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

  /**
   * Persist the raw record list for a run. The diff between scheduled runs
   * keys off this rather than the formatted output so reformatting changes
   * don't leak into diff results.
   */
  async writeRunRecords(runId: string, records: ExtractedRecord[]): Promise<string> {
    await this.ensureDirs();
    const path = join(this.baseDir, RUNS_DIR, `${runId}.records.json`);
    await writeFile(path, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
    return path;
  }

  async readRunRecords(runId: string): Promise<ExtractedRecord[] | null> {
    try {
      const raw = await readFile(join(this.baseDir, RUNS_DIR, `${runId}.records.json`), 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as ExtractedRecord[]) : null;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async writeRunDiff(runId: string, diff: RunDiff): Promise<string> {
    await this.ensureDirs();
    const path = join(this.baseDir, RUNS_DIR, `${runId}.diff.json`);
    await writeFile(path, `${JSON.stringify(diff, null, 2)}\n`, 'utf8');
    return path;
  }

  /** Persist the audit log as JSONL alongside the run output. */
  async writeRunAudit(runId: string, audit: AuditLog): Promise<string> {
    await this.ensureDirs();
    const path = join(this.baseDir, RUNS_DIR, `${runId}.audit.jsonl`);
    await writeFile(path, `${toJsonl(audit)}\n`, 'utf8');
    return path;
  }

  /** Persist the manifest as JSON. The dashboard reads these. */
  async writeRunManifest(runId: string, manifest: RunManifest): Promise<string> {
    await this.ensureDirs();
    const path = join(this.baseDir, RUNS_DIR, `${runId}.manifest.json`);
    await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    return path;
  }

  /** List all run manifests on disk, oldest first. */
  async listRunManifests(): Promise<RunManifest[]> {
    const dir = join(this.baseDir, RUNS_DIR);
    let names: string[];
    try {
      const { readdir } = await import('node:fs/promises');
      names = await readdir(dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const manifestFiles = names.filter((n) => n.endsWith('.manifest.json')).sort();
    const out: RunManifest[] = [];
    for (const f of manifestFiles) {
      try {
        const raw = await readFile(join(dir, f), 'utf8');
        out.push(JSON.parse(raw) as RunManifest);
      } catch {
        // Skip unreadable / malformed manifests rather than failing the whole list.
      }
    }
    return out;
  }
}
