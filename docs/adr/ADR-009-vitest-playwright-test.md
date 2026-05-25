# ADR-009 — Vitest (unit) + Playwright Test (integration/e2e fetch)

- **Status:** Accepted
- **Date:** 2026-05-25
- **Deciders:** crAIwl team

## Context

Two distinct testing needs:

- **Unit / fast feedback:** pure-function logic in `core`, `extractor` (locator resolution, transforms, validation), small modules in `orchestrator`. These must run in milliseconds and in CI on every PR.
- **Integration / fetch / e2e:** real HTTP, real browsers (Tier 2), real fixture sites. Slower, may require browser binaries, but essential — a crawler not tested against real-world rendering will silently break.

## Decision

- **Vitest** for unit tests across all packages. Configured at the root (`vitest.config.ts`) to discover `packages/*/src/**/*.{test,spec}.ts`.
- **Playwright Test** (separate test runner, separate config) for integration / e2e fetch tests that need a real browser or live HTTP. Lives under `packages/fetcher/tests-e2e/` and `packages/extractor/tests-e2e/`.
- The e2e suite runs against the self-hosted fixture site from CRAWL-121 — no third-party network dependency in CI.

## Consequences

**Positive.**

- Vitest's TS-native, ESM-native, watch-mode story is ideal for the inner loop.
- Playwright Test ships with the browser tooling we already use in production — no second browser stack to maintain.
- Clear split keeps the unit suite under a second; the e2e suite is opt-in for slower jobs.

**Negative.**

- Two test runners to learn.
- Mocks that work in Vitest don't directly transfer to Playwright Test; some duplication.

**Override cost.** Low — test files are co-located with packages and switching runners is a per-package operation.
