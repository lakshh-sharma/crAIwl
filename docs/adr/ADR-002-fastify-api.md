# ADR-002 — Fastify for the API service

- **Status:** Accepted
- **Date:** 2026-05-25
- **Deciders:** crAIwl team

## Context

The API exposes a small, well-defined surface (job lifecycle, scope confirmation, results download — see CRAWL-085). We want JSON Schema validation as a first-class concern because the request/response shapes are how clients and the orchestrator agree on the world.

Alternatives: Express (mature but schema validation is bolted on), Hono (excellent but newer, more browser/edge-oriented), NestJS (heavier than this app needs).

## Decision

Use **Fastify** for the HTTP API. Use Fastify's native JSON Schema support for request validation and response serialization. Schemas live in `@craiwl/core` so they're shared with the orchestrator and CLI.

## Consequences

**Positive.**

- Schema-first endpoints catch shape mistakes at boundary, not in handlers.
- Fast response serialization (Fastify pre-compiles schemas).
- Lightweight; doesn't impose architectural ideology.

**Negative.**

- Smaller ecosystem than Express; some plugins less battle-tested.
- Schema-first feels heavier than ad-hoc JSON if you're used to Express.

**Override cost.** Medium — handlers are decoupled from the framework, but plugin choices (auth, rate-limit) would need re-picking.
