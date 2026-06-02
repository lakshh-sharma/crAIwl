/**
 * Tiny interval scheduler.
 *
 * For v1 we don't need cron grammar — every scheduled job runs on a fixed
 * interval (e.g. every 6 hours). `nextRunAt` is persisted so the scheduler
 * is restart-safe: a missed window doesn't compound, the next run just
 * picks up from "now".
 *
 * `runDueOnce` is the unit of work — it returns the list of schedule IDs
 * that were due and ran (or attempted). Callers can wire it into:
 *  - a long-running daemon (`runDaemon` below)
 *  - an external cron / systemd timer that invokes the CLI periodically
 *
 * Each due job loads its persisted config and calls `runJob` with no LLM,
 * which is the design's whole point: scheduled re-runs cost zero LLM
 * tokens against a stable site.
 */

import { readFile } from 'node:fs/promises';
import type { Fetcher, RobotsCache } from '@craiwl/fetcher';
import { runJob, type RunJobResult } from '../output/run.js';
import { importConfig } from '../output/config-io.js';
import {
  serializeAsJson,
  serializeAsCsv,
  serializeAsMarkdown,
  type SerializedOutput,
} from '../output/serialize.js';
import type { ScheduleStore } from './store.js';
import { type ScheduleEntry } from './store.js';

export type SchedulerOptions = {
  store: ScheduleStore;
  /** Factory that supplies a fresh fetcher per run (so independent runs don't share state). */
  fetcherFactory: () => Fetcher;
  /** Factory for the robots cache. */
  robotsCacheFactory: (fetcher: Fetcher) => RobotsCache;
  /** User-Agent header used by scheduled runs. */
  userAgent: string;
  /** Clock seam. */
  now?: () => Date;
  /** Log sink. */
  log?: (line: string) => void;
};

export type DueResult = {
  scheduleId: string;
  ok: boolean;
  /** Path on disk where the serialized output was written. */
  outputPath?: string;
  /** Path on disk where the run-vs-previous diff was written (when there was a previous run). */
  diffPath?: string;
  /** Run result on success. */
  result?: RunJobResult;
  /** Error message on failure. */
  error?: string;
};

const noop = () => {};

export class Scheduler {
  private readonly opts: SchedulerOptions;
  private readonly now: () => Date;
  private readonly log: (line: string) => void;

  constructor(opts: SchedulerOptions) {
    this.opts = opts;
    this.now = opts.now ?? (() => new Date());
    this.log = opts.log ?? noop;
  }

  /** Run every schedule whose `nextRunAt` is at or before "now". */
  async runDueOnce(): Promise<DueResult[]> {
    const entries = await this.opts.store.list();
    const nowMs = this.now().getTime();
    const due = entries.filter((e) => new Date(e.nextRunAt).getTime() <= nowMs);
    const results: DueResult[] = [];
    for (const entry of due) {
      results.push(await this.runOne(entry));
    }
    return results;
  }

  /** Trigger a specific schedule immediately, regardless of nextRunAt. */
  async runNow(scheduleId: string): Promise<DueResult> {
    const entries = await this.opts.store.list();
    const entry = entries.find((e) => e.id === scheduleId);
    if (!entry) {
      return { scheduleId, ok: false, error: `schedule "${scheduleId}" not found` };
    }
    return this.runOne(entry);
  }

  /**
   * Long-running loop. Wakes every `pollMs` and runs anything due. Returns
   * when `signal` aborts. Designed for `craiwl schedule daemon`.
   */
  async runDaemon(pollMs: number, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        const results = await this.runDueOnce();
        for (const r of results) {
          if (r.ok) this.log(`run ok: ${r.scheduleId} → ${r.outputPath}`);
          else this.log(`run failed: ${r.scheduleId} — ${r.error}`);
        }
      } catch (err) {
        this.log(`scheduler tick error: ${(err as Error).message}`);
      }
      await sleep(pollMs, signal);
    }
  }

  private async runOne(entry: ScheduleEntry): Promise<DueResult> {
    try {
      const raw = await readFile(entry.configPath, 'utf8');
      const config = importConfig(raw);
      const fetcher = this.opts.fetcherFactory();
      const robotsCache = this.opts.robotsCacheFactory(fetcher);

      // If a previous run exists, load its raw records so this run produces a diff.
      const previousRecords = entry.lastRunId
        ? await this.opts.store.readRunRecords(entry.lastRunId)
        : null;

      const result = await runJob({
        entryUrl: config.target.entryUrl,
        goal: config.goal,
        fetcher,
        robotsCache,
        userAgent: this.opts.userAgent,
        config,
        now: this.now,
        ...(previousRecords ? { previousRecords } : {}),
      });

      const serialized = pickSerializer(entry.format, result);
      const outputPath = await this.opts.store.writeRunOutput(
        result.runId,
        serialized.extension,
        serialized.body,
      );
      // Persist raw records for the next run's diff.
      await this.opts.store.writeRunRecords(result.runId, result.records);
      // Manifest + audit log feed the dashboard and the compliance report.
      await this.opts.store.writeRunManifest(result.runId, result.manifest);
      await this.opts.store.writeRunAudit(result.runId, result.auditLog);

      let diffPath: string | undefined;
      if (result.diff) {
        diffPath = await this.opts.store.writeRunDiff(result.runId, result.diff);
      }

      // Bookkeeping: advance nextRunAt, record lastRunAt + lastRunId.
      const updated: ScheduleEntry = {
        ...entry,
        lastRunAt: this.now().toISOString(),
        lastRunId: result.runId,
        nextRunAt: new Date(this.now().getTime() + entry.intervalMs).toISOString(),
      };
      await this.opts.store.update(updated);

      return {
        scheduleId: entry.id,
        ok: true,
        outputPath,
        ...(diffPath ? { diffPath } : {}),
        result,
      };
    } catch (err) {
      return { scheduleId: entry.id, ok: false, error: (err as Error).message };
    }
  }
}

function pickSerializer(format: ScheduleEntry['format'], result: RunJobResult): SerializedOutput {
  if (format === 'csv') return serializeAsCsv(result.cleanRecords);
  if (format === 'md') return serializeAsMarkdown(result.cleanRecords, result.manifest);
  return serializeAsJson(result.cleanRecords, result.manifest);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
