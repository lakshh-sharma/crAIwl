/**
 * LLM provider abstraction.
 *
 * The compile phase and the self-heal loop both lean on an LLM that emits
 * structured, schema-validated output. Wrapping the call site behind this
 * interface lets us swap providers, mock the API in unit tests, and pin the
 * model identity per call so every generated artifact carries provenance.
 */

import type { ZodType } from 'zod';

export type LLMRole = 'user' | 'assistant';

export type LLMMessage = {
  role: LLMRole;
  content: string;
};

/**
 * A structured-output tool. The provider forces the model to emit `name`'s
 * input matching `inputSchema` (JSON Schema), and the caller-supplied Zod
 * schema validates it before the value is returned. The two schemas should
 * describe the same shape — JSON Schema for the model, Zod for the runtime.
 */
export type LLMTool<T> = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: ZodType<T>;
};

export type LLMCallOptions = {
  /** System prompt. */
  system?: string;
  /** Message history. */
  messages: LLMMessage[];
  /** Max output tokens. Default 4096. */
  maxTokens?: number;
  /** Sampling temperature, 0..1. Default 0 for determinism. */
  temperature?: number;
  /** Caller-controlled cancellation. */
  signal?: AbortSignal;
};

export type LLMUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type LLMStructuredResult<T> = {
  /** Parsed + validated tool input. */
  value: T;
  /** Raw tool-use block from the provider, kept for debugging. */
  raw: unknown;
  usage: LLMUsage;
  /** Model identifier that produced this response, used as provenance. */
  model: string;
};

export interface LLMProvider {
  /** Model identifier (e.g. "claude-sonnet-4-6"). Recorded on every artifact this provider generates. */
  readonly model: string;
  callStructured<T>(tool: LLMTool<T>, opts: LLMCallOptions): Promise<LLMStructuredResult<T>>;
}

export class LLMError extends Error {
  override readonly name = 'LLMError';
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
  }
}
