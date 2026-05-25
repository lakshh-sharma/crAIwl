# ADR-010 — OpenTelemetry traces + pino structured logs from day one

- **Status:** Accepted
- **Date:** 2026-05-25
- **Deciders:** crAIwl team

## Context

A crawl is a distributed pipeline: API receives a request → orchestrator enqueues URLs → workers fetch (across tiers) → extractor compiles → executor runs → output is written. When something fails — a flaky selector, a 403, a self-heal storm — you cannot debug it without correlating events across stages.

Retrofitting observability is expensive and tends to miss the failure modes that matter (the ones we discovered in production). It's cheap to add at scaffolding time (CRAWL-003) and pays back on the first hard bug.

## Decision

- **pino** for structured logging across every package. JSON in prod, pretty-printed in dev. Per-job `correlationId` propagated through every package boundary.
- **OpenTelemetry** for tracing. A span wraps each pipeline stage: `fetch`, `compile`, `execute`, `validate`, `self-heal`. Spans carry the job id, URL, tier used, and config version.
- A **redaction layer** strips credential/token patterns from logs (ties to CRAWL-061's output redaction).
- Exporters are configurable — local dev emits to stdout / a local collector; production targets the org's standard backend.

## Consequences

**Positive.**

- Every bug report comes with a trace; "works on my machine" gets a lot smaller.
- Cost accounting (CRAWL-090) and the metrics dashboard (CRAWL-120) read from the same instrumentation.
- Redaction lives in one place, not sprinkled at every log call site.

**Negative.**

- Some perf overhead per span (small, but non-zero).
- Discipline required — adding a new pipeline stage without a span is a regression we can only catch by code review.

**Override cost.** Low — switching backends is configuration; the API surface (pino + OTel) is industry standard.
