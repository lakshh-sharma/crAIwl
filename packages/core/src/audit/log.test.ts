import { describe, expect, it } from 'vitest';
import { InMemoryAuditLog, noopAuditLog, toJsonl } from './log.js';
import type { AuditEvent } from './types.js';

const ev = (kind: AuditEvent['kind'], extra: Record<string, unknown>): AuditEvent =>
  ({ at: '2026-06-02T00:00:00.000Z', kind, ...extra }) as AuditEvent;

describe('InMemoryAuditLog', () => {
  it('preserves insertion order', () => {
    const log = new InMemoryAuditLog();
    log.record(
      ev('auth-attached', {
        url: 'a',
        secretName: 's',
        headerNames: ['Authorization'],
        authType: 'bearer',
      }),
    );
    log.record(
      ev('auth-attached', {
        url: 'b',
        secretName: 's',
        headerNames: ['Authorization'],
        authType: 'bearer',
      }),
    );
    expect(log.events()).toHaveLength(2);
    expect((log.events()[0] as { url: string }).url).toBe('a');
  });

  it('counts events by kind', () => {
    const log = new InMemoryAuditLog();
    log.record(ev('robots-bypass', { policy: 'warn', url: 'a', userAgent: 'craiwl' }));
    log.record(ev('robots-bypass', { policy: 'ignore', url: 'b', userAgent: 'craiwl' }));
    log.record(
      ev('auth-attached', { url: 'c', secretName: 's', headerNames: [], authType: 'bearer' }),
    );
    const c = log.countsByKind();
    expect(c['robots-bypass']).toBe(2);
    expect(c['auth-attached']).toBe(1);
    expect(c['secret-accessed']).toBe(0);
  });
});

describe('noopAuditLog', () => {
  it('accepts events silently and returns an empty list', () => {
    noopAuditLog.record(ev('robots-bypass', { policy: 'warn', url: 'x', userAgent: 'craiwl' }));
    expect(noopAuditLog.events()).toEqual([]);
  });
});

describe('toJsonl', () => {
  it('emits one event per line, no trailing newline', () => {
    const log = new InMemoryAuditLog();
    log.record(ev('robots-bypass', { policy: 'warn', url: 'a', userAgent: 'craiwl' }));
    log.record(ev('robots-bypass', { policy: 'warn', url: 'b', userAgent: 'craiwl' }));
    const out = toJsonl(log);
    const lines = out.split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).url).toBe('a');
    expect(JSON.parse(lines[1]!).url).toBe('b');
    expect(out.endsWith('\n')).toBe(false);
  });

  it('handles an empty log', () => {
    expect(toJsonl(new InMemoryAuditLog())).toBe('');
  });
});
