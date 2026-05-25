import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { withStageSpan } from './tracer.js';
import { withCorrelationId } from '../logging/context.js';

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});

beforeAll(() => {
  trace.setGlobalTracerProvider(provider);
});

afterAll(async () => {
  await provider.shutdown();
  trace.disable();
});

describe('withStageSpan', () => {
  it('creates a span named pipeline.<stage> and records OK on success', async () => {
    exporter.reset();
    const result = await withStageSpan('fetch', { url: 'https://example.com' }, async () => 42);
    expect(result).toBe(42);
    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]!.name).toBe('pipeline.fetch');
    expect(spans[0]!.attributes['craiwl.stage']).toBe('fetch');
    expect(spans[0]!.attributes['url']).toBe('https://example.com');
    expect(spans[0]!.status.code).toBe(1); // OK
  });

  it('records exceptions and re-throws', async () => {
    exporter.reset();
    await expect(
      withStageSpan('compile', {}, () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]!.status.code).toBe(2); // ERROR
    expect(spans[0]!.events.some((e) => e.name === 'exception')).toBe(true);
  });

  it('attaches correlationId from the active LogContext', async () => {
    exporter.reset();
    await withCorrelationId('corr-abc', () => withStageSpan('execute', {}, () => undefined));
    const span = exporter.getFinishedSpans()[0]!;
    expect(span.attributes['craiwl.correlation_id']).toBe('corr-abc');
  });
});
