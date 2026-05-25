# crAIwl

A web crawler that uses an LLM as a **compiler**, not a runtime.

Most "AI-powered" scrapers call a model on every single page. That's expensive, slow, and unreliable — you pay tokens forever and you're at the mercy of the model's mood. crAIwl flips the relationship: the LLM looks at a page **once** to produce a small, durable extraction program (ranked CSS/XPath locators, type coercions, validation rules, semantic anchors). After that, every page in the crawl runs through a plain deterministic executor at ~50ms apiece. Zero tokens per page.

When a site redesigns and a selector breaks, the validator catches the bad value and triggers a scoped repair — _that one field_, on _that one page_. The fix lands as a new version of the extraction program. The crawl keeps working.

## Why this matters

- **Cost.** Naive LLM scraping is roughly 30× more expensive than crAIwl on a stable site. Tokens are the dominant cost — we spend them once per page template, not once per page.
- **Trust.** Every emitted value is grounded: it has to be a substring of (or a deterministic transform of) the source DOM. The LLM cannot quietly hallucinate a field that doesn't exist.
- **Resilience.** Selectors break. Sites redesign. crAIwl notices, repairs, versions, and moves on — without a human in the loop, but with a clean audit trail when you want to look.
- **Re-runs are basically free.** The compiled extraction program is the durable asset. Schedule a re-crawl and there are usually zero LLM calls.

## The brain

Three phases sit on top of a server-side fetch stack:

| Phase         | What it does                                                                                                                        | LLM?                        |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| **Compile**   | Reads one cleaned page, emits a `StrategyConfig` — ranked locators, semantic anchors, validation rules, transforms, per-field types | Yes, once per template      |
| **Execute**   | Runs the config against every other page deterministically                                                                          | No                          |
| **Self-heal** | Validation failure → re-compile that one field on that one page → patch the config, bump version                                    | Yes, bounded + rate-limited |

The `StrategyConfig` is the thing that matters. It's versioned, diffable, exportable, schedulable. When a locator breaks and self-heal writes a new one, the old locators stay in the ranked list — selectors get more resilient over time, not less.

## Fetching

User-Agent is a relic. Modern anti-bot infrastructure fingerprints the TLS handshake (JA4) before your HTTP request even arrives. crAIwl uses a ladder, escalating only when needed:

1. **Plain HTTP** (`undici`) — fastest, cheapest, works for docs and APIs.
2. **TLS-impersonating HTTP** (`curl-impersonate` / `got-scraping`) — matches a real browser's handshake fingerprint.
3. **Headless browser** (Playwright, swappable with hosted providers) — SPAs, JS-rendered content, infinite scroll.
4. **Proxy + headless** — hostile targets, gated behind explicit opt-in.

The winning tier is recorded in the page's `fetchProfile` so re-runs skip the ladder entirely.

## Grounding & the things it won't do

- **No silent hallucinations.** Values that can't be located in the source DOM are flagged, never emitted into the clean dataset.
- **No bypassing auth walls.** Login flows are supported for accounts you own. Defeating other people's access controls is not a feature.
- **Respects robots by default.** Policy is `respect` unless you opt in to `warn` or `ignore`, and either choice is written to the audit log.
- **No credential leakage.** Secret-pattern redaction is wired into the logger from day one; secrets in `StrategyConfig` outputs are scrubbed before persistence.

## Stack

TypeScript, Node 20+, pnpm workspaces · Fastify · Postgres + Drizzle · Redis (BullMQ frontier queue) · S3/MinIO for blobs · Playwright · `undici` · Readability + Turndown for DOM cleaning · Anthropic Claude API with structured outputs for compile/self-heal · pino + OpenTelemetry from day one — a distributed crawler you can't trace is one you can't debug.

Architecture decisions are in [`docs/adr/`](./docs/adr/). The technical design doc is [`crAIwl-technical-design.md`](./crAIwl-technical-design.md).

## Running it

```bash
nvm use                                                # Node 20+
corepack enable && corepack prepare pnpm@9.15.0 --activate
pnpm install
cp .env.example .env
pnpm dev:up                                            # Postgres + Redis + MinIO
pnpm build && pnpm test
```

Day-to-day:

|                                          |                                                   |
| ---------------------------------------- | ------------------------------------------------- |
| `pnpm build` · `pnpm test` · `pnpm lint` | the usual                                         |
| `pnpm dev:up` / `dev:down` / `dev:reset` | local services via docker-compose                 |
| `pnpm --filter @craiwl/core db:generate` | generate a Drizzle migration from a schema change |

## Layout

```
packages/
  core/          shared types, logging, tracing, db schema + migrations
  fetcher/       fetch ladder
  extractor/     compile + execute + self-heal
  orchestrator/  frontier queue, politeness, robots, dedup
  api/           Fastify HTTP surface
  cli/           local CLI
```
