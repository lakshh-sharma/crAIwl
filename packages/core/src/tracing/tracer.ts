import { SpanStatusCode, trace, type Attributes, type Span, type Tracer } from '@opentelemetry/api';
import { getLogContext } from '../logging/context.js';
import type { PipelineStage } from './stages.js';

const TRACER_NAME = 'craiwl';

export function getTracer(): Tracer {
  return trace.getTracer(TRACER_NAME);
}

/**
 * Wraps `fn` in a span named `pipeline.<stage>`. The current LogContext (if
 * any) is attached as span attributes so traces and logs share keys.
 *
 * Errors thrown from `fn` are recorded on the span and re-thrown — the caller
 * decides how to handle them.
 */
export async function withStageSpan<T>(
  stage: PipelineStage,
  attributes: Attributes,
  fn: (span: Span) => Promise<T> | T,
): Promise<T> {
  const tracer = getTracer();
  const ctx = getLogContext();
  const merged: Attributes = {
    'craiwl.stage': stage,
    ...(ctx?.correlationId ? { 'craiwl.correlation_id': ctx.correlationId } : {}),
    ...(ctx?.jobId ? { 'craiwl.job_id': ctx.jobId } : {}),
    ...(ctx?.runId ? { 'craiwl.run_id': ctx.runId } : {}),
    ...attributes,
  };
  return tracer.startActiveSpan(`pipeline.${stage}`, { attributes: merged }, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      span.end();
    }
  });
}
