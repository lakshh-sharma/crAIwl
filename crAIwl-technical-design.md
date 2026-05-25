# crAIwl — Technical Design Doc

**Status:** Draft for review · **Author:** Engineering · **Last updated:** May 2026
**Scope of this doc:** Architecture & extraction engine, anti-bot & fetching infrastructure, auth & secrets security. Compliance covered briefly where it constrains engineering. Posture: this is a _critical_ review — the current spec's three load-bearing assumptions are challenged directly, and a target architecture is proposed alongside a pragmatic preview build.

---

## 0. TL;DR — the verdict

The product _idea_ is right and the market agrees with it: intent-based extraction with a reusable, self-healing strategy config is exactly where the industry moved in 2025–26 (Firecrawl, Kadoa, ScrapeGraphAI, Crawl4AI all converge here). The McGill 2025 study found AI extraction held **98.4% accuracy across layout changes** and cut maintenance **~70%** versus selector-based scrapers. That part of the spec is defensible and worth building.

But three architectural commitments in the current spec are wrong and will not survive contact with real websites:

1. **"Page fetching: Claude API with `web_search` tool."** `web_search` is a _search/answer_ tool, not a programmable fetcher. It does not give you the raw, authenticated, JS-rendered DOM you need to extract structured data reliably or repeatably. Fetching is the hard 80% of crawling and the spec hand-waves it.

2. **"In-browser only, credentials never leave client" + artifact-based execution.** A browser tab _cannot_ fetch arbitrary cross-origin pages — CORS blocks reading the response by design. So the one place the spec puts the fetcher is the one place fetching is prohibited. "In-browser only" isn't a security feature here; it's a functionality wall.

3. **"Semantic extraction via Claude, not CSS selectors" as the runtime.** Running an LLM over full HTML _on every page of every re-run_ is the expensive, slow, non-deterministic way to do this. The whole point of the "reusable strategy config" — which the spec lists as a core principle but never operationalizes — is to use the **LLM as a compiler, not as the runtime.** Generate selectors/extractors once, execute them deterministically and cheaply forever after, and only re-invoke the LLM when extraction _fails validation_.

The fix for all three is the same move: **separate the control plane (Claude, reasoning, one-time) from the data plane (fetching + extraction execution, server-side, repeated).** The rest of this doc builds that out.

---

## 1. Reframing the problem

A crawler is three hard problems stacked, in increasing order of difficulty:

| Problem                                                                   | Difficulty | Where the spec spends words | Where the difficulty actually is           |
| ------------------------------------------------------------------------- | ---------- | --------------------------- | ------------------------------------------ |
| **Extract** structured data from a page you already have                  | Medium     | ~60%                        | The easy part — LLMs genuinely solved this |
| **Fetch** the page at all (JS, anti-bot, auth, rate limits)               | Hard       | ~15%                        | The real engineering                       |
| **Orchestrate** a polite, resumable, deduplicated crawl across many pages | Hard       | ~10%                        | Where shallow demos die in production      |

The spec is inverted: it lavishes detail on the solved problem (extraction) and waves at the two genuinely hard ones (fetching, orchestration). A reviewer who knows the domain will notice this immediately. This doc rebalances toward fetching and orchestration, because _that_ is what makes a crawler look like it was built by someone who has actually shipped one.

The single most important design principle, stated once so the rest follows from it:

> **The LLM is a compiler that emits a reusable, deterministic extraction program. It is not the runtime that processes every page.**

Everything below — cost, latency, reliability, self-healing, the strategy config — falls out of taking that seriously.

---

## 2. Extraction engine (the core IP)

### 2.1 The two-phase model: compile, then execute

Naive LLM scraping sends every page's HTML to a model and asks for JSON. It works in a demo and is indefensible in production: it is slow (seconds/page), expensive (full-page tokens × every page × every re-run), and non-deterministic (the same page can yield different output). The industry-standard fix — and what crAIwl's "reusable strategy config" _should_ mean — is a hybrid auto-repair pipeline:

**Phase A — Compile (LLM, once per site/template, expensive):**
On the first crawl of a page _template_, Claude is given the cleaned DOM plus the natural-language goal and the field schema. It does not just return the data — it returns the **extraction program**: for each field, a robust locator (a ranked list of CSS/XPath candidates, plus a semantic anchor like nearby text/labels), a type, a transform, and a validation rule. This is the strategy config.

**Phase B — Execute (deterministic, every page, ~free):**
The strategy config runs against every page with a plain parser (no LLM call). Selectors that resolve and pass validation cost zero tokens. Published numbers on this hybrid pattern: **80–95% cost reduction**, LLM usage cut **80–90%** on semi-structured sites, because the model only runs on the _first_ instance of each template and on _repairs_.

**Phase C — Self-heal (LLM, only on failure):**
On a re-run, if a selector returns null or its value fails validation (wrong type, empty, out-of-range), that's the trigger to re-invoke Claude on _just that page_ to regenerate the locator, then patch the config and continue. This is what "keeps working when sites restructure" actually requires — not "the LLM looks at every page every time," but "the LLM is the repair mechanism the deterministic path falls back to."

```
                 ┌─────────────────────────────────────────────┐
   first page    │  COMPILE (Claude)                            │
   of template ─►│  DOM + goal + schema → extraction program    │
                 └───────────────────┬─────────────────────────┘
                                     │ emits / patches
                                     ▼
   every page  ─►  EXECUTE (deterministic parser, 0 tokens)
                                     │
                          pass? ─────┼───── yes ─► structured row
                                     │ no (null / validation fail)
                                     ▼
                 ┌─────────────────────────────────────────────┐
   one page    │  SELF-HEAL (Claude) regenerate locator,       │
   that broke ─►│  patch config, bump strategy version          │
                 └─────────────────────────────────────────────┘
```

This also resolves the spec's unstated tension. The spec says "intent-based, not brittle CSS selectors" _and_ "outputs a reusable crawl strategy config." Those are only compatible if the config **contains** selectors that the LLM authored and maintains. The selectors aren't the enemy — _hand-written, unmaintained_ selectors are. crAIwl's pitch is "AI writes and repairs the selectors for you," not "there are no selectors."

### 2.2 The strategy config — make it a real, versioned artifact

The spec mentions this as a JSON config but never specifies it. It is the product's crown jewel (it's what makes re-runs cheap and what could be exported/scheduled), so it deserves a real schema. Sketch:

```jsonc
{
  "strategyVersion": "1.4.0",
  "createdBy": "claude-opus-4-6",
  "target": { "entryUrl": "https://example.com/pricing", "scope": "section" },
  "goal": "Extract all pricing tiers with price, billing period, and features",
  "pageTemplates": [
    {
      "id": "pricing-card",
      "matchHeuristic": "div[data-testid='tier'] | section.pricing .card",
      "fields": {
        "tierName": {
          "locators": ["h3.tier-name", "[data-tier] h3", "xpath://h3[1]"],
          "semanticAnchor": "heading of the pricing card",
          "type": "string",
          "validate": "len>0 && len<60",
          "required": true,
        },
        "priceMonthly": {
          "locators": [".price .amount", "span[itemprop='price']"],
          "semanticAnchor": "the dollar figure shown largest in the card",
          "type": "number",
          "transform": "stripCurrency|toFloat",
          "validate": "value>=0 && value<100000",
          "required": true,
        },
      },
    },
  ],
  "pagination": { "type": "none" },
  "fetchProfile": "static", // static | impersonate | headless
  "confidenceFloor": 0.8, // below this, escalate to human review
  "lastValidated": "2026-05-24T00:00:00Z",
}
```

Design notes that signal maturity:

- **Multiple locators per field, ranked.** Execution tries them in order; the first that resolves and validates wins. This _is_ resilience — one selector breaking doesn't break the field.
- **`semanticAnchor`** is the natural-language description Claude uses during self-heal to regenerate a locator. It's the bridge between "intent" and "selector."
- **`validate` per field** is non-negotiable. It is both the quality gate _and_ the self-heal trigger. Without per-field validation you cannot distinguish "the site changed" from "this page legitimately has no price," and you cannot detect silent extraction drift.
- **Versioned + `lastValidated`.** Configs are code. They should diff, roll back, and carry provenance (which model authored them). Self-heal bumps the version and records what changed.
- **`fetchProfile`** binds extraction to a fetch tier (see §3), because the config is useless if you can't reliably get the page it targets.

### 2.3 Grounding: do not let the extractor hallucinate

This is the failure mode that separates a toy from something you'd trust with a knowledge base. LLMs asked for JSON will _invent_ plausible values for fields that aren't on the page. For a crawler feeding a knowledge base, a confidently fabricated price or API endpoint is worse than a missing one. Mitigations, layered:

- **Structured Outputs / constrained decoding.** Use the API's JSON-schema-enforced output mode so the model can't emit malformed or off-schema data. This is table stakes in 2026.
- **Extractive grounding, not generative.** Prompt and verify that every emitted value is a _substring of, or deterministic transform of, the source DOM._ If a returned value can't be located in the page text, drop it or flag it. This is cheap and kills most fabrication.
- **Confidence + provenance per field.** Store, alongside each value, the locator that produced it and a confidence score. Anything under `confidenceFloor` goes to a review queue rather than silently into output.
- **Schema as contract, but expect ambiguity.** Recent work (PARSE, 2025) shows static schemas with vague field specs cause hallucination; the `semanticAnchor` + examples in the config exist precisely to disambiguate fields like "price" (which one — monthly, annual, struck-through?).

### 2.4 Cost & latency model (put numbers on it)

A CTO will ask "what does a 10k-page crawl cost and how long does it take?" The two-phase model is the answer:

| Approach                                | LLM calls for 10k-page site (50 templates) | Relative $     | Latency/page       |
| --------------------------------------- | ------------------------------------------ | -------------- | ------------------ |
| Naive (LLM every page, every run)       | 10,000 / run                               | 1.0×           | 2–6 s              |
| Two-phase compile+execute (this design) | ~50 compile + ~200 repairs                 | **0.03–0.05×** | 50–200 ms (parser) |

The savings compound on re-runs: a scheduled weekly re-crawl of a stable site costs _almost nothing_ because the config already exists and few selectors break. This is also the honest answer to the spec's "Future: run headlessly / on a schedule" open question — scheduling is only economical _because_ of the compiled config.

---

## 3. Fetching & anti-bot infrastructure (the part the spec under-weights)

### 3.1 Kill the two false premises first

**`web_search` is not a fetcher.** It returns search results and synthesized answers, not the raw DOM of an arbitrary URL on demand, not authenticated pages, not JS-rendered state, and not in a form you can run deterministic extractors against repeatably. Building a crawler's fetch layer on `web_search` is like building a database on top of a search engine's snippets. You need a real fetch stack.

**A browser tab cannot scrape arbitrary sites — CORS forbids it.** This is the single most important technical correction in this doc. The browser's same-origin policy means JavaScript on `crAIwl.app` issuing `fetch("https://target.com/page")` will _send_ the request but the browser **refuses to hand the response back to your script** unless `target.com` returns `Access-Control-Allow-Origin` permitting your origin — which no scraping target ever will. CORS is a browser-only mechanism; it does not apply to server-side HTTP clients. Therefore:

> The fetcher **must** live server-side (or in a server-controlled headless browser). There is no client-only architecture that can crawl third-party sites. The "in-browser only" framing in the spec is not viable for fetching; it can only apply narrowly to _credential storage_ (and even that is questionable — see §4).

The spec half-admits this in Limitations ("login form submission may hit CORS restrictions") but treats it as an edge case. It is the central constraint, not an edge case.

### 3.2 The fetch ladder — tiered, cheapest-first

Real crawlers don't have "a fetcher." They have a ladder of fetch strategies, escalating only when cheaper tiers fail. This is the infrastructure the spec is missing entirely:

| Tier | Method                                                        | Handles                                             | Cost             | When to use                   |
| ---- | ------------------------------------------------------------- | --------------------------------------------------- | ---------------- | ----------------------------- |
| 0    | Plain HTTP (server-side)                                      | Static HTML, sitemaps, robots.txt                   | ~free            | Default; try first            |
| 1    | TLS-impersonating client (`curl-impersonate`, `got-scraping`) | Sites that fingerprint the TLS handshake (see §3.3) | low              | Tier 0 gets 403               |
| 2    | Headless browser (Playwright)                                 | JS-rendered SPAs, client-side data, infinite scroll | medium (CPU/RAM) | Content missing from raw HTML |
| 3    | Headless + residential proxy + stealth                        | Cloudflare/DataDome-protected sites                 | high ($/GB)      | Tier 1–2 blocked              |
| 4    | Human-in-loop / give up                                       | CAPTCHA walls, login-gated, hostile ToS             | —                | Escalate or stop              |

The `fetchProfile` in the strategy config records which tier a given target needs, so re-runs skip straight to the working tier. Auto-detecting the right tier (does raw HTML contain the data? did we get a 403? is there a JS challenge?) is itself a small decision engine and is worth building well.

### 3.3 Anti-bot reality in 2026 — set expectations honestly

The spec's Limitations section says "cannot bypass... JS-heavy SPAs without a backend." True, but it understates the broader hostility of the modern web:

- **TLS fingerprinting is now JA4+**, standard at Cloudflare/AWS/VirusTotal. A Python `requests` call with a perfect Chrome User-Agent is still **dead on arrival** because its TLS ClientHello betrays `urllib3`. Cloudflare flags "impossible" combinations (Chrome 144 headers + a TLS stack that couldn't be Chrome). Defeating this needs TLS-level impersonation (Tier 1), not header spoofing.
- **Behavioral + ML detection.** Beyond fingerprints, providers score inter-request timing, mouse/scroll patterns, and IP reputation. This is an arms race with no permanent win.
- **Implication for product scope:** crAIwl should explicitly target the **cooperative-to-neutral** web — docs sites, public pricing/listings, sites without aggressive bot management — and be honest that hardened targets (LinkedIn, major retail, ticketing) require Tier 3 infra and carry the most legal risk. Promising "works on any site" is a promise the product cannot keep and shouldn't make.

### 3.4 Crawl orchestration — the other thing demos skip

Extraction gets you one page. A _crawler_ needs a control loop the spec doesn't describe:

- **Frontier queue** with dedup (URL canonicalization + content hashing to skip mirror/duplicate pages). Deep crawls (the spec's "100+ pages") need a real queue with persistence and resume-on-failure — the spec correctly notes this needs a backend; that backend is not optional, it's core.
- **Politeness / rate limiting.** Per-domain concurrency caps, adaptive backoff on 429/503, and honoring `Crawl-delay` _as intent_. Note: `Crawl-delay` is **not** in RFC 9309 and Googlebot ignores it — but a well-behaved crawler treats it as a signal the site is request-sensitive. Politeness is also your best defense against getting your IPs banned.
- **robots.txt done right.** RFC 9309 is the standard (since 2022). The spec's "surface as a warning, don't enforce" stance is a legitimate _product_ choice, but engineering should still parse robots.txt correctly per RFC and make "respect / warn / ignore" a configurable policy with a safe default of **respect**. "We parse the standard correctly and default to obeying it" is a far more defensible posture than "we warn you and shrug."
- **Pagination & infinite scroll** (an open question in the spec): pagination is a strategy-config concern — detect `next` links / numbered pages / cursor params and encode the traversal rule. Infinite scroll requires Tier 2 (headless) with scripted scroll-until-stable. Both should be captured in the config so re-runs replay them deterministically.

---

## 4. Auth & secrets security

### 4.1 "In-browser only, never leaves the client" — threat-model it honestly

The spec presents in-browser credential storage as a _security guarantee_. Under a real threat model it is closer to the opposite. The relevant facts:

- **`localStorage`/`sessionStorage` have no encryption, no expiry, and are fully readable by any JavaScript on the origin.** A single XSS bug — or a compromised npm dependency in the app's own bundle — reads every stored credential instantly. There is no browser-enforced protection against script-based theft, unlike `HttpOnly` cookies.
- **Browser extensions and a shared-origin subdomain XSS** can both reach that storage. The attack surface is the entire client-side bundle and everything it loads.
- So "credentials never leave the client" is true and yet **not reassuring**: the client is a _less_ controlled environment than a hardened server vault, not a more controlled one. The phrase markets a security property the architecture doesn't actually deliver.

And there's the functional contradiction from §3.1: the credentials need to be _used_ to fetch authenticated pages, and fetching must happen server-side because of CORS. So the credentials have to reach the fetcher regardless. "Never leaves the client" and "logs into the target site for you" cannot both be true.

### 4.2 What a defensible secrets design looks like

Pick one of two honest models and state it plainly to the user:

**Model A — Local-first, self-hosted (true "stays on your machine").**
The fetcher runs on the _user's own_ machine/server (a local daemon or self-hosted container, the Steel-style open-source pattern). Credentials live in the OS keychain (Keychain/DPAPI/libsecret), never in `localStorage`, and never transit to any server crAIwl operates. This genuinely honors the privacy promise — but it means crAIwl is a local tool or BYO-infra, not a hosted web app.

**Model B — Hosted, with a real secrets vault.**
Credentials are encrypted client-side, sent over TLS, and stored in a managed secrets manager (Vault / AWS Secrets Manager / KMS-wrapped envelope encryption) with short-lived decryption only inside the fetch worker, scoped per-job, audit-logged, and auto-expired. This is the standard server-side model. It does _not_ claim "never leaves your device," but it is genuinely more secure than `localStorage`.

The current spec sits in the worst middle ground: client storage (weak) + a promise of locality that the CORS reality breaks. Choose A or B.

### 4.3 Auth mechanics

- **Prefer official APIs / API keys over form login** wherever the target offers them — fewer anti-bot problems, clearer ToS footing, more stable.
- **Form login + session-cookie injection** is the general fallback and belongs in a Tier-2 headless context (real browser performs the login, captured cookies/session reused for subsequent fetches). Encode the login flow as a replayable script in the strategy config.
- **Never log or persist raw credentials in crawl artifacts, logs, or the strategy config.** Reference them by vault key only.
- **Secret scanning on outputs** — make sure extracted data and saved configs don't accidentally capture session tokens from response bodies.

---

## 5. Compliance posture (brief — it constrains engineering)

Engineering can't ignore this because it dictates defaults and features. Quick grounding:

- **Public data scraping is _likely_ not a CFAA violation** (_hiQ v. LinkedIn_, 9th Cir., reinforced by _Van Buren_): no auth required → no "access without authorization." **But** the hiQ saga ended with hiQ paying $500k and deleting everything — because once you use fake accounts or bypass a login, you're in "authorization required" territory, and CFAA isn't the only theory (breach of contract / ToS, copyright, trespass to chattels, GDPR all remain live).
- **Engineering implications:**
  - The _moment_ crAIwl logs in with credentials (its headline auth feature), the comfortable "public data" defense evaporates for that crawl. The UI should make that boundary visible, not bury it.
  - Default to **respecting** robots.txt; make ignoring it a deliberate, logged user action.
  - Keep an audit trail (what was crawled, when, under what policy) — it's both an ops tool and legal hygiene.
  - The draft disclaimer is reasonable but "surfaces but does not enforce" should not extend to _helping_ defeat access controls; that's the line between a research tool and a liability.

---

## 6. Recommended architecture

### 6.1 Target architecture (the serious build)

```
┌────────────────────────────────────────────────────────────────────┐
│  CONTROL PLANE  (Claude / reasoning — one-time & on-failure)         │
│   • Goal → field schema inference                                    │
│   • Discovery: sitemap / nav / "is this docs?" semantic eval         │
│   • COMPILE strategy config (locators + validation + anchors)        │
│   • SELF-HEAL on validation failure                                  │
└───────────────┬──────────────────────────────────────────────────────┘
                │ emits versioned Strategy Config (the durable asset)
                ▼
┌────────────────────────────────────────────────────────────────────┐
│  DATA PLANE  (server-side, repeated, deterministic, cheap)           │
│                                                                      │
│   Frontier Queue ─► Fetch Ladder (T0 HTTP→T1 impersonate→           │
│        │             T2 headless→T3 +residential proxy)              │
│        │                   │                                         │
│        │ robots/politeness │ rendered DOM                            │
│        ▼                   ▼                                         │
│   Dedup/canon.       Deterministic Extractor (runs config, 0 tokens) │
│                            │ validate per field                      │
│                            ├─ pass ─► Output (JSON/CSV/MD) + store    │
│                            └─ fail ─► escalate to Control Plane       │
│                                                                      │
│   Secrets Vault (KMS/keychain) ── scoped, short-lived ──► Fetch      │
└────────────────────────────────────────────────────────────────────┘
```

The durable, valuable asset that crosses the boundary is the **strategy config**. The LLM produces and repairs it; the cheap deterministic data plane executes it at scale. This is the architecture that makes scheduling, re-runs, and "keeps working after redesigns" economically and technically real.

### 6.2 Build-vs-buy

Don't build the hard infra from scratch for a preview. The fetch/headless/proxy layer is a solved, commoditized problem:

| Component                     | Buy / use                                                | Why                                                                          |
| ----------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Headless browser fleet        | Browserbase / **Steel.dev** (open-source, self-hostable) | "AWS for headless browsers"; Steel is OSS so it fits a local-first model too |
| Residential proxies           | Bright Data / Oxylabs / Zenrows                          | Only when Tier 3 is genuinely needed; $/GB, use sparingly                    |
| TLS impersonation             | `curl-impersonate`, `got-scraping`                       | Tier 1, cheap, defeats JA4 for many sites                                    |
| LLM extraction/compile        | Claude API + Structured Outputs                          | The control plane                                                            |
| Markdown/clean-DOM conversion | Readability-style + Firecrawl-style cleanup              | Shrinks tokens before compile                                                |

Build in-house only the **differentiated** parts: the compile/self-heal loop, the strategy-config schema and versioning, the validation/confidence layer, and the discovery UX.

### 6.3 Pragmatic preview build (fits the research-preview constraint)

If the near-term reality is "ship something inside the current product surface," the honest minimal-viable shape:

- **Fetch:** server-side HTTP (Tier 0) + one headless tier via a hosted browser API. Skip proxies/Tier 3 initially; scope to cooperative sites.
- **Extraction:** full two-phase from day one — even at small scale, compile+execute is what makes it _feel_ fast and cheap and produces the exportable config that is the product's differentiator.
- **Auth:** ship **read-only / no-login** first. Auth is the highest-risk, highest-complexity feature (CORS, secrets, legal). Defer it until the vault model (§4.2) is chosen. A no-auth docs/pricing extractor is a genuinely useful, defensible v1.
- **Scope:** lean into the spec's first open question — **pick docs extraction as the wedge.** It's the friendliest target (static-ish, public, structured, robots-permissive), it makes the discovery feature (sitemap → /docs → nav parsing → "is this docs?") shine, and it sidesteps the legal/anti-bot minefield of pricing/jobs/product scraping. Generalize later.

---

## 7. Phased roadmap

**Phase 1 — Docs extractor, no auth (wedge).** Tier 0/2 fetch, two-phase compile+execute, strategy-config export, robots.txt respected by default, JSON/MD output. Target: public docs/API-reference sites. This validates the core IP with the least risk.

**Phase 2 — Self-heal + scheduling.** Validation-triggered repair loop, config versioning/diffing, headless re-runs on a schedule (now economical because configs are compiled). Add CSV + structured-output grounding/confidence scoring.

**Phase 3 — Fetch ladder + general targets.** Tier 1 impersonation, auto-tier detection, proxy integration behind a flag, pagination/infinite-scroll handling. Expand beyond docs to pricing/listings on cooperative sites.

**Phase 4 — Auth (highest risk, last).** Choose vault model A or B, ship API-key auth first, then form-login via headless session injection. Gate behind explicit ToS/compliance acknowledgment.

---

## 8. Answers to the spec's open questions

- **Docs vs. general purpose?** Start docs-only as the wedge (§6.3); architect the strategy config to generalize. Docs minimizes legal/anti-bot risk and maximizes the discovery feature's value.
- **Exportable / headless / scheduled config?** Yes — this is the whole point of the two-phase model. The config _is_ the export, and scheduling is only economical because of it. Make it a first-class, versioned artifact.
- **Test-crawl / single-page preview?** Essential, not optional. The compile phase naturally produces a single-page preview: run compile on one page, show the user the extracted fields + the proposed config, let them correct field mappings _before_ committing tokens/time to the full crawl. This doubles as the human-in-loop correction signal that improves the config.
- **Pagination / infinite scroll?** Pagination → encode traversal rule in config (next-link / numbered / cursor). Infinite scroll → Tier 2 headless, scroll-until-stable, recorded in config for deterministic replay (§3.4).

---

## 9. Risk register

| Risk                                                | Severity    | Mitigation                                                              |
| --------------------------------------------------- | ----------- | ----------------------------------------------------------------------- |
| CORS makes client-only fetch impossible             | **Blocker** | Server-side / self-hosted fetcher; abandon "in-browser fetch"           |
| `web_search` can't serve as fetcher                 | **Blocker** | Real fetch ladder (§3.2)                                                |
| Anti-bot (JA4/Cloudflare) blocks crawls             | High        | Tier the fetcher; scope to cooperative sites; be honest about limits    |
| LLM extraction hallucinates values                  | High        | Extractive grounding + per-field validation + confidence floor (§2.3)   |
| `localStorage` credential theft via XSS             | High        | Vault model A or B (§4.2); never client-side plaintext secrets          |
| Auth crawls forfeit the "public data" legal defense | High        | Defer auth; make the boundary explicit in UI; respect robots by default |
| Per-page LLM cost balloons                          | Medium      | Two-phase compile/execute (§2.1, §2.4)                                  |
| Deep crawls overwhelm naive design                  | Medium      | Persistent frontier queue, dedup, resume, politeness (§3.4)             |

---

## 10. The one-paragraph rationale (for stakeholders)

crAIwl's bet — describe what you want, get a reusable strategy that self-heals — is the right bet and matches where the 2026 market has landed. The way to execute it credibly is to treat the LLM as a **compiler that emits a deterministic, versioned extraction program**, run that program in a **server-side, tiered fetch + orchestration data plane**, and invoke the model again only to **repair** what breaks. That single decision makes the product cheap to run, fast at scale, genuinely resilient to redesigns, and honest about where it can and can't go (cooperative web yes; hardened anti-bot and login-gated targets only with real infra and real legal exposure). The current spec's instincts are good; its three architectural commitments — `web_search` as fetcher, in-browser-only execution, and LLM-as-runtime — need to be replaced with the control-plane/data-plane split above.
