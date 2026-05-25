# crAIwl — Engineering Backlog (Tickets for Claude Code)

**Companion to:** `crAIwl-technical-design.md` · **Last updated:** May 2026
**Purpose:** A build-ready, dependency-ordered ticket backlog. Each ticket is scoped so a coding agent (Claude Code) can pick it up cold, understand _why_ it exists, and know exactly when it's done. Read the design doc first — every ticket assumes the control-plane / data-plane split and the **LLM-as-compiler, not runtime** principle.

---

## How to use this backlog with Claude Code

- **Work top-down within a milestone.** Tickets are ordered so dependencies are satisfied if you go in numeric order. The `Depends on` field is authoritative — never start a ticket whose dependencies are open.
- **One ticket = one PR.** Keep PRs reviewable. If a ticket feels like more than ~1–2 days of work, it's mis-sized — split it and note the split in the PR.
- **Acceptance criteria are the contract.** A ticket is not done until every checkbox passes _and_ the global Definition of Done (below) is met.
- **Spikes produce a decision, not production code.** A `Spike` ticket's deliverable is a short written recommendation (committed as a markdown ADR under `/docs/adr/`), not a feature.
- **Stack decisions are in §ADRs.** If you disagree with a stack choice while implementing, stop and open an ADR-amendment PR rather than silently diverging.

### Global Definition of Done (applies to every Feature/Chore ticket)

- [ ] Code typechecks (`pnpm typecheck`) and lints (`pnpm lint`) with zero new errors.
- [ ] Unit tests for the happy path + at least one failure path; integration test where the ticket touches I/O.
- [ ] No secrets, tokens, or credentials in code, logs, fixtures, or committed config.
- [ ] Public functions/modules have doc comments; non-obvious decisions have inline rationale.
- [ ] If the ticket changes behavior the user sees or an operator runs, update the relevant README/runbook.
- [ ] PR description links the ticket ID and lists what was verified manually.

### Conventions

- **Ticket ID:** `CRAWL-NNN`. **Type:** Feature · Chore · Spike · Bug · Infra.
- **Priority:** P0 (blocker for its milestone) · P1 (needed for milestone) · P2 (nice-to-have / can slip).
- **Size:** S (≤½ day) · M (~1 day) · L (~2 days) · XL (split it — only used for epics not yet broken down).
- **Labels** are hints for filtering: `extraction`, `fetch`, `orchestration`, `auth`, `security`, `compliance`, `infra`, `api`, `observability`, `ux`.

---

## Stack decisions (ADRs — confirm before Milestone 0 starts)

These are senior-eng default recommendations chosen to match the design doc. They're cheap to change _now_ and expensive later, so confirm or override them in M0. Each becomes a file under `/docs/adr/`.

| ADR     | Decision                                                                                                                            | Rationale                                                                                         | Override cost                |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------- |
| ADR-001 | **TypeScript / Node 20+**, monorepo via **pnpm workspaces**                                                                         | Same language client→server→browser automation; Playwright + got-scraping are first-class in Node | High after M1                |
| ADR-002 | **Fastify** API service                                                                                                             | Lightweight, schema-first (JSON Schema native), fast                                              | Medium                       |
| ADR-003 | **Postgres** for configs/jobs/runs/audit; **S3-compatible object store** for raw page snapshots & outputs                           | Relational for the job graph, blob for big artifacts                                              | High after M2                |
| ADR-004 | **BullMQ on Redis** for the frontier queue                                                                                          | Persistent, resumable, rate-limit primitives built in                                             | Medium                       |
| ADR-005 | **Playwright** for headless (Tier 2); pluggable remote provider (**Steel.dev** self-host / Browserbase hosted) behind one interface | Don't build a browser fleet; keep it swappable; Steel keeps local-first option open               | Medium                       |
| ADR-006 | **Anthropic Claude API** with **Structured Outputs / tool-use schema enforcement** for the compile + self-heal phases               | Constrained decoding kills malformed/off-schema output                                            | Low                          |
| ADR-007 | DOM cleaning via **Readability-style** main-content extraction + **Turndown** for markdown                                          | Shrinks tokens before compile; standard, well-understood                                          | Low                          |
| ADR-008 | Secrets via a **pluggable `SecretsProvider` interface**: OS keychain (local mode) / AWS Secrets Manager + KMS (hosted)              | Lets us defer the local-vs-hosted decision (design doc §4.2) behind code                          | Low if interface lands early |
| ADR-009 | **Vitest** (unit) + **Playwright Test** (integration/e2e fetch)                                                                     | Fast, TS-native                                                                                   | Low                          |
| ADR-010 | **OpenTelemetry** traces + **pino** structured logs from day one                                                                    | Crawlers are distributed systems; you cannot debug them without traces                            | Low                          |

---

## Epic & milestone map

| Epic    | Theme                                                  | Primary milestone  |
| ------- | ------------------------------------------------------ | ------------------ |
| **E0**  | Foundation & repo scaffolding                          | M0                 |
| **E1**  | Strategy Config (the durable asset)                    | M0–M1              |
| **E2**  | Fetch layer & fetch ladder                             | M1                 |
| **E3**  | DOM normalization & tokenization                       | M1                 |
| **E4**  | Extraction — Compile phase (LLM)                       | M1                 |
| **E5**  | Extraction — Execute phase (deterministic)             | M1                 |
| **E6**  | Grounding, validation & confidence                     | M1–M2              |
| **E7**  | Self-heal loop                                         | M2                 |
| **E8**  | Discovery (sitemap / docs detection)                   | M1                 |
| **E9**  | Crawl orchestration (queue, dedup, politeness, robots) | M1–M2              |
| **E10** | Output formats & export                                | M1                 |
| **E11** | Test-crawl / single-page preview                       | M1                 |
| **E12** | API surface & job lifecycle                            | M1                 |
| **E13** | Scheduling & re-runs                                   | M2                 |
| **E14** | Anti-bot fetch tiers (impersonation, proxy, auto-tier) | M3                 |
| **E15** | Auth & secrets                                         | M4                 |
| **E16** | Compliance & legal-posture layer                       | M1 (defaults) → M4 |
| **E17** | Observability, ops & cost accounting                   | cross-cutting      |

**Milestones** mirror the design doc's roadmap:

- **M0 — Foundations:** repo, ADRs, config schema, CI, secrets interface.
- **M1 — Docs extractor, no auth (the wedge):** fetch T0/T2 → compile → execute → output, with discovery + preview + basic orchestration. _This is the first demoable product._
- **M2 — Self-heal + scheduling + grounding hardening.**
- **M3 — Fetch ladder + general targets (impersonation, proxy, auto-tier).**
- **M4 — Auth (highest risk, last).**

---

# E0 — Foundation & repo scaffolding (M0)

### CRAWL-001 — Initialize monorepo, tooling, and CI

- **Type:** Infra · **Priority:** P0 · **Size:** M · **Depends on:** — · **Labels:** infra

**Context.** Everything downstream needs a consistent workspace. Get the skeleton right once.

**Scope.** In: pnpm workspace with packages `core` (shared types), `fetcher`, `extractor`, `orchestrator`, `api`, `cli`; root TS config (strict), ESLint + Prettier, Vitest, husky pre-commit, GitHub Actions running typecheck/lint/test on PR. Out: any product code.

**Acceptance criteria.**

- [ ] `pnpm install && pnpm build && pnpm test` succeeds from a clean clone.
- [ ] CI fails a PR on type error, lint error, or failing test.
- [ ] `tsconfig` uses `strict: true`, `noUncheckedIndexedAccess: true`.
- [ ] A trivial test in each package proves the harness runs per-package.

**Technical notes.** Use project references so packages build independently. Pin Node version via `.nvmrc` + `engines`.

### CRAWL-002 — Author the ten foundational ADRs

- **Type:** Chore · **Priority:** P0 · **Size:** S · **Depends on:** 001 · **Labels:** infra

**Context.** Stack decisions above must be committed and reviewable so future contributors (human or agent) understand the "why."

**Acceptance criteria.**

- [ ] `/docs/adr/ADR-001…010.md` exist, each using the standard ADR template (Context / Decision / Consequences / Status).
- [ ] Each ADR's status is `Accepted` or explicitly `Proposed — awaiting confirmation`.
- [ ] A `docs/adr/README.md` indexes them.

### CRAWL-003 — Structured logging + tracing baseline

- **Type:** Infra · **Priority:** P0 · **Size:** M · **Depends on:** 001 · **Labels:** observability

**Context.** A crawler is a distributed pipeline; without correlation IDs and traces, failures are undebuggable (design doc §6, §3.4). Build this before features, not after.

**Acceptance criteria.**

- [ ] `pino` logger with per-job `correlationId` propagated through every package.
- [ ] OpenTelemetry tracing initialized; a span wraps each pipeline stage (fetch, compile, execute, validate).
- [ ] Logs are JSON in prod, pretty in dev; log level via env.
- [ ] A redaction layer strips anything matching credential/token patterns from logs (ties to security; see CRAWL-061).

### CRAWL-004 — Local dev environment (Postgres + Redis + object store)

- **Type:** Infra · **Priority:** P0 · **Size:** S · **Depends on:** 001 · **Labels:** infra

**Acceptance criteria.**

- [ ] `docker-compose.yml` brings up Postgres, Redis, and MinIO (S3-compatible).
- [ ] `pnpm dev:up` / `dev:down` scripts; seed script creates schemas.
- [ ] README documents how to run the full stack locally.

### CRAWL-005 — Database schema & migrations baseline

- **Type:** Infra · **Priority:** P0 · **Size:** M · **Depends on:** 004 · **Labels:** infra

**Context.** Core entities: `crawl_job`, `crawl_run`, `strategy_config`, `extracted_record`, `fetch_attempt`, `audit_event`.

**Acceptance criteria.**

- [ ] Migration tool wired (e.g. `drizzle`/`prisma`/`node-pg-migrate` — pick one, record in ADR).
- [ ] Tables above created with sensible indexes (job→runs, run→records, config versioning).
- [ ] `strategy_config` stores versioned JSONB + metadata (author model, createdAt, lastValidated).
- [ ] Up/down migrations both tested.

---

# E1 — Strategy Config: the durable asset (M0–M1)

### CRAWL-010 — Define the StrategyConfig schema (the crown jewel)

- **Type:** Feature · **Priority:** P0 · **Size:** L · **Depends on:** 001 · **Labels:** extraction, core

**Context.** This is the single most important data structure in the product (design doc §2.2). It's what makes re-runs cheap, what gets exported/scheduled, and what self-heal patches. Get it right before anything reads or writes it.

**Scope.** In: a versioned TypeScript type + JSON Schema for StrategyConfig, including `pageTemplates[]`, per-field `locators[]` (ranked), `semanticAnchor`, `type`, `transform`, `validate`, `required`, `pagination`, `fetchProfile`, `confidenceFloor`, provenance (`createdBy`, `strategyVersion`, `lastValidated`). Out: the code that generates it (E4) or executes it (E5).

**Acceptance criteria.**

- [ ] JSON Schema validates the example config from design doc §2.2.
- [ ] TS types are the source of truth; JSON Schema is generated from them (or vice versa) — not hand-maintained twice.
- [ ] Semver semantics documented: what bumps major/minor/patch.
- [ ] Round-trip test: parse → serialize → parse is stable.
- [ ] Rejects unknown fields by default (forward-compat policy documented).

**Technical notes.** Ranked `locators` array is the resilience mechanism — schema must enforce ≥1 locator per required field. `validate` should be a small, safe expression DSL (see CRAWL-012), not arbitrary JS.

### CRAWL-011 — Config persistence, versioning & diff

- **Type:** Feature · **Priority:** P0 · **Size:** M · **Depends on:** 005, 010 · **Labels:** extraction, core

**Context.** Configs are code; they must version, roll back, and diff (design doc §2.2). Self-heal will create new versions.

**Acceptance criteria.**

- [ ] Save/load config by `(jobId, version)`; "latest" resolves correctly.
- [ ] Human-readable diff between two versions (which fields/locators changed).
- [ ] Rollback to a prior version is a first-class operation.
- [ ] Each version records author (`claude-…` or `user`) and reason (`compile` | `self-heal` | `manual-edit`).

### CRAWL-012 — Safe validation-expression evaluator

- **Type:** Feature · **Priority:** P0 · **Size:** M · **Depends on:** 010 · **Labels:** extraction, security

**Context.** The per-field `validate` rule (e.g. `value>=0 && value<100000`, `len>0 && len<60`) is both the quality gate and the self-heal trigger. It must run untrusted-ish expressions safely — never `eval`.

**Acceptance criteria.**

- [ ] A sandboxed expression evaluator supporting numeric/string/length/regex/range predicates over a single field value.
- [ ] No access to globals, prototypes, network, or filesystem (test the escape attempts).
- [ ] Clear error when an expression is malformed (fails closed → treats field as invalid).
- [ ] Documented grammar of supported operators.

**Technical notes.** Consider a tiny purpose-built parser or a vetted library (e.g. `expr-eval`, `jexl`) — record choice in an ADR. Do NOT use `Function`/`eval`.

### CRAWL-013 — Transform pipeline (`stripCurrency|toFloat`, etc.)

- **Type:** Feature · **Priority:** P1 · **Size:** M · **Depends on:** 010 · **Labels:** extraction

**Acceptance criteria.**

- [ ] A registry of named, composable, pure transforms (`trim`, `toFloat`, `toInt`, `stripCurrency`, `normalizeWhitespace`, `parseDate`, `absoluteUrl`…).
- [ ] Transforms compose via the `|` syntax in the config.
- [ ] Unknown transform name fails validation at config-load time, not at runtime.
- [ ] Each transform unit-tested with edge cases (empty, malformed, locale).

---

# E3 — DOM normalization & tokenization (M1)

### CRAWL-020 — HTML → cleaned DOM / main-content extraction

- **Type:** Feature · **Priority:** P0 · **Size:** M · **Depends on:** 001 · **Labels:** extraction, fetch

**Context.** Before the LLM compiles or the executor runs, strip nav/ads/boilerplate to the meaningful content (design doc §2, ADR-007). Reduces tokens and noise dramatically.

**Acceptance criteria.**

- [ ] Given raw HTML, produce (a) a cleaned DOM and (b) a markdown rendering.
- [ ] Boilerplate (nav, footer, cookie banners, scripts) removed; main content retained.
- [ ] Preserves enough structure (headings, lists, tables, links, data attributes) for selector generation.
- [ ] Deterministic: same input → same output.
- [ ] Benchmarked token reduction on 5 sample pages (report in PR).

### CRAWL-021 — Token budgeter & DOM chunking for compile

- **Type:** Feature · **Priority:** P1 · **Size:** M · **Depends on:** 020 · **Labels:** extraction

**Context.** Large pages blow the context window and cost. The compile phase needs a strategy to fit a page (or a representative template region) into budget.

**Acceptance criteria.**

- [ ] Estimate token count of a cleaned DOM.
- [ ] When over budget, select the representative region(s) for the target template rather than truncating blindly.
- [ ] Configurable max-token budget per compile call; logged per call (feeds cost accounting, CRAWL-090).

---

# E2 — Fetch layer & fetch ladder (M1, extended in M3)

### CRAWL-030 — Fetcher interface + Tier 0 (server-side HTTP)

- **Type:** Feature · **Priority:** P0 · **Size:** M · **Depends on:** 003 · **Labels:** fetch

**Context.** Fetching is the hard 80% and MUST be server-side — CORS makes a browser-only fetcher impossible (design doc §3.1). Start with the cheapest tier behind a clean interface so higher tiers slot in later.

**Scope.** In: a `Fetcher` interface (`fetch(url, opts) → {status, headers, body, finalUrl, timing, tierUsed}`); a Tier 0 implementation using `undici`. Out: impersonation (CRAWL-070), headless (CRAWL-031), proxies (CRAWL-072).

**Acceptance criteria.**

- [ ] Handles redirects, timeouts, gzip/br, configurable headers/User-Agent.
- [ ] Returns a structured result incl. which tier served the request and timing.
- [ ] Retries with backoff on transient errors (5xx, network) but NOT on 4xx.
- [ ] Per-request and per-domain timeout budgets.
- [ ] Records a `fetch_attempt` row (CRAWL-005) for observability.

### CRAWL-031 — Tier 2 headless fetch (Playwright) behind a provider interface

- **Type:** Feature · **Priority:** P0 · **Size:** L · **Depends on:** 030 · **Labels:** fetch

**Context.** Docs/SPAs render client-side; raw HTML is empty. Need a real browser. Per ADR-005 keep the provider swappable (local Playwright ↔ Steel.dev/Browserbase).

**Acceptance criteria.**

- [ ] `BrowserProvider` interface with a local-Playwright implementation; remote provider stubbed with a clear TODO.
- [ ] Returns fully rendered DOM after network-idle / configurable wait condition.
- [ ] Supports scripted actions (scroll, click "load more") via a small action list — used later for infinite scroll (CRAWL-085).
- [ ] Browser instances are pooled and torn down cleanly (no leak under repeated runs — test it).
- [ ] Resource limits (max concurrent browsers) enforced.

### CRAWL-032 — Fetch-tier selection heuristic (static vs headless)

- **Type:** Feature · **Priority:** P1 · **Size:** M · **Depends on:** 030, 031 · **Labels:** fetch

**Context.** Don't pay for headless when Tier 0 suffices. Decide automatically, then record the winning tier in `fetchProfile` so re-runs skip straight to it (design doc §3.2).

**Acceptance criteria.**

- [ ] Given a URL + target fields, decide a starting tier: try T0; if the target content is absent from raw HTML or status is challenge/403, escalate to T2.
- [ ] "Content absent" is judged against whether the target field anchors appear in raw HTML.
- [ ] Chosen tier is persisted to the config's `fetchProfile`.
- [ ] Decision is logged with the reason.

### CRAWL-033 — robots.txt fetch & RFC 9309 parser

- **Type:** Feature · **Priority:** P0 · **Size:** M · **Depends on:** 030 · **Labels:** fetch, compliance

**Context.** Parse robots.txt correctly per RFC 9309 (design doc §3.4). `Crawl-delay` is NOT in the RFC — parse it as an advisory extension, don't treat its absence as an error.

**Acceptance criteria.**

- [ ] Fetches and caches robots.txt per host (with TTL).
- [ ] Correctly resolves allow/disallow for a given path + user-agent per RFC 9309 longest-match rules.
- [ ] Surfaces `Crawl-delay` and `Sitemap:` directives separately as advisory data.
- [ ] Malformed/missing robots.txt → "allow all" with a logged note (per spec convention).
- [ ] Unit tests cover RFC 9309 matching edge cases (wildcards, `$`, longest-match, case).

---

# E8 — Discovery (M1)

### CRAWL-040 — Sitemap discovery & parsing

- **Type:** Feature · **Priority:** P1 · **Size:** M · **Depends on:** 030, 033 · **Labels:** orchestration, discovery

**Context.** Step 1 of the spec's discovery flow. Sitemaps are the cheapest, most reliable URL source.

**Acceptance criteria.**

- [ ] Discover sitemaps from robots.txt and `/sitemap.xml`; follow sitemap indexes recursively (bounded depth).
- [ ] Parse XML + gzip sitemaps; handle `lastmod` for incremental crawls later.
- [ ] Dedup and canonicalize URLs.
- [ ] Graceful when no sitemap exists (fall through to next discovery method).

### CRAWL-041 — Heuristic doc-path probing + nav parsing

- **Type:** Feature · **Priority:** P1 · **Size:** M · **Depends on:** 040 · **Labels:** discovery

**Context.** Spec's discovery steps 2–3: probe `/docs`, `/api`, `/reference`, etc.; parse homepage nav for doc-like links.

**Acceptance criteria.**

- [ ] Probes the common doc paths from the spec; records which resolve (200, content).
- [ ] Extracts in-nav links from the homepage and scores them for "doc-likeness."
- [ ] Returns a candidate URL set with a source attribution per URL (sitemap / probe / nav).

### CRAWL-042 — Semantic "is this a docs site?" classifier (LLM, bounded)

- **Type:** Feature · **Priority:** P2 · **Size:** M · **Depends on:** 041, 020 · **Labels:** discovery, extraction

**Context.** Spec's discovery step 4. Use Claude to judge whether discovered pages are documentation — but bound the cost (don't classify thousands of pages individually).

**Acceptance criteria.**

- [ ] Classifies a small sample of candidate pages, not the whole set.
- [ ] Returns a confidence + short rationale per sampled page.
- [ ] Result feeds the scope-confirmation UI (CRAWL-052), never auto-crawls without user confirm.

---

# E4 — Extraction: Compile phase (M1)

### CRAWL-050 — Compile: DOM + goal + schema → StrategyConfig (LLM)

- **Type:** Feature · **Priority:** P0 · **Size:** XL→split · **Depends on:** 010, 012, 013, 020, 021 · **Labels:** extraction

**Context.** The heart of the product (design doc §2.1, Phase A). On the first page of a template, Claude returns the _extraction program_ — ranked locators + anchors + validation per field — NOT just the data. Split into the sub-tickets below.

#### CRAWL-050a — Goal → field schema inference

- **Size:** M · **Depends on:** 010
- [ ] Given a natural-language goal ("extract all pricing tiers with price + features") and optional user-specified fields, produce a normalized field schema (name, type, required, description).
- [ ] User-specified fields take precedence; inferred fields are clearly marked as inferred.
- [ ] Uses Structured Outputs (ADR-006) so the schema is always well-formed.

#### CRAWL-050b — Locator synthesis with ranked candidates

- **Size:** L · **Depends on:** 050a, 020
- [ ] For each field, emit ≥2 ranked locator candidates (CSS/XPath) plus a `semanticAnchor` string.
- [ ] Locators are validated against the actual cleaned DOM at compile time — a locator that doesn't resolve on the source page is rejected before it's written to the config.
- [ ] Emits `type`, `transform`, `validate`, `required` per field.
- [ ] Output conforms to the StrategyConfig schema (CRAWL-010) and passes the validator.

#### CRAWL-050c — Page-template detection / grouping

- **Size:** M · **Depends on:** 050b
- [ ] Detect repeated template regions on a page (e.g. each pricing card, each list item) and emit a `matchHeuristic` for the repeating unit.
- [ ] Distinguish "one record per page" vs "many records per page."

### CRAWL-051 — Compile prompt-engineering harness + golden tests

- **Type:** Feature · **Priority:** P0 · **Size:** M · **Depends on:** 050 · **Labels:** extraction, observability

**Context.** Prompt quality is the product. Treat prompts like code: versioned, evaluated against fixtures, regression-tested.

**Acceptance criteria.**

- [ ] A fixtures set of ≥8 saved real pages (docs, pricing, listings) with hand-labeled expected fields.
- [ ] An eval runner that scores compiled configs against expected output (precision/recall per field).
- [ ] Prompt versions are tracked; eval results recorded per version so regressions are visible.
- [ ] CI runs the eval (can be a nightly/manual job if cost-sensitive) and reports score deltas.

### CRAWL-052 — Scope-confirmation step (human-in-loop before full crawl)

- **Type:** Feature · **Priority:** P0 · **Size:** M · **Depends on:** 042, 050 · **Labels:** ux, orchestration

**Context.** Spec flow step 3 + design doc §8: user reviews discovered pages + the proposed config and corrects field mappings _before_ committing tokens/time. The correction signal also improves the config.

**Acceptance criteria.**

- [ ] API returns: discovered scope + a single-page preview of extracted fields + the proposed config.
- [ ] User can deselect URLs, rename/drop/add fields, and accept.
- [ ] User edits are persisted as a `manual-edit` config version (CRAWL-011).
- [ ] Full crawl cannot start until scope is confirmed.

---

# E5 — Extraction: Execute phase (M1)

### CRAWL-055 — Deterministic executor (run config, zero LLM tokens)

- **Type:** Feature · **Priority:** P0 · **Size:** L · **Depends on:** 010, 012, 013, 020 · **Labels:** extraction

**Context.** Phase B (design doc §2.1). For every page, run the compiled locators with a plain parser — no LLM call. This is what makes crawls cheap (0.03–0.05× of naive) and fast (50–200ms/page).

**Acceptance criteria.**

- [ ] Given a cleaned DOM + StrategyConfig, produce structured records with zero network/LLM calls.
- [ ] Tries ranked locators in order; first that resolves AND passes `validate` wins.
- [ ] Applies transforms; coerces to declared type.
- [ ] Emits per-field outcome: `value | null + reason` (locator-miss vs validation-fail) — this is the self-heal trigger signal.
- [ ] Handles multi-record pages (one row per template match).
- [ ] Benchmarked p50/p95 latency on fixtures (report in PR).

### CRAWL-056 — Extraction result model + provenance

- **Type:** Feature · **Priority:** P0 · **Size:** M · **Depends on:** 055, 005 · **Labels:** extraction

**Acceptance criteria.**

- [ ] Each extracted value stores: source URL, the locator that produced it, the raw matched text, the transformed value, and a confidence (CRAWL-060).
- [ ] Persisted to `extracted_record`; queryable per run.
- [ ] Failed fields recorded with failure reason for the self-heal queue.

---

# E6 — Grounding, validation & confidence (M1–M2)

### CRAWL-060 — Extractive grounding guard (anti-hallucination)

- **Type:** Feature · **Priority:** P0 · **Size:** M · **Depends on:** 056 · **Labels:** extraction, security

**Context.** The failure mode that separates a toy from a trustworthy tool (design doc §2.3). Every emitted value must be a substring of, or a deterministic transform of, the source DOM. A value that can't be located in the page is dropped or flagged — never silently emitted.

**Acceptance criteria.**

- [ ] For each value, verify provenance: matched text exists in source, or the transform chain maps source→value reproducibly.
- [ ] Values that fail grounding are flagged, not emitted into clean output.
- [ ] Applies to BOTH compile-time data sampling and any LLM-assisted extraction path.
- [ ] Test with a deliberately hallucinating mock LLM response → guard catches it.

### CRAWL-061 — Confidence scoring + review queue + secret redaction in outputs

- **Type:** Feature · **Priority:** P1 · **Size:** M · **Depends on:** 056, 060 · **Labels:** extraction, security

**Context.** Below `confidenceFloor`, route to human review rather than silent output (design doc §2.3). Also: scan outputs so response-body tokens never leak into extracted data/configs (design doc §4.3).

**Acceptance criteria.**

- [ ] Confidence derived from locator rank used + validation strength + grounding result.
- [ ] Records under the floor go to a review queue, not the clean dataset.
- [ ] Output + config scanned for secret patterns (API keys, session tokens); matches redacted + logged.

---

# E7 — Self-heal loop (M2)

### CRAWL-065 — Validation-failure → LLM repair → config patch

- **Type:** Feature · **Priority:** P0 · **Size:** L · **Depends on:** 050, 055, 011 · **Labels:** extraction

**Context.** Phase C (design doc §2.1). When a selector returns null or fails validation on a re-run, re-invoke Claude on _just that page_ using the `semanticAnchor`, regenerate the locator, patch the config, bump the version. This is what "keeps working after redesigns" actually means.

**Acceptance criteria.**

- [ ] A failed field triggers a scoped re-compile for that field only (not the whole page, not the whole site).
- [ ] New locator is validated against the live DOM before being accepted.
- [ ] Successful repair appends the new locator to the ranked list (old ones retained) and bumps config version with reason `self-heal`.
- [ ] Repeated failure after N repair attempts escalates to the review queue, doesn't loop forever.
- [ ] Repair events are logged + counted (feeds cost accounting).

### CRAWL-066 — Self-heal rate limiting & circuit breaker

- **Type:** Feature · **Priority:** P1 · **Size:** S · **Depends on:** 065 · **Labels:** extraction, observability

**Context.** A site-wide redesign could trigger thousands of repair calls and a cost spike. Guard it.

**Acceptance criteria.**

- [ ] Per-run cap on repair LLM calls; exceeding it pauses the run and alerts rather than burning budget.
- [ ] If >X% of pages need repair, flag "likely site-wide redesign — recompile templates" instead of per-field thrashing.

---

# E9 — Crawl orchestration (M1–M2)

### CRAWL-075 — Frontier queue with persistence & resume

- **Type:** Feature · **Priority:** P0 · **Size:** L · **Depends on:** 004, 030 · **Labels:** orchestration

**Context.** A crawler is a control loop, not a for-loop (design doc §3.4). Deep crawls need a persistent, resumable queue (ADR-004).

**Acceptance criteria.**

- [ ] URLs enqueued with depth, source, and dedup key; BullMQ-backed.
- [ ] Crash/restart resumes from the persisted frontier — no re-crawling completed URLs.
- [ ] Bounded by max-pages / max-depth / scope (single page · section · whole site).
- [ ] Job can be paused, resumed, and cancelled.

### CRAWL-076 — URL canonicalization & content-hash dedup

- **Type:** Feature · **Priority:** P0 · **Size:** M · **Depends on:** 075 · **Labels:** orchestration

**Acceptance criteria.**

- [ ] Canonicalize URLs (strip tracking params, normalize trailing slash/case/fragment) before dedup.
- [ ] Content hashing skips mirror/duplicate pages even at different URLs.
- [ ] Configurable param-allowlist (some params are meaningful, e.g. `?page=2`).

### CRAWL-077 — Politeness: per-domain concurrency, adaptive backoff, crawl-delay

- **Type:** Feature · **Priority:** P0 · **Size:** M · **Depends on:** 075, 033 · **Labels:** orchestration, compliance

**Context.** Politeness is both ethics and self-preservation (avoid IP bans) — design doc §3.4. Honor `Crawl-delay` as _intent_ even though it's not in RFC 9309.

**Acceptance criteria.**

- [ ] Per-domain max concurrency + min interval, configurable.
- [ ] Adaptive backoff on 429/503 (exponential, capped); respects `Retry-After`.
- [ ] Applies `Crawl-delay` when present as the minimum interval.
- [ ] Never lets two workers hit the same domain simultaneously beyond the cap.

### CRAWL-078 — robots.txt policy enforcement (respect / warn / ignore)

- **Type:** Feature · **Priority:** P0 · **Size:** S · **Depends on:** 033, 075 · **Labels:** compliance, orchestration

**Context.** Design doc §3.4 + §5: parse correctly, default to **respect**, make "warn" and "ignore" deliberate, logged user actions.

**Acceptance criteria.**

- [ ] Default policy = respect (disallowed paths are skipped).
- [ ] `warn` surfaces disallowed paths but proceeds; `ignore` proceeds silently — both require explicit opt-in and write an `audit_event`.
- [ ] Policy is per-job and visible in the job record.

---

# E10 — Output formats & export (M1)

### CRAWL-080 — Output serializers: JSON, CSV, Markdown

- **Type:** Feature · **Priority:** P0 · **Size:** M · **Depends on:** 056 · **Labels:** api, extraction

**Acceptance criteria.**

- [ ] Serialize a run's records to JSON (nested), CSV (flattened, stable column order), and Markdown (tables / doc-friendly).
- [ ] CSV handles nested/array fields with a documented flattening rule.
- [ ] Large runs stream to the object store rather than building in memory.
- [ ] Output includes a manifest: run id, config version, page count, timestamp, field coverage stats.

### CRAWL-081 — StrategyConfig export/import

- **Type:** Feature · **Priority:** P1 · **Size:** S · **Depends on:** 011 · **Labels:** extraction, api

**Context.** Design doc §8: the config IS the exportable, schedulable asset. Make it portable.

**Acceptance criteria.**

- [ ] Export a config as a standalone, documented JSON file (with schema `$ref` / version).
- [ ] Import validates against the schema and the current app version; clear errors on mismatch.
- [ ] Round-trip export→import reproduces an identical run setup.

---

# E12 — API surface & job lifecycle (M1)

### CRAWL-085 — Crawl job API (create / configure / status / results)

- **Type:** Feature · **Priority:** P0 · **Size:** L · **Depends on:** 005, 052, 075, 080 · **Labels:** api

**Acceptance criteria.**

- [ ] `POST /jobs` (url + goal + optional fields + depth + output format) → job id.
- [ ] `GET /jobs/:id` returns lifecycle state (discovering → awaiting-confirm → crawling → done/failed) + progress (pages done/total, fields coverage).
- [ ] `POST /jobs/:id/confirm-scope` (CRAWL-052).
- [ ] `GET /jobs/:id/results?format=json|csv|md`.
- [ ] All endpoints schema-validated (Fastify JSON Schema); errors are structured.

### CRAWL-086 — Infinite-scroll & pagination traversal (recorded in config)

- **Type:** Feature · **Priority:** P1 · **Size:** M · **Depends on:** 031, 075, 010 · **Labels:** fetch, orchestration

**Context.** Design doc §3.4 + §8. Pagination → encode traversal rule (next-link / numbered / cursor). Infinite scroll → Tier 2 scroll-until-stable. Both replay deterministically from config.

**Acceptance criteria.**

- [ ] Detect and follow pagination (next links, numbered pages, cursor params); cap total pages.
- [ ] Infinite scroll handled via headless scroll-until-stable with a max-iterations guard.
- [ ] The traversal strategy is written into the StrategyConfig so re-runs replay it without re-detecting.

---

# E13 — Scheduling & re-runs (M2)

### CRAWL-090 — Cost & token accounting per run

- **Type:** Feature · **Priority:** P0 · **Size:** M · **Depends on:** 050, 055, 065 · **Labels:** observability

**Context.** Design doc §2.4. We claim 0.03–0.05× cost vs naive — prove it with real numbers, and make scheduling safe by knowing per-run cost.

**Acceptance criteria.**

- [ ] Track per run: LLM calls (compile vs self-heal), tokens in/out, pages fetched per tier, wall-clock.
- [ ] Estimated $ cost surfaced per run and per job-over-time.
- [ ] A dashboard/endpoint shows the compile-vs-execute ratio so the two-phase saving is visible.

### CRAWL-091 — Scheduled re-runs (incremental, config-reuse)

- **Type:** Feature · **Priority:** P1 · **Size:** L · **Depends on:** 081, 065, 090 · **Labels:** orchestration, api

**Context.** Design doc §8: scheduling is only economical _because_ the config already exists. Re-runs reuse the config, self-heal only what broke.

**Acceptance criteria.**

- [ ] Schedule a job (cron-like) to re-run against an existing config version.
- [ ] Incremental mode uses sitemap `lastmod` / content hash to re-crawl only changed pages.
- [ ] Re-run produces a diff vs the previous run (added/removed/changed records).
- [ ] Per-run cost stays near zero on stable sites (validated against CRAWL-090 metrics).

---

# E14 — Anti-bot fetch tiers (M3)

### CRAWL-070 — Tier 1: TLS-impersonating HTTP client

- **Type:** Feature · **Priority:** P1 · **Size:** M · **Depends on:** 030 · **Labels:** fetch

**Context.** Design doc §3.3. A perfect User-Agent doesn't help — JA4+ fingerprints the TLS handshake; `requests`/`undici` are dead on arrival on fingerprinting sites. Need real TLS impersonation (`curl-impersonate` / `got-scraping`).

**Acceptance criteria.**

- [ ] Tier 1 implementation of the `Fetcher` interface using a TLS-impersonating client.
- [ ] Impersonation profile (cipher order, extensions) is internally consistent with the announced browser version.
- [ ] Slots into the fetch ladder above T0, below T2; auto-tier (CRAWL-032) can select it on T0 403/challenge.
- [ ] Documented limits: this is an arms race, not a permanent bypass.

### CRAWL-071 — Challenge/blocker detection (403, JS-challenge, CAPTCHA)

- **Type:** Feature · **Priority:** P1 · **Size:** M · **Depends on:** 030, 031 · **Labels:** fetch, observability

**Acceptance criteria.**

- [ ] Detect and classify anti-bot responses: hard 403, JS interstitial/challenge, CAPTCHA wall, rate-limit.
- [ ] Each classification maps to a ladder action (escalate tier / backoff / stop + flag for human).
- [ ] CAPTCHA walls → stop and escalate to user (Tier 4), never auto-solve.

### CRAWL-072 — Proxy integration (Tier 3, behind a flag)

- **Type:** Feature · **Priority:** P2 · **Size:** M · **Depends on:** 070, 031 · **Labels:** fetch, infra

**Context.** Design doc §3.2 Tier 3. Residential proxies are expensive ($/GB) and only for genuinely hard targets — gate behind explicit config, default off.

**Acceptance criteria.**

- [ ] Pluggable proxy provider interface; session rotation + sticky sessions supported.
- [ ] Off by default; enabling it requires explicit job config and writes an audit event.
- [ ] Bandwidth tracked and attributed to the run cost (CRAWL-090).

### CRAWL-073 — Spike: cooperative-vs-hostile target policy

- **Type:** Spike · **Priority:** P1 · **Size:** S · **Depends on:** — · **Labels:** compliance, fetch

**Context.** Design doc §3.3: the product should target the cooperative-to-neutral web and be honest about hardened targets. We need a written policy on which targets we support and how aggressively.

**Acceptance criteria (deliverable = ADR).**

- [ ] ADR defining tiers of target hostility and what the product will/won't do for each.
- [ ] Recommendation on default behavior when a site clearly doesn't want bots (e.g. block, not just warn).
- [ ] Aligns with the legal posture (E16).

---

# E15 — Auth & secrets (M4 — highest risk, last)

### CRAWL-100 — Spike: choose the secrets model (local-first vs hosted vault)

- **Type:** Spike · **Priority:** P0 · **Size:** M · **Depends on:** 002 · **Labels:** auth, security

**Context.** Design doc §4.2. The current spec's "in-browser only" is both insecure (localStorage/XSS) and broken by CORS (creds must reach the server-side fetcher). Decide Model A (local-first, OS keychain) vs Model B (hosted vault, KMS). This decision gates all of E15.

**Acceptance criteria (deliverable = ADR).**

- [ ] ADR comparing A vs B with threat models, honoring/ breaking the "stays on your machine" promise.
- [ ] A recommendation + the user-facing security claim we can _truthfully_ make.
- [ ] Defines the `SecretsProvider` contract concretely (ties to ADR-008).

### CRAWL-101 — SecretsProvider implementation per chosen model

- **Type:** Feature · **Priority:** P0 · **Size:** L · **Depends on:** 100 · **Labels:** auth, security

**Acceptance criteria.**

- [ ] Store/retrieve/rotate/delete secrets via the interface; scoped per job.
- [ ] Decryption only inside the fetch worker, short-lived, never logged (ties to CRAWL-003 redaction).
- [ ] Secrets referenced by vault key in configs/jobs — never inlined.
- [ ] Penetration test checklist run: no secret in DB plaintext, logs, error messages, or output.

### CRAWL-102 — API-key / header auth (do this BEFORE form login)

- **Type:** Feature · **Priority:** P0 · **Size:** M · **Depends on:** 101, 030 · **Labels:** auth, fetch

**Context.** Design doc §4.3: prefer official APIs / API keys — fewer anti-bot problems, clearer ToS footing. Lowest-risk auth, ship first.

**Acceptance criteria.**

- [ ] Inject API keys / bearer tokens / custom headers from the vault into fetches.
- [ ] Per-target credential binding; never sent to the wrong origin.
- [ ] Auth failures surfaced clearly without leaking the secret.

### CRAWL-103 — Form login + session-cookie injection (Tier 2)

- **Type:** Feature · **Priority:** P1 · **Size:** L · **Depends on:** 101, 031 · **Labels:** auth, fetch

**Context.** Design doc §4.3: real browser performs the login, captured session reused for subsequent fetches; encode the login flow as a replayable script.

**Acceptance criteria.**

- [ ] Headless browser performs a configured login flow; session cookies captured into the vault-scoped session.
- [ ] Subsequent fetches reuse the session until expiry; re-login on expiry.
- [ ] Login flow stored as a replayable script (no plaintext creds in the script).
- [ ] Explicit UI/audit boundary: "this crawl uses authentication" (ties to CRAWL-110).

---

# E16 — Compliance & legal-posture layer (defaults in M1, hardened M4)

### CRAWL-110 — Compliance audit trail + auth-boundary surfacing

- **Type:** Feature · **Priority:** P0 · **Size:** M · **Depends on:** 005, 078 · **Labels:** compliance, security

**Context.** Design doc §5: keep an audit trail (what/when/under what policy); make the "we just logged in → the public-data CFAA defense evaporates" boundary visible, not buried.

**Acceptance criteria.**

- [ ] Every crawl writes audit events: robots policy used, tiers used, whether auth was used, proxy on/off.
- [ ] When a job enables auth or ignore-robots, the API response includes an explicit compliance acknowledgment the caller must accept.
- [ ] Audit log is queryable and tamper-evident (append-only).

### CRAWL-111 — Responsibility disclaimer + robots-warning surfacing

- **Type:** Feature · **Priority:** P1 · **Size:** S · **Depends on:** 033, 110 · **Labels:** compliance, ux

**Context.** Spec §2/§3 + the draft disclaimer. Surface robots `Disallow` hits and ToS responsibility at setup; do not help defeat access controls.

**Acceptance criteria.**

- [ ] Setup flow surfaces relevant robots `Disallow` rules for the crawl path as a warning.
- [ ] The responsibility disclaimer (CFAA/GDPR/ToS) is shown and acknowledgment recorded.
- [ ] No feature assists bypassing an authentication/access-control wall (hard product line, enforced in code review).

---

# E17 — Observability, ops & cost (cross-cutting)

### CRAWL-120 — Run dashboard / metrics endpoint

- **Type:** Feature · **Priority:** P1 · **Size:** M · **Depends on:** 003, 090 · **Labels:** observability

**Acceptance criteria.**

- [ ] Metrics: pages/sec, tier distribution, extraction field-coverage %, self-heal rate, cost per run, error classes.
- [ ] Per-job and aggregate views.
- [ ] Alerting hooks for: cost-spike, self-heal storm (CRAWL-066), block-rate spike.

### CRAWL-121 — End-to-end smoke test against fixture sites

- **Type:** Feature · **Priority:** P0 · **Size:** M · **Depends on:** 085, 055, 080 · **Labels:** observability, infra

**Context.** Lock in the M1 wedge with a real e2e: discover → compile → confirm → execute → output, against a controlled fixture site (self-hosted, so tests are deterministic and we don't hammer third parties).

**Acceptance criteria.**

- [ ] A self-hosted fixture docs/pricing site lives in the repo (static + a JS-rendered variant).
- [ ] An e2e test runs the full pipeline against it and asserts on extracted output + config shape.
- [ ] Runs in CI without external network dependence.

---

## Suggested execution order (critical path to the M1 demo)

The fastest route to a demoable wedge (docs extractor, no auth):

`001 → 003 → 004 → 005` (foundation) →
`010 → 012 → 013` (config + safety) →
`020 → 021` (DOM) →
`030 → 031 → 032 → 033` (fetch + robots) →
`040 → 041` (discovery) →
`050a/b/c → 051 → 052` (compile + preview) →
`055 → 056 → 060` (execute + grounding) →
`075 → 076 → 077 → 078` (orchestration) →
`080 → 085` (output + API) →
`121` (e2e smoke).

Everything in E7 (self-heal), E13 (scheduling), E14 (anti-bot), E15 (auth), and the harder parts of E16 comes _after_ the wedge proves the core IP. **Resist pulling auth (E15) forward** — it's the highest-risk work on every axis (CORS, secrets, legal) and the design doc is explicit that it ships last.

---

## Open product decisions to resolve before/while building (owner: you)

- **Secrets model A vs B** (CRAWL-100) — blocks all auth work; decide by end of M2.
- **Hosted vs local-first product shape** — flows from the secrets decision and shapes the fetch deployment model.
- **Target-hostility policy** (CRAWL-073) — how aggressive will we get, and where's the hard "no"?
- **Docs-only vs general from launch** — recommendation stands: docs-only wedge, generalize in M3.
