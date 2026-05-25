# ADR-011 — Drizzle ORM with SQL migration files

- **Status:** Accepted
- **Date:** 2026-05-25
- **Deciders:** crAIwl team

## Context

CRAWL-005 calls for a migration tool. The backlog lists three candidates: Drizzle, Prisma, and node-pg-migrate. We need:

- Migrations that are reviewable as plain SQL (the operational surface — DBAs and oncall need to read them, not learn an ORM DSL).
- TypeScript types for tables that flow into application code without a codegen daemon.
- Both forward (`up`) and rollback (`down`) migrations because CRAWL-005 specifies "up/down migrations both tested."
- A lightweight runtime — we're not building a CRUD app where the ORM dominates.

**Prisma:** strong DX but heavy generator step, schema lives in its own DSL, and rollbacks aren't first-class. Overkill for our needs.

**node-pg-migrate:** SQL-first, mature, supports up/down. But no shared types between schema and query code — we'd hand-maintain TypeScript shapes alongside SQL.

**Drizzle:** schema defined in TypeScript; `drizzle-kit` generates SQL migrations from schema diffs; the same schema object powers query builders so types flow end-to-end.

## Decision

- **Drizzle ORM** as the runtime query/types layer (`drizzle-orm` + `postgres` driver).
- **`drizzle-kit`** generates forward SQL migration files (`NNNN_<name>.sql`).
- **Hand-written `NNNN_<name>.down.sql`** for each forward migration. Drizzle does not generate rollbacks; we own them explicitly.
- The custom migrator (`packages/core/src/db/migrator.ts`) applies forward migrations through Drizzle's built-in mechanism and applies rollbacks by reading `*.down.sql` in reverse order.
- Schema lives in `packages/core/src/db/schema.ts` — single source of truth for both migrations and runtime queries.

## Consequences

**Positive.**

- One artifact (`schema.ts`) drives migrations _and_ types — no drift between DDL and query code.
- Migrations are plain SQL files in git, reviewable in any PR.
- Rollback path is explicit, not magical — if we can't write the down migration, that's a signal the forward change is irreversible and needs design review.
- No runtime ORM overhead beyond a thin query builder.

**Negative.**

- Hand-writing down migrations is extra discipline; a missing or wrong down breaks rollback testing.
- `drizzle-kit` is younger than Prisma's tooling; some edge cases around generated SQL may need manual cleanup.

**Override cost.** Low for tooling, medium for the schema itself once data is in production.
