import { describe, expect, it } from 'vitest';
import { Frontier } from './frontier.js';

describe('Frontier', () => {
  it('accepts in-scope URLs and dedupes by canonical key', () => {
    const f = new Frontier({ entryUrl: 'https://x.com/docs', scope: 'site' });
    const r = f.enqueue([
      { url: 'https://x.com/docs/a', depth: 1, source: 'seed' },
      { url: 'https://x.com/docs/a?utm_source=q', depth: 1, source: 'discovery' }, // dup after canon
      { url: 'https://x.com/docs/b', depth: 1, source: 'link' },
    ]);
    expect(r.accepted).toBe(2);
    expect(r.rejected.map((x) => x.reason)).toContain('duplicate');
    expect(f.size).toBe(2);
  });

  it('rejects out-of-scope candidates', () => {
    const f = new Frontier({ entryUrl: 'https://x.com/docs', scope: 'section' });
    const r = f.enqueue([
      { url: 'https://x.com/docs/intro', depth: 1, source: 'link' },
      { url: 'https://x.com/blog/post', depth: 1, source: 'link' },
      { url: 'https://other.com/docs', depth: 1, source: 'link' },
    ]);
    expect(r.accepted).toBe(1);
    expect(r.rejected.find((x) => x.url.includes('blog'))?.reason).toBe('out-of-scope');
    expect(r.rejected.find((x) => x.url.includes('other.com'))?.reason).toBe('out-of-scope');
  });

  it('rejects URLs past maxDepth', () => {
    const f = new Frontier({ entryUrl: 'https://x.com/docs', scope: 'site', maxDepth: 1 });
    const r = f.enqueue([
      { url: 'https://x.com/a', depth: 1, source: 'link' },
      { url: 'https://x.com/b', depth: 2, source: 'link' },
    ]);
    expect(r.accepted).toBe(1);
    expect(r.rejected[0]!.reason).toBe('past-max-depth');
  });

  it('caps total accepted URLs at maxPages', () => {
    const f = new Frontier({ entryUrl: 'https://x.com/docs', scope: 'site', maxPages: 2 });
    const r = f.enqueue([
      { url: 'https://x.com/a', depth: 1, source: 'link' },
      { url: 'https://x.com/b', depth: 1, source: 'link' },
      { url: 'https://x.com/c', depth: 1, source: 'link' },
    ]);
    expect(r.accepted).toBe(2);
    expect(r.rejected[0]!.reason).toBe('past-max-pages');
  });

  it('dequeues in FIFO order and tracks visited count', () => {
    const f = new Frontier({ entryUrl: 'https://x.com/docs', scope: 'site' });
    f.enqueue([
      { url: 'https://x.com/a', depth: 1, source: 'link' },
      { url: 'https://x.com/b', depth: 1, source: 'link' },
    ]);
    const first = f.dequeue();
    expect(first?.url).toBe('https://x.com/a');
    f.markVisited(first!.canonicalKey);
    expect(f.visitedCount).toBe(1);
    expect(f.dequeue()?.url).toBe('https://x.com/b');
    expect(f.dequeue()).toBeUndefined();
    expect(f.isExhausted()).toBe(true);
  });

  it('rejects malformed URLs', () => {
    const f = new Frontier({ entryUrl: 'https://x.com/docs', scope: 'site' });
    const r = f.enqueue([{ url: 'not a url', depth: 1, source: 'link' }]);
    expect(r.accepted).toBe(0);
    expect(r.rejected[0]!.reason).toBe('malformed');
  });
});
