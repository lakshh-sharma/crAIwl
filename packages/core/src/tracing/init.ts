import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

export type InitTracingOptions = {
  serviceName: string;
  serviceVersion?: string;
  /** OTLP HTTP endpoint. When unset, tracing is initialized as a no-op exporter — spans are still created (so withStageSpan works) but not exported. */
  otlpEndpoint?: string;
};

let sdk: NodeSDK | undefined;

/**
 * Initializes the global OpenTelemetry SDK. Idempotent — repeated calls are
 * no-ops. Process-entry points (api, cli, workers) MUST call this before
 * the first span is recorded; library code MUST NOT.
 */
export function initTracing(opts: InitTracingOptions): void {
  if (sdk) return;
  const endpoint = opts.otlpEndpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: opts.serviceName,
    ...(opts.serviceVersion ? { [ATTR_SERVICE_VERSION]: opts.serviceVersion } : {}),
  });
  sdk = new NodeSDK({
    resource,
    ...(endpoint ? { traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }) } : {}),
  });
  sdk.start();
}

export async function shutdownTracing(): Promise<void> {
  if (!sdk) return;
  await sdk.shutdown();
  sdk = undefined;
}
