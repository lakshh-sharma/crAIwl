import { describe, it, expect } from 'vitest';
import { pino } from 'pino';
import { createLogger } from './logger.js';
import { withCorrelationId, getLogContext } from './context.js';
import { redactRecord } from './redaction.js';

describe('createLogger', () => {
  it('builds a logger with the requested level', () => {
    const logger = createLogger({ name: 'test-svc', level: 'debug', pretty: false });
    expect(logger.level).toBe('debug');
    expect(typeof logger.info).toBe('function');
  });

  it('respects LOG_LEVEL env override when no explicit level is passed', () => {
    const prev = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = 'warn';
    try {
      const logger = createLogger({ pretty: false });
      expect(logger.level).toBe('warn');
    } finally {
      if (prev === undefined) delete process.env.LOG_LEVEL;
      else process.env.LOG_LEVEL = prev;
    }
  });
});

/**
 * Build an isolated pino with the same mixin/formatter wiring createLogger
 * uses, but writing into an in-memory sink so we can inspect the JSON.
 */
function captureLogger() {
  const lines: string[] = [];
  const stream = {
    write(chunk: string) {
      lines.push(chunk.trimEnd());
    },
  };
  const logger = pino(
    {
      level: 'debug',
      base: { service: 'craiwl' },
      mixin() {
        const ctx = getLogContext();
        return ctx ? { ...ctx } : {};
      },
      formatters: {
        log(obj) {
          return redactRecord(obj) as Record<string, unknown>;
        },
      },
    },
    stream,
  );
  return { logger, lines };
}

describe('logger integration', () => {
  it('emits JSON, propagates correlationId, and redacts secrets', () => {
    const { logger, lines } = captureLogger();
    withCorrelationId('corr-789', () => {
      logger.info({ headers: { authorization: 'Bearer supersecret_abcdef12345' } }, 'sent');
    });
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(record.msg).toBe('sent');
    expect(record.correlationId).toBe('corr-789');
    const serialized = JSON.stringify(record);
    expect(serialized).toContain('[REDACTED:');
    expect(serialized).not.toContain('supersecret_abcdef12345');
  });
});
