/**
 * Patterns that look like credentials/tokens in free text. Used by the pino
 * formatter to scrub log lines before they leave the process (ADR-010, CRAWL-003).
 * Each pattern fails closed: if a match looks like a secret, we redact it,
 * accepting occasional false positives in exchange for never leaking a real one.
 */
type RedactionRule = {
  kind: string;
  pattern: RegExp;
};

const RULES: ReadonlyArray<RedactionRule> = [
  { kind: 'bearer', pattern: /\bBearer\s+[A-Za-z0-9._\-+/=]{8,}\b/gi },
  { kind: 'basic-auth', pattern: /\bBasic\s+[A-Za-z0-9+/=]{8,}\b/gi },
  {
    kind: 'authorization-header',
    pattern: /\b(authorization|x-api-key|x-auth-token)\s*[:=]\s*["']?[^"'\s,}]+/gi,
  },
  { kind: 'aws-access-key', pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: 'aws-secret', pattern: /\baws_secret_access_key\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}/gi },
  { kind: 'stripe-like', pattern: /\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{16,}\b/g },
  { kind: 'github-pat', pattern: /\bghp_[A-Za-z0-9]{36,}\b/g },
  { kind: 'slack-token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { kind: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { kind: 'cookie-session', pattern: /\b(session|sessionid|sid|connect\.sid)\s*=\s*[^;\s,]{8,}/gi },
];

export function redactString(input: string): string {
  let out = input;
  for (const rule of RULES) {
    out = out.replace(rule.pattern, `[REDACTED:${rule.kind}]`);
  }
  return out;
}

/**
 * Walks a structured log record and redacts any string leaves. Object keys are
 * preserved verbatim — we only scrub values. Cyclic refs short-circuit to '[Circular]'.
 */
export function redactRecord(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value as object)) return '[Circular]';
  seen.add(value as object);
  if (Array.isArray(value)) return value.map((v) => redactRecord(v, seen));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = redactRecord(v, seen);
  }
  return out;
}
