import { z } from 'zod';
import { strategyConfig } from './types.js';

/**
 * JSON Schema generated from the Zod source of truth. Exported so external
 * consumers (CLI, hosted clients, the compile prompt's Structured Outputs
 * mode) can validate a config without depending on Zod.
 *
 * Drift between the Zod schema and this constant is impossible — it's
 * derived at module load. Tests confirm the well-known example from the
 * design doc round-trips through both.
 */
export const STRATEGY_CONFIG_JSON_SCHEMA = z.toJSONSchema(strategyConfig, {
  target: 'draft-2020-12',
});

/**
 * Convenience: parse a candidate config and return the typed value, or
 * throw a ZodError describing every violation. Use this at trust boundaries
 * (DB load, JSON import, LLM tool-call response). Inside trusted code,
 * prefer the already-validated `StrategyConfig` type.
 */
export function parseStrategyConfig(input: unknown) {
  return strategyConfig.parse(input);
}

export function safeParseStrategyConfig(input: unknown) {
  return strategyConfig.safeParse(input);
}
