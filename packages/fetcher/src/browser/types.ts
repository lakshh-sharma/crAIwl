/**
 * BrowserProvider — the seam between the Tier 2 fetcher and whichever
 * headless-browser substrate is actually doing the work. Local Playwright is
 * one implementation; hosted providers (Steel.dev, Browserbase, hyperbrowser)
 * slot in behind the same interface without callers caring.
 *
 * The interface is intentionally narrow: callers do not get a Page object
 * back. They describe what they want (navigate + a small list of scripted
 * actions) and receive a rendered HTML snapshot. This keeps provider-specific
 * details from leaking into the rest of the system.
 */

export type BrowserKind = 'local' | 'remote';

export type BrowserAction =
  | { type: 'scroll-to-bottom'; maxIterations?: number; stableThresholdMs?: number }
  | { type: 'click'; selector: string; optional?: boolean }
  | { type: 'wait-ms'; ms: number }
  | { type: 'wait-for-selector'; selector: string; timeoutMs?: number };

export type WaitUntil = 'load' | 'domcontentloaded' | 'networkidle';

export type NavigateOptions = {
  /** Page-load completion signal. Default 'domcontentloaded'. */
  waitUntil?: WaitUntil;
  /** Per-navigation timeout. */
  timeoutMs?: number;
  /** Caller-controlled cancellation. */
  signal?: AbortSignal;
  /** Custom User-Agent for this navigation. */
  userAgent?: string;
  /** Extra headers attached to the navigation request. */
  extraHeaders?: Record<string, string>;
  /** Scripted actions to run after navigation, before the snapshot. */
  actions?: BrowserAction[];
};

export type NavigateResult = {
  html: string;
  finalUrl: string;
  status: number;
  /** True if any action in `actions` was applied. */
  actionsApplied: number;
};

export interface BrowserProvider {
  readonly kind: BrowserKind;
  navigate(url: string, opts?: NavigateOptions): Promise<NavigateResult>;
  /** Release all browser resources. Safe to call multiple times. */
  close(): Promise<void>;
}
