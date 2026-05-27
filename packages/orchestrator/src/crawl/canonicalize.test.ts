import { describe, expect, it } from 'vitest';
import { canonicalize, isInScope } from './canonicalize.js';

describe('canonicalize', () => {
  it('lowercases the host and drops the fragment', () => {
    expect(canonicalize('https://Example.com/Docs#install')).toBe('https://example.com/Docs');
  });

  it('strips tracking params but keeps real ones', () => {
    expect(canonicalize('https://x.com/p?utm_source=email&page=2&gclid=abc')).toBe(
      'https://x.com/p?page=2',
    );
  });

  it('respects a custom allowlist over the tracking blocklist', () => {
    expect(canonicalize('https://x.com/p?ref=signup', { paramAllowlist: new Set(['ref']) })).toBe(
      'https://x.com/p?ref=signup',
    );
  });

  it('sorts remaining params alphabetically for stable hashing', () => {
    expect(canonicalize('https://x.com/p?b=2&a=1')).toBe('https://x.com/p?a=1&b=2');
  });

  it('strips trailing slash on non-root paths but keeps root /', () => {
    expect(canonicalize('https://x.com/docs/')).toBe('https://x.com/docs');
    expect(canonicalize('https://x.com/')).toBe('https://x.com/');
  });

  it('drops default ports', () => {
    expect(canonicalize('http://x.com:80/p')).toBe('http://x.com/p');
    expect(canonicalize('https://x.com:443/p')).toBe('https://x.com/p');
  });

  it('returns null for non-http(s) and malformed URLs', () => {
    expect(canonicalize('javascript:alert(1)')).toBeNull();
    expect(canonicalize('mailto:hi@x.com')).toBeNull();
    expect(canonicalize('not a url')).toBeNull();
  });
});

describe('isInScope', () => {
  it('single matches only the exact entry URL (mod canonicalization)', () => {
    const entry = 'https://x.com/docs';
    expect(isInScope('https://x.com/docs', entry, 'single')).toBe(true);
    expect(isInScope('https://x.com/docs?utm_source=q', entry, 'single')).toBe(true);
    expect(isInScope('https://x.com/docs/intro', entry, 'single')).toBe(false);
  });

  it('section matches everything at or under the entry URL path', () => {
    const entry = 'https://x.com/docs/';
    expect(isInScope('https://x.com/docs/intro', entry, 'section')).toBe(true);
    expect(isInScope('https://x.com/docs/intro/setup', entry, 'section')).toBe(true);
    expect(isInScope('https://x.com/blog/post', entry, 'section')).toBe(false);
  });

  it('treats the entry path itself as the section root (no trailing slash needed)', () => {
    const entry = 'https://x.com/docs';
    expect(isInScope('https://x.com/docs', entry, 'section')).toBe(true);
    expect(isInScope('https://x.com/docs/intro', entry, 'section')).toBe(true);
    expect(isInScope('https://x.com/docsearch', entry, 'section')).toBe(false);
    expect(isInScope('https://x.com/blog', entry, 'section')).toBe(false);
  });

  it('site matches anything on the same origin', () => {
    const entry = 'https://x.com/docs';
    expect(isInScope('https://x.com/blog', entry, 'site')).toBe(true);
    expect(isInScope('https://other.com/blog', entry, 'site')).toBe(false);
  });
});
