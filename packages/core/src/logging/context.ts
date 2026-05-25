import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export type LogContext = {
  correlationId: string;
  jobId?: string;
  runId?: string;
};

const storage = new AsyncLocalStorage<LogContext>();

export function generateCorrelationId(): string {
  return randomUUID();
}

export function getLogContext(): LogContext | undefined {
  return storage.getStore();
}

export function getCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}

export function withLogContext<T>(context: LogContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function withCorrelationId<T>(correlationId: string, fn: () => T): T {
  return storage.run({ correlationId }, fn);
}
