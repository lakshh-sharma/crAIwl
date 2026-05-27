import { describe, expect, it, vi } from 'vitest';
import { RobotsCache, type FetchResult, type Fetcher } from '@craiwl/fetcher';
import { RobotsPolicyChecker } from './robots-policy.js';

const ok = (body: string): FetchResult => ({
  status: 200,
  headers: {},
  body,
  finalUrl: '',
  tierUsed: 'static',
  timingMs: 1,
  attempts: 1,
  redirects: 0,
});

const fakeFetcher = (body: string): Fetcher => ({
  tier: 'static',
  fetch: async () => ok(body),
});

const robotsTxt = `User-agent: *
Disallow: /admin/
Crawl-delay: 2
`;

describe('RobotsPolicyChecker', () => {
  it('respects robots by default', async () => {
    const cache = new RobotsCache({ fetcher: fakeFetcher(robotsTxt) });
    const checker = new RobotsPolicyChecker({ cache, userAgent: 'craiwl' });
    expect((await checker.check('https://x.com/admin/secret')).allowed).toBe(false);
    expect((await checker.check('https://x.com/public')).allowed).toBe(true);
  });

  it('warn mode lets disallowed through and writes an audit event', async () => {
    const cache = new RobotsCache({ fetcher: fakeFetcher(robotsTxt) });
    const onAudit = vi.fn();
    const checker = new RobotsPolicyChecker({
      cache,
      userAgent: 'craiwl',
      policy: 'warn',
      onAudit,
    });
    const decision = await checker.check('https://x.com/admin/secret');
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('disallowed-warn');
    expect(onAudit).toHaveBeenCalledTimes(1);
    expect(onAudit.mock.calls[0]![0].policy).toBe('warn');
  });

  it('ignore mode lets disallowed through and still audits', async () => {
    const cache = new RobotsCache({ fetcher: fakeFetcher(robotsTxt) });
    const onAudit = vi.fn();
    const checker = new RobotsPolicyChecker({
      cache,
      userAgent: 'craiwl',
      policy: 'ignore',
      onAudit,
    });
    const decision = await checker.check('https://x.com/admin/secret');
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('disallowed-ignore');
    expect(onAudit).toHaveBeenCalledTimes(1);
  });

  it('does not audit when the URL is allowed', async () => {
    const cache = new RobotsCache({ fetcher: fakeFetcher(robotsTxt) });
    const onAudit = vi.fn();
    const checker = new RobotsPolicyChecker({
      cache,
      userAgent: 'craiwl',
      policy: 'warn',
      onAudit,
    });
    await checker.check('https://x.com/public');
    expect(onAudit).not.toHaveBeenCalled();
  });

  it('surfaces crawl-delay through the policy checker', async () => {
    const cache = new RobotsCache({ fetcher: fakeFetcher(robotsTxt) });
    const checker = new RobotsPolicyChecker({ cache, userAgent: 'craiwl' });
    expect(await checker.crawlDelaySec('https://x.com/anything')).toBe(2);
  });
});
