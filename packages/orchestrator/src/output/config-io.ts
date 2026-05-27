/**
 * StrategyConfig export/import.
 *
 * A config IS the exportable, schedulable asset of the system — once compile
 * has produced one, the user owns it and can rerun without paying LLM tokens
 * again. Export wraps the config in a small envelope so import can validate
 * the schema version and surface a clear error on mismatch.
 */

import {
  parseStrategyConfig,
  safeParseStrategyConfig,
  STRATEGY_CONFIG_VERSION,
  isStrategyVersionCompatible,
  type StrategyConfig,
} from '@craiwl/core';

export type ConfigEnvelope = {
  $schema: 'craiwl-strategy-config';
  envelopeVersion: 1;
  exportedAt: string;
  config: StrategyConfig;
};

export class ConfigImportError extends Error {
  override readonly name = 'ConfigImportError';
  readonly details: string | undefined;
  constructor(message: string, details?: string) {
    super(message);
    this.details = details;
  }
}

export function exportConfig(config: StrategyConfig, now?: () => Date): string {
  const envelope: ConfigEnvelope = {
    $schema: 'craiwl-strategy-config',
    envelopeVersion: 1,
    exportedAt: (now ?? (() => new Date()))().toISOString(),
    config,
  };
  return `${JSON.stringify(envelope, null, 2)}\n`;
}

export function importConfig(serialized: string): StrategyConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (err) {
    throw new ConfigImportError('config file is not valid JSON', (err as Error).message);
  }

  if (!isEnvelope(parsed)) {
    // Try parsing as a bare config — some callers (CI, scripts) may not wrap.
    const direct = safeParseStrategyConfig(parsed);
    if (!direct.success) {
      throw new ConfigImportError(
        'file is not a craiwl config envelope and does not parse as a StrategyConfig',
        direct.error.message,
      );
    }
    return direct.data;
  }

  if (!isStrategyVersionCompatible(parsed.config.strategyVersion)) {
    throw new ConfigImportError(
      `config strategyVersion ${parsed.config.strategyVersion} is incompatible with current ${STRATEGY_CONFIG_VERSION}`,
    );
  }

  // Round-trip through the canonical parser so any drift in the file is caught.
  return parseStrategyConfig(parsed.config);
}

function isEnvelope(value: unknown): value is ConfigEnvelope {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    v['$schema'] === 'craiwl-strategy-config' &&
    typeof v['envelopeVersion'] === 'number' &&
    typeof v['config'] === 'object'
  );
}
