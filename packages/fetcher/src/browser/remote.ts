import type { BrowserProvider, NavigateOptions, NavigateResult } from './types.js';

export type RemoteBrowserProviderOptions = {
  endpoint: string;
  apiKey?: string;
};

/**
 * Stub remote-browser provider. The interface is wired so callers can target
 * a hosted service (Steel.dev, Browserbase, hyperbrowser) without changing
 * extraction code — but the implementation is intentionally unimplemented
 * until we pick a vendor. Throws on use so the missing impl is loud.
 */
export class RemoteBrowserProvider implements BrowserProvider {
  readonly kind = 'remote' as const;

  constructor(private readonly opts: RemoteBrowserProviderOptions) {}

  navigate(_url: string, _opts?: NavigateOptions): Promise<NavigateResult> {
    throw new Error(
      `RemoteBrowserProvider is a stub. Configure a real provider at ${this.opts.endpoint} before use.`,
    );
  }

  async close(): Promise<void> {
    // nothing to release until a provider is wired up
  }
}
