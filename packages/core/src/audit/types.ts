/**
 * Compliance audit trail.
 *
 * The audit log is the answer to "what did the crawler actually do?" — and
 * crucially, "what credentials did it use, and where did it touch them?"
 *
 * It's append-only and structured. Each event carries enough context to be
 * useful in isolation (timestamp, kind, URL or secret name) without ever
 * including credential material. The full log is written as JSONL so it
 * pipes naturally into jq, grep, and SIEM tooling.
 *
 * Five kinds for v1:
 *   - robots-bypass      — a URL was crawled despite a Disallow rule
 *   - auth-attached      — auth headers were attached to a request
 *   - secret-accessed    — a secret was read from a SecretsProvider
 *   - redaction-applied  — a log line had credential material scrubbed
 *   - http-auth-failure  — a 401/403 came back on an auth-gated URL
 */

export type AuditEventBase = {
  /** ISO-8601 UTC timestamp. */
  at: string;
};

export type RobotsBypassEvent = AuditEventBase & {
  kind: 'robots-bypass';
  policy: 'warn' | 'ignore';
  url: string;
  userAgent: string;
};

export type AuthAttachedEvent = AuditEventBase & {
  kind: 'auth-attached';
  url: string;
  /** Logical secret name (e.g. "github-token") — never the value. */
  secretName: string;
  /** Header names attached, no values. */
  headerNames: string[];
  /** Auth profile shape — bearer/api-key/basic. */
  authType: 'bearer' | 'api-key' | 'basic';
};

export type SecretAccessedEvent = AuditEventBase & {
  kind: 'secret-accessed';
  /** Logical secret name. */
  secretName: string;
  /** Which provider served the secret — env, file, etc. */
  providerLabel: string;
  /** Where in the pipeline the access happened. */
  reason: 'resolve-auth' | 'manual-lookup';
};

export type RedactionAppliedEvent = AuditEventBase & {
  kind: 'redaction-applied';
  /** Token rule that fired — e.g. "bearer", "github-pat". */
  rule: string;
  /** Where the redaction happened — log line, manifest field, etc. */
  surface: string;
};

export type HttpAuthFailureEvent = AuditEventBase & {
  kind: 'http-auth-failure';
  url: string;
  status: 401 | 403;
};

export type AuditEvent =
  | RobotsBypassEvent
  | AuthAttachedEvent
  | SecretAccessedEvent
  | RedactionAppliedEvent
  | HttpAuthFailureEvent;

export type AuditEventKind = AuditEvent['kind'];

/**
 * Sink interface — `crawlSite` and `runJob` accept anything that fulfills it.
 * The InMemoryAuditLog below is the default; persistence to JSONL happens
 * after the run via writeAuditLog().
 */
export interface AuditLog {
  record(event: AuditEvent): void;
  events(): readonly AuditEvent[];
}
