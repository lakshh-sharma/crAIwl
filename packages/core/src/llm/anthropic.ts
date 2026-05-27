import Anthropic from '@anthropic-ai/sdk';
import {
  LLMError,
  type LLMProvider,
  type LLMTool,
  type LLMCallOptions,
  type LLMStructuredResult,
} from './types.js';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TOKENS = 4096;

export type AnthropicProviderOptions = {
  /** API key. Falls back to ANTHROPIC_API_KEY. */
  apiKey?: string;
  /** Model identifier. Defaults to claude-sonnet-4-6. */
  model?: string;
  /** Inject a preconstructed SDK client (used in tests). */
  client?: Anthropic;
};

/**
 * Anthropic-backed LLM provider. Uses tool-use mode so the model is forced
 * to emit a single structured response matching the caller's schema.
 */
export class AnthropicProvider implements LLMProvider {
  readonly model: string;
  private readonly client: Anthropic;

  constructor(opts: AnthropicProviderOptions = {}) {
    this.model = opts.model ?? DEFAULT_MODEL;
    if (opts.client) {
      this.client = opts.client;
    } else {
      const apiKey = opts.apiKey ?? process.env['ANTHROPIC_API_KEY'];
      if (!apiKey) {
        throw new LLMError('AnthropicProvider requires an apiKey or ANTHROPIC_API_KEY env var');
      }
      this.client = new Anthropic({ apiKey });
    }
  }

  async callStructured<T>(tool: LLMTool<T>, opts: LLMCallOptions): Promise<LLMStructuredResult<T>> {
    let response: Anthropic.Message;
    try {
      const params: Anthropic.MessageCreateParamsNonStreaming = {
        model: this.model,
        max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: opts.temperature ?? 0,
        tools: [
          {
            name: tool.name,
            description: tool.description,
            input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
          },
        ],
        tool_choice: { type: 'tool', name: tool.name },
        messages: opts.messages.map((m) => ({ role: m.role, content: m.content })),
        ...(opts.system ? { system: opts.system } : {}),
      };
      response = await this.client.messages.create(params, {
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
    } catch (err) {
      throw new LLMError(`Anthropic request failed: ${(err as Error).message}`, { cause: err });
    }

    const toolUse = response.content.find(
      (c): c is Anthropic.ToolUseBlock => c.type === 'tool_use' && c.name === tool.name,
    );
    if (!toolUse) {
      throw new LLMError(`Anthropic response did not include tool_use for "${tool.name}"`);
    }
    const parsed = tool.outputSchema.safeParse(toolUse.input);
    if (!parsed.success) {
      throw new LLMError(`Tool output failed schema validation: ${parsed.error.message}`);
    }
    return {
      value: parsed.data,
      raw: toolUse,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      model: this.model,
    };
  }
}
