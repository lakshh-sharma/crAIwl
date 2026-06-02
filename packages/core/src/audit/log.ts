import type { AuditEvent, AuditEventKind, AuditLog } from './types.js';

/**
 * Default in-memory audit log. Cheap to allocate, append-only, and
 * serializable. Most v1 runs fit easily in RAM — a 100-page authenticated
 * crawl produces a few hundred events.
 */
export class InMemoryAuditLog implements AuditLog {
  private readonly buf: AuditEvent[] = [];

  record(event: AuditEvent): void {
    this.buf.push(event);
  }

  events(): readonly AuditEvent[] {
    return this.buf;
  }

  countsByKind(): Record<AuditEventKind, number> {
    const out: Record<string, number> = {
      'robots-bypass': 0,
      'auth-attached': 0,
      'secret-accessed': 0,
      'redaction-applied': 0,
      'http-auth-failure': 0,
    };
    for (const e of this.buf) {
      out[e.kind] = (out[e.kind] ?? 0) + 1;
    }
    return out as Record<AuditEventKind, number>;
  }
}

/** No-op log for callers that don't care. Stays cheap on the hot path. */
export const noopAuditLog: AuditLog = {
  record() {},
  events: () => [],
};

/**
 * Renders the log as JSONL — one event per line — suitable for tail/grep/jq.
 * Stable line order (insertion order); no trailing newline.
 */
export function toJsonl(log: AuditLog): string {
  return log
    .events()
    .map((e) => JSON.stringify(e))
    .join('\n');
}
