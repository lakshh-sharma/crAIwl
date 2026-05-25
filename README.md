# crAIwl

A crawler that treats an LLM like a compiler instead of a runtime.

The usual approach to "AI scraping" is to call a model on every page. That's slow, expensive, and weirdly fragile — you're paying for tokens on page #50,000 to do the same job the model already figured out on page #1. crAIwl looks at a page **once**, has the LLM write a tiny extraction program for it (ranked CSS/XPath selectors, type conversions, validation rules), and then runs that program against every other page on the site at ~50ms apiece. No tokens. No model in the hot path.

When a site redesigns and a selector breaks, the validator catches the bad value and asks the model to fix _that one field on that one page_. The fix gets versioned into the program and the crawl keeps going. The program is the thing — it's small, diffable, exportable, and gets sturdier over time (broken locators get replaced; the old ones stay in the ranked list as fallbacks).

## The shape of it

There are three phases, and only two of them touch the model:

- **Compile** — read one page, output the extraction program.
- **Execute** — run the program against every other page, deterministically.
- **Self-heal** — when a field breaks, re-compile just that field, just on the page where it broke, and patch the program.

That's pretty much the entire pitch. Everything else — the fetch ladder, the queue, the orchestration, the safety stuff — exists to make those three things actually work at scale.

## Fetching has gotten harder

You can't just send a request with a fake User-Agent anymore. Modern bot detection fingerprints the TLS handshake (JA4) before your HTTP request is even parsed. So crAIwl has a ladder:

1. Plain HTTP via `undici` — fast, free, works for most docs and APIs.
2. TLS-impersonating HTTP (`curl-impersonate` / `got-scraping`) — matches a real browser's handshake.
3. Headless browser via Playwright — for SPAs, JS-rendered content, infinite scroll.
4. Proxy + headless — for genuinely hostile targets, off by default.

Whichever tier ends up working gets pinned to the page's profile, so re-runs skip the ladder.

## The things it deliberately doesn't do

- **It doesn't hallucinate.** Every emitted value has to come from the source DOM — either as a substring or as a deterministic transform of one. If it can't be located, it doesn't get emitted.
- **It doesn't break auth walls.** Login flows are there for accounts you own. Defeating someone else's access controls isn't a feature and won't become one.
- **It doesn't ignore robots by default.** You can opt in to `warn` or `ignore` if you have a reason, but the choice ends up in the audit log.
- **It doesn't leak secrets.** Credential patterns get stripped from logs before they're written. If a session token sneaks into an extracted value, it gets scrubbed there too.

## Stack

TypeScript / Node 20+ in a pnpm workspace. Fastify for the API, Postgres + Drizzle for state, Redis + BullMQ for the frontier queue, MinIO/S3 for raw page snapshots. Playwright for headless. Readability + Turndown for cleaning pages before the compile step sees them. Anthropic's Claude API with structured outputs for the LLM phases. pino + OpenTelemetry from day one because debugging a distributed crawler without traces is awful.

Design decisions are written down in [`docs/adr/`](./docs/adr/). The longer technical design is in [`crAIwl-technical-design.md`](./crAIwl-technical-design.md).

## Running it

```bash
nvm use                                                # Node 20+
corepack enable && corepack prepare pnpm@9.15.0 --activate
pnpm install
cp .env.example .env
pnpm dev:up                                            # Postgres + Redis + MinIO
pnpm build && pnpm test
```

|                                          |                              |
| ---------------------------------------- | ---------------------------- |
| `pnpm build` · `pnpm test` · `pnpm lint` | the usual                    |
| `pnpm dev:up` / `dev:down` / `dev:reset` | local services               |
| `pnpm --filter @craiwl/core db:generate` | generate a Drizzle migration |

```
packages/
  core/          shared types, logging, tracing, db
  fetcher/       fetch ladder
  extractor/     compile + execute + self-heal
  orchestrator/  frontier queue, politeness, robots, dedup
  api/           Fastify HTTP surface
  cli/           local CLI
```

## Status

Early. The foundation (workspace, logging, tracing, db schema, ADRs) is in. Next up is the actual interesting part — the StrategyConfig type and the compile/execute/self-heal loop.
