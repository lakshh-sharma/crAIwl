/// <reference lib="dom" />
import { chromium, type Browser, type BrowserContext, type LaunchOptions } from 'playwright-core';
import {
  type BrowserAction,
  type BrowserProvider,
  type NavigateOptions,
  type NavigateResult,
} from './types.js';

export type PlaywrightProviderOptions = {
  /** Path to a Chromium executable. Required because we use playwright-core
   *  (which doesn't bundle browsers); set `executablePath` to a system Chrome
   *  or to a binary installed via `pnpm exec playwright install chromium`. */
  executablePath?: string;
  /** Headless mode. Default true. */
  headless?: boolean;
  /** Cap on simultaneously-open contexts. New navigations queue when full. */
  maxConcurrentContexts?: number;
  /** Default User-Agent for every context. */
  userAgent?: string;
  /** Extra LaunchOptions passed through to chromium.launch. */
  launchOptions?: LaunchOptions;
};

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36';

/**
 * Local-Playwright BrowserProvider. Lazily launches a single browser the
 * first time `navigate` is called, then pools BrowserContexts up to
 * `maxConcurrentContexts`. Each navigation gets a fresh context so cookies
 * and storage don't leak between requests on different jobs.
 *
 * Closing the provider tears down the browser cleanly — no orphan processes
 * even if navigations are in flight.
 */
export class PlaywrightBrowserProvider implements BrowserProvider {
  readonly kind = 'local' as const;
  private browserPromise: Promise<Browser> | undefined;
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private closed = false;

  constructor(private readonly opts: PlaywrightProviderOptions = {}) {}

  private async getBrowser(): Promise<Browser> {
    if (!this.browserPromise) {
      const launchOpts: LaunchOptions = {
        headless: this.opts.headless ?? true,
        ...this.opts.launchOptions,
        ...(this.opts.executablePath ? { executablePath: this.opts.executablePath } : {}),
      };
      this.browserPromise = chromium.launch(launchOpts);
    }
    return this.browserPromise;
  }

  private async acquireSlot(): Promise<void> {
    const max = this.opts.maxConcurrentContexts ?? 4;
    if (this.active < max) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active++;
  }

  private releaseSlot(): void {
    this.active--;
    const next = this.waiters.shift();
    if (next) next();
  }

  async navigate(url: string, opts: NavigateOptions = {}): Promise<NavigateResult> {
    if (this.closed) throw new Error('PlaywrightBrowserProvider is closed');
    await this.acquireSlot();
    let context: BrowserContext | undefined;
    try {
      const browser = await this.getBrowser();
      context = await browser.newContext({
        userAgent: opts.userAgent ?? this.opts.userAgent ?? DEFAULT_USER_AGENT,
        ...(opts.extraHeaders ? { extraHTTPHeaders: opts.extraHeaders } : {}),
      });
      const page = await context.newPage();
      page.setDefaultTimeout(opts.timeoutMs ?? 30_000);
      const response = await page.goto(url, {
        waitUntil: opts.waitUntil ?? 'domcontentloaded',
        timeout: opts.timeoutMs ?? 30_000,
      });
      let applied = 0;
      for (const action of opts.actions ?? []) {
        try {
          await runAction(page, action);
          applied++;
        } catch (err) {
          if (action.type === 'click' && action.optional) continue;
          throw err;
        }
      }
      const html = await page.content();
      const finalUrl = page.url();
      const status = response?.status() ?? 0;
      return { html, finalUrl, status, actionsApplied: applied };
    } finally {
      if (context) await context.close().catch(() => undefined);
      this.releaseSlot();
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.browserPromise) {
      const browser = await this.browserPromise.catch(() => undefined);
      this.browserPromise = undefined;
      if (browser) await browser.close().catch(() => undefined);
    }
  }
}

type AnyPage = Awaited<ReturnType<BrowserContext['newPage']>>;

async function runAction(page: AnyPage, action: BrowserAction): Promise<void> {
  switch (action.type) {
    case 'wait-ms':
      await page.waitForTimeout(action.ms);
      return;
    case 'wait-for-selector':
      await page.waitForSelector(action.selector, { timeout: action.timeoutMs ?? 10_000 });
      return;
    case 'click':
      await page.click(action.selector, { timeout: 5_000 });
      return;
    case 'scroll-to-bottom': {
      const max = action.maxIterations ?? 20;
      const stableMs = action.stableThresholdMs ?? 500;
      let prevHeight = -1;
      let stableSince = 0;
      for (let i = 0; i < max; i++) {
        const height = await page.evaluate(() => {
          window.scrollTo(0, document.body.scrollHeight);
          return document.body.scrollHeight;
        });
        if (height === prevHeight) {
          if (Date.now() - stableSince >= stableMs) return;
        } else {
          prevHeight = height;
          stableSince = Date.now();
        }
        await page.waitForTimeout(200);
      }
      return;
    }
  }
}
