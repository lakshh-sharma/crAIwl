import { describe, it, expect } from 'vitest';
import {
  generateCorrelationId,
  getCorrelationId,
  getLogContext,
  withCorrelationId,
  withLogContext,
} from './context.js';

describe('log context', () => {
  it('returns undefined outside any scope', () => {
    expect(getCorrelationId()).toBeUndefined();
  });

  it('propagates correlationId inside withCorrelationId', () => {
    const id = generateCorrelationId();
    withCorrelationId(id, () => {
      expect(getCorrelationId()).toBe(id);
    });
    expect(getCorrelationId()).toBeUndefined();
  });

  it('propagates through async boundaries', async () => {
    const id = generateCorrelationId();
    await withCorrelationId(id, async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 1));
      expect(getCorrelationId()).toBe(id);
    });
  });

  it('exposes jobId and runId via withLogContext', () => {
    withLogContext({ correlationId: 'c', jobId: 'j', runId: 'r' }, () => {
      expect(getLogContext()).toEqual({ correlationId: 'c', jobId: 'j', runId: 'r' });
    });
  });
});
