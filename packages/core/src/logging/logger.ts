import { pino, type Logger, type LoggerOptions } from 'pino';
import { getLogContext } from './context.js';
import { redactRecord } from './redaction.js';

export type { Logger };

export type CreateLoggerOptions = {
  name?: string;
  level?: string;
  pretty?: boolean;
};

let rootLogger: Logger | undefined;

function resolveLevel(explicit?: string): string {
  if (explicit) return explicit;
  const env = process.env.LOG_LEVEL?.trim();
  if (env) return env;
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

function resolvePretty(explicit?: boolean): boolean {
  if (typeof explicit === 'boolean') return explicit;
  if (process.env.LOG_PRETTY === '1') return true;
  if (process.env.LOG_PRETTY === '0') return false;
  return process.env.NODE_ENV !== 'production';
}

function buildOptions(opts: CreateLoggerOptions): LoggerOptions {
  const base: LoggerOptions = {
    level: resolveLevel(opts.level),
    base: { service: opts.name ?? 'craiwl' },
    mixin() {
      const ctx = getLogContext();
      return ctx ? { ...ctx } : {};
    },
    formatters: {
      log(obj) {
        return redactRecord(obj) as Record<string, unknown>;
      },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };
  if (resolvePretty(opts.pretty)) {
    base.transport = {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' },
    };
  }
  return base;
}

export function createLogger(opts: CreateLoggerOptions = {}): Logger {
  return pino(buildOptions(opts));
}

/**
 * Returns the process-wide root logger, creating it lazily on first call.
 * Most code should prefer `getLogger(name)` which forks a child.
 */
export function rootLoggerInstance(): Logger {
  if (!rootLogger) rootLogger = createLogger();
  return rootLogger;
}

export function getLogger(name: string): Logger {
  return rootLoggerInstance().child({ component: name });
}
