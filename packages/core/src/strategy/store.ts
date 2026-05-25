import { and, desc, eq, max } from 'drizzle-orm';
import { strategyConfigTable } from '../db/schema.js';
import type { Database } from '../db/client.js';
import { parseStrategyConfig } from './schema.js';
import type { ConfigReason, StrategyConfig } from './types.js';
import { diffStrategyConfigs, type ConfigDiff } from './diff.js';

export type SaveOptions = {
  jobId: string;
  config: StrategyConfig;
  author: string;
  reason: ConfigReason;
};

export type LoadedVersion = {
  jobId: string;
  version: number;
  config: StrategyConfig;
  createdBy: string;
  createdAt: Date;
  lastValidated: Date | null;
  reason: ConfigReason;
};

export type VersionMetadata = Omit<LoadedVersion, 'config'>;

/**
 * Persistence + history layer for StrategyConfig. Each save creates a new
 * monotonically-numbered row keyed by `(jobId, version)` — never an update.
 * Rollback (`restoreVersion`) is itself a save, copying a prior payload
 * forward with `reason='manual-edit'` so the audit trail is unbroken.
 */
export class StrategyConfigStore {
  constructor(private readonly db: Database) {}

  /** Persist a new version. Returns the row that was written. */
  async save(opts: SaveOptions): Promise<LoadedVersion> {
    const next = await this.nextVersion(opts.jobId);
    // Validate the payload before persistence — protects against drift
    // between an unvalidated runtime value and what the DB column accepts.
    const validated = parseStrategyConfig(opts.config);
    const [row] = await this.db
      .insert(strategyConfigTable)
      .values({
        jobId: opts.jobId,
        version: next,
        payload: validated,
        createdBy: opts.author,
        reason: opts.reason,
      })
      .returning();
    if (!row) throw new Error('strategy_config insert returned no row');
    return toLoadedVersion(row);
  }

  async load(jobId: string, version: number | 'latest'): Promise<LoadedVersion | undefined> {
    const row =
      version === 'latest'
        ? await this.latestRow(jobId)
        : (
            await this.db
              .select()
              .from(strategyConfigTable)
              .where(
                and(eq(strategyConfigTable.jobId, jobId), eq(strategyConfigTable.version, version)),
              )
              .limit(1)
          )[0];
    return row ? toLoadedVersion(row) : undefined;
  }

  /** All versions for a job, newest first, payloads omitted for cheapness. */
  async list(jobId: string): Promise<VersionMetadata[]> {
    const rows = await this.db
      .select({
        jobId: strategyConfigTable.jobId,
        version: strategyConfigTable.version,
        createdBy: strategyConfigTable.createdBy,
        createdAt: strategyConfigTable.createdAt,
        lastValidated: strategyConfigTable.lastValidated,
        reason: strategyConfigTable.reason,
      })
      .from(strategyConfigTable)
      .where(eq(strategyConfigTable.jobId, jobId))
      .orderBy(desc(strategyConfigTable.version));
    return rows.map((r) => ({
      jobId: r.jobId,
      version: r.version,
      createdBy: r.createdBy,
      createdAt: r.createdAt,
      lastValidated: r.lastValidated,
      reason: r.reason as ConfigReason,
    }));
  }

  /**
   * "Roll back" by copying an older version's payload forward as a brand-new
   * version. The history is preserved; the latest pointer just lands on a
   * familiar payload again, with `reason='manual-edit'` and an author who
   * can explain why.
   */
  async restoreVersion(jobId: string, fromVersion: number, author: string): Promise<LoadedVersion> {
    const source = await this.load(jobId, fromVersion);
    if (!source) throw new Error(`strategy_config v${fromVersion} not found for job ${jobId}`);
    return this.save({ jobId, config: source.config, author, reason: 'manual-edit' });
  }

  async diff(jobId: string, fromVersion: number, toVersion: number): Promise<ConfigDiff> {
    const [a, b] = await Promise.all([this.load(jobId, fromVersion), this.load(jobId, toVersion)]);
    if (!a) throw new Error(`strategy_config v${fromVersion} not found for job ${jobId}`);
    if (!b) throw new Error(`strategy_config v${toVersion} not found for job ${jobId}`);
    return diffStrategyConfigs(a.config, b.config);
  }

  private async nextVersion(jobId: string): Promise<number> {
    const [row] = await this.db
      .select({ max: max(strategyConfigTable.version) })
      .from(strategyConfigTable)
      .where(eq(strategyConfigTable.jobId, jobId));
    return (row?.max ?? 0) + 1;
  }

  private async latestRow(jobId: string) {
    const rows = await this.db
      .select()
      .from(strategyConfigTable)
      .where(eq(strategyConfigTable.jobId, jobId))
      .orderBy(desc(strategyConfigTable.version))
      .limit(1);
    return rows[0];
  }
}

function toLoadedVersion(row: typeof strategyConfigTable.$inferSelect): LoadedVersion {
  return {
    jobId: row.jobId,
    version: row.version,
    config: parseStrategyConfig(row.payload),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    lastValidated: row.lastValidated,
    reason: row.reason as ConfigReason,
  };
}
