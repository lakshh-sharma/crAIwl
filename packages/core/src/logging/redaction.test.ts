import { describe, it, expect } from 'vitest';
import { redactString, redactRecord } from './redaction.js';

describe('redactString', () => {
  it('redacts a Bearer token (bare, without auth-header prefix)', () => {
    const out = redactString('got Bearer abc123XYZdef456_xyz back');
    expect(out).not.toContain('abc123XYZdef456_xyz');
    expect(out).toContain('[REDACTED:bearer]');
  });

  it('redacts an Authorization header value', () => {
    const out = redactString('Authorization: Bearer abc123XYZdef456_xyz');
    expect(out).not.toContain('abc123XYZdef456_xyz');
    expect(out).toMatch(/\[REDACTED:(authorization-header|bearer)\]/);
  });

  it('redacts a Stripe-style key', () => {
    const out = redactString('key=sk_live_ABCDEFGHIJKLMNOPQRST');
    expect(out).toContain('[REDACTED:stripe-like]');
  });

  it('redacts an AWS access key id', () => {
    const out = redactString('cred AKIAIOSFODNN7EXAMPLE here');
    expect(out).toContain('[REDACTED:aws-access-key]');
  });

  it('redacts a JWT-shaped token', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    expect(redactString(`token=${jwt}`)).toContain('[REDACTED:jwt]');
  });

  it('leaves innocuous text alone', () => {
    expect(redactString('hello world, nothing to see')).toBe('hello world, nothing to see');
  });
});

describe('redactRecord', () => {
  it('walks nested structures and redacts string leaves', () => {
    const input = {
      msg: 'fetched',
      headers: { authorization: 'Bearer secrettokenvalue1234' },
      nested: [{ note: 'sk_test_ABCDEFGHIJKLMNOPQRST' }],
    };
    const out = redactRecord(input) as typeof input;
    expect(out.headers.authorization).not.toContain('secrettokenvalue1234');
    expect(JSON.stringify(out)).toContain('[REDACTED:');
  });

  it('survives cycles', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a.self = a;
    const out = redactRecord(a) as Record<string, unknown>;
    expect(out.self).toBe('[Circular]');
  });
});
