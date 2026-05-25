# Architecture Decision Records (ADRs)

Each ADR captures a single architectural decision: the context, the choice, and its consequences. ADRs are immutable once Accepted — supersede with a new ADR rather than editing.

## Template

```
# ADR-NNN — <title>

- **Status:** Proposed | Accepted | Superseded by ADR-XXX
- **Date:** YYYY-MM-DD
- **Deciders:** <names>

## Context
What forces are at play? Why are we deciding now?

## Decision
The choice, stated plainly.

## Consequences
Positive, negative, and follow-on effects. What does this make easy/hard?
```

## Index

| ID                                                   | Title                                                                           | Status                           |
| ---------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------- |
| [ADR-001](./ADR-001-typescript-node-monorepo.md)     | TypeScript / Node 20+ monorepo via pnpm workspaces                              | Accepted                         |
| [ADR-002](./ADR-002-fastify-api.md)                  | Fastify for the API service                                                     | Accepted                         |
| [ADR-003](./ADR-003-postgres-object-store.md)        | Postgres for relational state, S3-compatible object store for blobs             | Accepted                         |
| [ADR-004](./ADR-004-bullmq-redis-queue.md)           | BullMQ on Redis for the frontier queue                                          | Accepted                         |
| [ADR-005](./ADR-005-playwright-browser-provider.md)  | Playwright (local) behind a swappable BrowserProvider interface                 | Accepted                         |
| [ADR-006](./ADR-006-anthropic-structured-outputs.md) | Anthropic Claude API with structured outputs for compile/self-heal              | Accepted                         |
| [ADR-007](./ADR-007-readability-turndown.md)         | Readability-style main-content extraction + Turndown markdown                   | Accepted                         |
| [ADR-008](./ADR-008-secrets-provider-interface.md)   | Pluggable `SecretsProvider` interface (OS keychain / AWS Secrets Manager + KMS) | Proposed — awaiting confirmation |
| [ADR-009](./ADR-009-vitest-playwright-test.md)       | Vitest (unit) + Playwright Test (integration/e2e fetch)                         | Accepted                         |
| [ADR-010](./ADR-010-otel-pino.md)                    | OpenTelemetry traces + pino structured logs from day one                        | Accepted                         |
| [ADR-011](./ADR-011-drizzle-migrations.md)           | Drizzle ORM with hand-written SQL down migrations                               | Accepted                         |
