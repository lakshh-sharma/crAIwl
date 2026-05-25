# ADR-003 — Postgres for relational state, S3-compatible object store for blobs

- **Status:** Accepted
- **Date:** 2026-05-25
- **Deciders:** crAIwl team

## Context

We need to persist two very different kinds of data:

1. **Structured, relational state** with strong consistency: jobs, runs, strategy configs (versioned JSONB), extracted records, fetch attempts, audit events. This data wants foreign keys, indexes, ACID writes, and queries across joins.
2. **Large opaque blobs:** raw HTML snapshots, screenshots, full output exports. These are write-once, read-rarely, and don't belong in a row.

## Decision

- **Postgres** as the system of record for all relational data. JSONB used for the `StrategyConfig` payload so we get schemaless flexibility _inside_ a row with relational structure _around_ it.
- **S3-compatible object store** for blobs. Local dev uses **MinIO** (CRAWL-004); production uses S3 (or compatible).
- A blob in the object store is always referenced by URL + content hash from a Postgres row — never orphaned, never discovered by listing the bucket.

## Consequences

**Positive.**

- Postgres handles the job graph cleanly; JSONB gives config storage without an extra document store.
- Blobs don't bloat the DB or backups.
- MinIO ↔ S3 means dev and prod use the same API.

**Negative.**

- Two systems to back up, monitor, and run migrations against.
- Cross-store transactions don't exist — we accept "row first, blob second" with a janitor for orphans.

**Override cost.** High after M2 — once `strategy_config` JSONB shape stabilizes and indexes accumulate, switching to a different DB requires a real migration.
