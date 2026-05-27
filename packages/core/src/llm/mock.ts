import {
  LLMError,
  type LLMProvider,
  type LLMTool,
  type LLMCallOptions,
  type LLMStructuredResult,
} from './types.js';

/**
 * Per-call responder. Receives the tool the caller is asking the model to
 * use plus the call options, returns the raw value the "model" would have
 * emitted. The value is then validated through `tool.outputSchema` exactly
 * like a real provider response.
 */
export type MockResponder = (tool: LLMTool<unknown>, opts: LLMCallOptions) => unknown;

/**
 * In-process LLM provider for unit tests. Records every call so assertions
 * can check what prompts were sent.
 */
export class MockLLMProvider implements LLMProvider {
  readonly model: string;
  readonly calls: Array<{ tool: string; opts: LLMCallOptions; system?: string }> = [];

  constructor(
    private readonly responder: MockResponder,
    model = 'mock-llm',
  ) {
    this.model = model;
  }

  async callStructured<T>(tool: LLMTool<T>, opts: LLMCallOptions): Promise<LLMStructuredResult<T>> {
    const entry: { tool: string; opts: LLMCallOptions; system?: string } = {
      tool: tool.name,
      opts,
    };
    if (opts.system) entry.system = opts.system;
    this.calls.push(entry);

    const raw = this.responder(tool as LLMTool<unknown>, opts);
    const parsed = tool.outputSchema.safeParse(raw);
    if (!parsed.success) {
      throw new LLMError(
        `MockLLMProvider responder returned invalid output for tool "${tool.name}": ${parsed.error.message}`,
      );
    }
    return {
      value: parsed.data,
      raw,
      usage: { inputTokens: 0, outputTokens: 0 },
      model: this.model,
    };
  }
}
