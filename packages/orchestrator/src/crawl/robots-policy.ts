/**
 * Robots.txt policy enforcement.
 *
 * Three modes:
 *  - respect (default): disallowed URLs are skipped.
 *  - warn: disallowed URLs are crawled but emit a warning + audit event.
 *  - ignore: disallowed URLs are crawled silently. Still writes an audit
 *    event so the override is recoverable from logs.
 *
 * `warn` and `ignore` require an explicit caller opt-in — the default is
 * always `respect`.
 */

import type { RobotsBypassEvent } from '@craiwl/core';
import type { RobotsCache } from '@craiwl/fetcher';

export type RobotsPolicy = 'respect' | 'warn' | 'ignore';

export type RobotsDecision = {
  url: string;
  allowed: boolean;
  /**
   * Why the gate let the URL through (or didn't). Useful for the crawl
   * report and for audit-event payloads.
   */
  reason: 'allowed-by-robots' | 'disallowed-respect' | 'disallowed-warn' | 'disallowed-ignore';
};

/** Re-export so existing callers keep working. */
export type AuditEvent = RobotsBypassEvent;

export type RobotsPolicyCheckerOptions = {
  cache: RobotsCache;
  userAgent: string;
  policy?: RobotsPolicy;
  /** Sink for audit events. The orchestrator persists them downstream. */
  onAudit?: (event: AuditEvent) => void;
};

export class RobotsPolicyChecker {
  private readonly cache: RobotsCache;
  private readonly userAgent: string;
  private readonly policy: RobotsPolicy;
  private readonly onAudit: (event: AuditEvent) => void;

  constructor(opts: RobotsPolicyCheckerOptions) {
    this.cache = opts.cache;
    this.userAgent = opts.userAgent;
    this.policy = opts.policy ?? 'respect';
    this.onAudit = opts.onAudit ?? (() => {});
  }

  async check(url: string): Promise<RobotsDecision> {
    const allowed = await this.cache.isAllowed(url, this.userAgent);
    if (allowed) return { url, allowed: true, reason: 'allowed-by-robots' };

    if (this.policy === 'respect') {
      return { url, allowed: false, reason: 'disallowed-respect' };
    }

    // warn / ignore — the URL gets crawled, but the override is audited.
    this.onAudit({
      at: new Date().toISOString(),
      kind: 'robots-bypass',
      policy: this.policy,
      url,
      userAgent: this.userAgent,
    });
    return {
      url,
      allowed: true,
      reason: this.policy === 'warn' ? 'disallowed-warn' : 'disallowed-ignore',
    };
  }

  /** Returns the advisory Crawl-delay for `url` from robots.txt, if any. */
  async crawlDelaySec(url: string): Promise<number | undefined> {
    return this.cache.getCrawlDelay(url, this.userAgent);
  }
}
