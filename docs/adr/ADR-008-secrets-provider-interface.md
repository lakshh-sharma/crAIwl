# ADR-008 — Pluggable `SecretsProvider` interface

- **Status:** Proposed — awaiting confirmation (final choice deferred to CRAWL-100 spike)
- **Date:** 2026-05-25
- **Deciders:** crAIwl team

## Context

The product makes claims about secret handling that depend on whether it runs locally or hosted. The local-first product can credibly say "credentials never leave your machine" using the OS keychain. The hosted product cannot — it needs a real vault (AWS Secrets Manager + KMS, or equivalent).

We do not have to decide local-vs-hosted now, but we _must_ not bake either assumption into callers. Auth (E15) is the highest-risk milestone; getting the seam wrong here means rewriting all credential handling in M4.

## Decision

- Define a `SecretsProvider` interface in `@craiwl/core` with the contract: `put(key, secret, scope)`, `get(key, scope)`, `delete(key, scope)`, `rotate(key, scope)`. All operations scoped to a job.
- Ship two implementations:
  - **OS keychain** (local mode) — macOS Keychain / libsecret / Windows Credential Manager.
  - **AWS Secrets Manager + KMS** (hosted mode) — stub initially, fleshed out when CRAWL-100 lands.
- Callers (fetcher, browser provider, auth flows) reference secrets **by vault key**, never inline. Decryption happens only inside the fetch worker and the result is short-lived.
- Final A-vs-B decision documented as the deliverable of the CRAWL-100 spike, which may supersede this ADR.

## Consequences

**Positive.**

- The product shape (local-first vs hosted) becomes a configuration, not a fork in the codebase.
- Penetration test surface is small and well-defined (CRAWL-101).
- "Vault key, not value" rule is enforceable in code review.

**Negative.**

- Two implementations means double the test surface for the secrets layer.
- The interface must be designed defensively — leaking the wrong scope across jobs would be a security incident.

**Override cost.** Low if the interface lands early (M0); high if we wait until M4 and discover assumptions hardcoded in the fetcher.
