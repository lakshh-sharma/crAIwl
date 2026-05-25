# ADR-005 — Playwright (local) behind a swappable BrowserProvider interface

- **Status:** Accepted
- **Date:** 2026-05-25
- **Deciders:** crAIwl team

## Context

Many targets — docs sites, SPAs, anything React/Vue/Svelte — render meaningful content client-side. A static HTTP fetch returns an empty shell; we need a real browser (Tier 2 in the fetch ladder).

Running our own browser fleet at scale is operationally expensive: image sizes, memory, crash recovery, fingerprint maintenance. We want to start cheap (local Playwright) and keep the option to outsource (Steel.dev self-host, Browserbase, hyperbrowser) without rewriting callers.

## Decision

- Define a `BrowserProvider` interface (`launch`, `navigate`, `evaluate`, `close`) in `@craiwl/fetcher`.
- Ship a **local Playwright** implementation as the default.
- Leave a stub remote-provider implementation so the wiring is proven and switching is configuration, not refactoring.
- All Tier 2 callers go through the interface — they never import Playwright directly.

## Consequences

**Positive.**

- Local dev needs no external service.
- Production can outsource browsers when scale or anti-bot pressure demands it, without changing extraction code.
- Easy to mock in unit tests.

**Negative.**

- The interface must be designed for the lowest common denominator — features unique to one provider (e.g. session replay) leak via opaque opts.
- Local Playwright pools are easy to mismanage; CRAWL-031 must enforce resource limits.

**Override cost.** Medium — adding a new provider is a contained PR; replacing the interface itself touches every Tier 2 caller.
