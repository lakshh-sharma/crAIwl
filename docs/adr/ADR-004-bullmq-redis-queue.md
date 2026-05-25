# ADR-004 — BullMQ on Redis for the frontier queue

- **Status:** Accepted
- **Date:** 2026-05-25
- **Deciders:** crAIwl team

## Context

A crawl is a long-lived control loop, not a for-loop. The frontier (URLs to fetch) must survive process crashes, support pause/resume/cancel, enforce per-domain concurrency and rate limits, and let multiple workers pull work without trampling each other (CRAWL-075, CRAWL-077).

Options considered:

- **Postgres-as-queue** (`SELECT FOR UPDATE SKIP LOCKED`): simple, fewer moving parts, but rate-limit primitives must be hand-rolled.
- **BullMQ on Redis**: persistent jobs, repeatable jobs, rate limiter, priority, retries, observability dashboards — out of the box.
- **SQS / managed**: ties us to a cloud, painful in local dev.

## Decision

Use **BullMQ on Redis** as the frontier queue. Configure per-queue rate limiters for politeness. Persist Redis (AOF on) so crashes don't lose the frontier.

## Consequences

**Positive.**

- Resume from crash for free — no bespoke "pick up where you left off" logic.
- Built-in primitives for rate limiting, retries with backoff, delayed jobs (scheduling).
- Active community, mature TS types.

**Negative.**

- One more service to run in dev (mitigated by CRAWL-004's `docker-compose`).
- Redis is in-memory; persistence is best-effort, not transactional with Postgres.

**Override cost.** Medium — the `Queue` interface in `@craiwl/orchestrator` should be narrow enough that swapping the backend is a contained change.
