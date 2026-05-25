# ADR-001 — TypeScript / Node 20+ monorepo via pnpm workspaces

- **Status:** Accepted
- **Date:** 2026-05-25
- **Deciders:** crAIwl team

## Context

crAIwl spans client UX, an HTTP API, a fetch fleet, and browser automation. We want one language so types flow end-to-end and a contributor can move between layers without context-switching. The ecosystem we need (Playwright, got-scraping, undici, Readability, Turndown, BullMQ, Fastify, Anthropic SDK) is first-class in Node — duplicating it in another runtime would be wasted effort.

A monorepo lets us share types (especially `StrategyConfig` — see CRAWL-010) by reference, not by publishing, and refactor across packages atomically.

## Decision

- **TypeScript** (strict) targeting **Node 20 LTS** or newer.
- **Monorepo** via **pnpm workspaces** with TS **project references** for incremental builds.
- Packages: `core`, `fetcher`, `extractor`, `orchestrator`, `api`, `cli`.
- TS config enables `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `isolatedModules`.
- Module format: ESM (`"type": "module"` per package), `module: NodeNext`.

## Consequences

**Positive.**

- One toolchain (tsc, eslint, vitest) for every layer.
- `StrategyConfig` and friends are imported directly, so a schema change is a typecheck failure, not a runtime surprise.
- pnpm's content-addressed store keeps installs cheap even across many packages.

**Negative.**

- Lock-in: switching languages later is expensive after Milestone 1.
- ESM in Node still requires `.js` extensions in relative imports — a small ergonomic tax.
- New contributors may need to learn pnpm + project references.

**Override cost.** High after M1 — fetcher and extractor will accumulate Node-specific code (undici, Playwright APIs).
