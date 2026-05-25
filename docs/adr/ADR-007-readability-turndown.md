# ADR-007 — Readability-style main-content extraction + Turndown markdown

- **Status:** Accepted
- **Date:** 2026-05-25
- **Deciders:** crAIwl team

## Context

Before the compile phase sees a page, we should strip nav, footer, ads, cookie banners, and analytics — content the LLM doesn't need. The compile call is the expensive one (per-template, not per-page), but tokens still translate to dollars and latency, and noise lowers locator quality.

The cleaned DOM must still preserve enough structure (headings, lists, tables, anchors, data attributes) for locator synthesis to work on the real page later.

## Decision

- Use a **Readability-style algorithm** (e.g. `@mozilla/readability`) to extract main content from the raw DOM.
- Render the cleaned DOM to **Markdown via Turndown** when the compile prompt benefits from a flatter representation.
- Always retain the cleaned DOM in addition to the markdown — the executor runs against the DOM, not against markdown.

## Consequences

**Positive.**

- Measurable token reduction (target: report per-page reduction in CRAWL-020 PR).
- Standard, well-understood algorithms — no novel scraping logic.
- Determinism: same input → same cleaned output, which makes the compile prompt cacheable.

**Negative.**

- Readability is tuned for articles; aggressive on highly structured pages (pricing grids, dashboards). We may need per-template-type overrides over time.
- Markdown loses some attributes the locator step needs — that's why we keep both representations.

**Override cost.** Low — replacing the cleaner is contained to one module in `@craiwl/extractor`.
