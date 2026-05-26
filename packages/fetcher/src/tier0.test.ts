import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MockAgent, setGlobalDispatcher } from 'undici';
import { Tier0Fetcher } from './tier0.js';
import { FetchError } from './types.js';

let agent: MockAgent;

beforeEach(() => {
  agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
});

afterEach(async () => {
  await agent.close();
});

describe('Tier0Fetcher: happy path', () => {
  it('returns body, status, and headers on 200', async () => {
    agent
      .get('https://example.com')
      .intercept({ path: '/' })
      .reply(200, '<html>hi</html>', { headers: { 'content-type': 'text/html' } });

    const fetcher = new Tier0Fetcher({ dispatcher: agent });
    const res = await fetcher.fetch('https://example.com/');

    expect(res.status).toBe(200);
    expect(res.body).toBe('<html>hi</html>');
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.tierUsed).toBe('static');
    expect(res.attempts).toBe(1);
    expect(res.timingMs).toBeGreaterThanOrEqual(0);
  });

  it('sends a default User-Agent', async () => {
    let seenUA = '';
    agent.get('https://example.com').intercept({ path: '/' }).reply(200, 'ok').times(1);
    agent
      .get('https://example.com')
      .intercept({
        path: '/check',
        method: 'GET',
      })
      .reply((opts) => {
        seenUA = String(opts.headers && (opts.headers as Record<string, string>)['user-agent']);
        return { statusCode: 200, data: 'ok' };
      });

    const fetcher = new Tier0Fetcher({ dispatcher: agent });
    await fetcher.fetch('https://example.com/');
    await fetcher.fetch('https://example.com/check');

    expect(seenUA).toMatch(/craiwl/i);
  });

  it('passes through 4xx without retrying', async () => {
    let calls = 0;
    agent
      .get('https://example.com')
      .intercept({ path: '/missing' })
      .reply(() => {
        calls++;
        return { statusCode: 404, data: 'not found' };
      })
      .times(5);

    const fetcher = new Tier0Fetcher({ dispatcher: agent, defaultMaxRetries: 3 });
    const res = await fetcher.fetch('https://example.com/missing');

    expect(res.status).toBe(404);
    expect(res.attempts).toBe(1);
    expect(calls).toBe(1);
  });
});

describe('Tier0Fetcher: retries', () => {
  it('retries on 503 then succeeds', async () => {
    let calls = 0;
    agent
      .get('https://example.com')
      .intercept({ path: '/flaky' })
      .reply(() => {
        calls++;
        return calls < 2 ? { statusCode: 503, data: 'busy' } : { statusCode: 200, data: 'ok' };
      })
      .times(5);

    const fetcher = new Tier0Fetcher({ dispatcher: agent, defaultMaxRetries: 3 });
    const res = await fetcher.fetch('https://example.com/flaky');

    expect(res.status).toBe(200);
    expect(res.attempts).toBe(2);
  });

  it('exhausts retries on persistent 500 and returns the last response', async () => {
    let calls = 0;
    agent
      .get('https://example.com')
      .intercept({ path: '/broken' })
      .reply(() => {
        calls++;
        return { statusCode: 500, data: 'boom' };
      })
      .times(5);

    const fetcher = new Tier0Fetcher({ dispatcher: agent, defaultMaxRetries: 2 });
    const res = await fetcher.fetch('https://example.com/broken');

    expect(res.status).toBe(500);
    expect(res.attempts).toBe(3); // initial + 2 retries
    expect(calls).toBe(3);
  });
});

describe('Tier0Fetcher: cancellation', () => {
  it('respects an aborted signal and throws FetchError', async () => {
    agent.get('https://example.com').intercept({ path: '/slow' }).reply(200, 'ok').delay(1_000);

    const fetcher = new Tier0Fetcher({ dispatcher: agent, defaultMaxRetries: 0 });
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 5);
    await expect(
      fetcher.fetch('https://example.com/slow', { signal: ctrl.signal }),
    ).rejects.toThrow(FetchError);
  });

  it('times out when timeoutMs elapses', async () => {
    agent.get('https://example.com').intercept({ path: '/slow' }).reply(200, 'ok').delay(500);

    const fetcher = new Tier0Fetcher({ dispatcher: agent, defaultMaxRetries: 0 });
    await expect(fetcher.fetch('https://example.com/slow', { timeoutMs: 50 })).rejects.toThrow(
      FetchError,
    );
  });
});

describe('Tier0Fetcher: HEAD', () => {
  it('does not read a body for HEAD requests', async () => {
    agent
      .get('https://example.com')
      .intercept({ path: '/head', method: 'HEAD' })
      .reply(200, '', { headers: { 'content-length': '999' } });

    const fetcher = new Tier0Fetcher({ dispatcher: agent });
    const res = await fetcher.fetch('https://example.com/head', { method: 'HEAD' });

    expect(res.status).toBe(200);
    expect(res.body).toBe('');
  });
});
