# ADR-006 — Anthropic Claude API with structured outputs for compile/self-heal

- **Status:** Accepted
- **Date:** 2026-05-25
- **Deciders:** crAIwl team

## Context

The compile phase (CRAWL-050) and self-heal loop (CRAWL-065) ask an LLM to produce a `StrategyConfig` — a typed, schema-validated artifact, not free-form text. If the LLM returns malformed JSON, an unknown field, or the wrong shape, the executor cannot run it. We need constrained decoding so the model's output is guaranteed parseable, and we need a model that's strong enough to do the locator-synthesis reasoning.

## Decision

- Use the **Anthropic Claude API** as the primary LLM provider.
- Use **tool-use / structured-output schemas** to enforce that compile/self-heal outputs conform to the `StrategyConfig` JSON Schema.
- Pin the model version per prompt; record the version on each generated config (provenance — `createdBy`).
- Keep model identity behind an `LLMProvider` interface so we can evaluate alternatives without ripping out callers.

## Consequences

**Positive.**

- Malformed JSON and off-schema responses become impossible by construction — huge robustness win for self-heal.
- Provenance is auditable: every config knows which model wrote it.
- Prompt + schema are versioned together; eval harness (CRAWL-051) catches regressions.

**Negative.**

- Vendor dependency (mitigated by the provider interface, but the prompts are tuned to Claude).
- Structured-output overhead is non-zero — pages still pay tokens during compile (one-time per template).

**Override cost.** Low — provider interface, schemas, and prompts are isolated; swapping models is a contained spike.
