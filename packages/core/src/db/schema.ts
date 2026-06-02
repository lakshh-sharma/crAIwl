import {
  bigserial,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * crawl_job — the top-level user-declared crawl target. One job = one
 * (URL + goal) pair. Status moves through the lifecycle states defined
 * by the orchestrator (discovering → awaiting-confirm → crawling → done/failed).
 */
export const crawlJob = pgTable(
  'crawl_job',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    goal: text('goal').notNull(),
    startingUrl: text('starting_url').notNull(),
    requestedFields: jsonb('requested_fields').notNull().default([]),
    outputFormats: jsonb('output_formats').notNull().default(['json']),
    robotsPolicy: text('robots_policy').notNull().default('respect'),
    scope: text('scope').notNull().default('section'),
    maxPages: integer('max_pages'),
    maxDepth: integer('max_depth'),
    status: text('status').notNull().default('created'),
  },
  (t) => ({
    statusIdx: index('crawl_job_status_idx').on(t.status),
    createdAtIdx: index('crawl_job_created_at_idx').on(t.createdAt),
  }),
);

/**
 * strategy_config — versioned per (job_id, version). This is the compiled
 * extraction program (locators, anchors, validate rules). Self-heal bumps
 * version + records `reason='self-heal'`; user edits use `reason='manual-edit'`.
 */
export const strategyConfigTable = pgTable(
  'strategy_config',
  {
    jobId: uuid('job_id')
      .notNull()
      .references(() => crawlJob.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    payload: jsonb('payload').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    lastValidated: timestamp('last_validated', { withTimezone: true }),
    reason: text('reason').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.jobId, t.version] }),
  }),
);

/**
 * crawl_run — one execution of a job at a specific config version.
 * Re-runs (scheduled or manual) produce new rows; the config version
 * pins exactly which extraction program ran.
 */
export const crawlRun = pgTable(
  'crawl_run',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => crawlJob.id, { onDelete: 'cascade' }),
    configVersion: integer('config_version').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    status: text('status').notNull().default('running'),
    pagesFetched: integer('pages_fetched').notNull().default(0),
    pagesExtracted: integer('pages_extracted').notNull().default(0),
    error: text('error'),
  },
  (t) => ({
    jobIdx: index('crawl_run_job_idx').on(t.jobId),
    statusIdx: index('crawl_run_status_idx').on(t.status),
  }),
);

/**
 * extracted_record — one record per (run, page, recordIndex). For
 * multi-record pages (e.g. a list of pricing tiers) recordIndex > 0.
 * Confidence is the gate that routes below-floor records to the review queue.
 */
export const extractedRecord = pgTable(
  'extracted_record',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => crawlRun.id, { onDelete: 'cascade' }),
    pageUrl: text('page_url').notNull(),
    recordIndex: integer('record_index').notNull().default(0),
    payload: jsonb('payload').notNull(),
    confidence: numeric('confidence', { precision: 4, scale: 3 }),
    extractedAt: timestamp('extracted_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    runIdx: index('extracted_record_run_idx').on(t.runId),
    runPageIdx: index('extracted_record_run_page_idx').on(t.runId, t.pageUrl),
  }),
);

/**
 * fetch_attempt — one row per HTTP request the fetcher makes. Used for
 * politeness debugging, tier-selection analysis, and cost accounting
 * (CRAWL-090). Persisted even on failure.
 */
export const fetchAttempt = pgTable(
  'fetch_attempt',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => crawlRun.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    finalUrl: text('final_url'),
    statusCode: integer('status_code'),
    tierUsed: text('tier_used').notNull(),
    timingMs: integer('timing_ms'),
    error: text('error'),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    runIdx: index('fetch_attempt_run_idx').on(t.runId),
    statusIdx: index('fetch_attempt_status_idx').on(t.statusCode),
  }),
);

/**
 * audit_event — append-only log of compliance-relevant events: robots
 * policy choices, auth use, proxy enable, ignore-robots opt-in, etc.
 * Bigserial because we want monotonic ordering and we never delete.
 * Tamper-evidence (e.g. hash chaining) is a future hardening pass.
 */
export const auditEvent = pgTable(
  'audit_event',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    jobId: uuid('job_id').references(() => crawlJob.id, { onDelete: 'set null' }),
    runId: uuid('run_id').references(() => crawlRun.id, { onDelete: 'set null' }),
    eventType: text('event_type').notNull(),
    actor: text('actor').notNull(),
    detail: jsonb('detail').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    jobIdx: index('audit_event_job_idx').on(t.jobId),
    createdAtIdx: index('audit_event_created_at_idx').on(t.createdAt),
    typeIdx: index('audit_event_type_idx').on(t.eventType),
  }),
);

export type CrawlJob = typeof crawlJob.$inferSelect;
export type NewCrawlJob = typeof crawlJob.$inferInsert;
export type StrategyConfigRow = typeof strategyConfigTable.$inferSelect;
export type NewStrategyConfigRow = typeof strategyConfigTable.$inferInsert;
export type CrawlRun = typeof crawlRun.$inferSelect;
export type NewCrawlRun = typeof crawlRun.$inferInsert;
export type ExtractedRecord = typeof extractedRecord.$inferSelect;
export type NewExtractedRecord = typeof extractedRecord.$inferInsert;
export type FetchAttempt = typeof fetchAttempt.$inferSelect;
export type NewFetchAttempt = typeof fetchAttempt.$inferInsert;
export type AuditEventRow = typeof auditEvent.$inferSelect;
export type NewAuditEventRow = typeof auditEvent.$inferInsert;
