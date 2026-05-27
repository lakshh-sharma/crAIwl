import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AnthropicProvider } from './anthropic.js';
import { LLMError, type LLMTool } from './types.js';

const tool: LLMTool<{ ok: boolean; message: string }> = {
  name: 'emit_status',
  description: 'Emit a status.',
  inputSchema: {
    type: 'object',
    properties: { ok: { type: 'boolean' }, message: { type: 'string' } },
    required: ['ok', 'message'],
    additionalProperties: false,
  },
  outputSchema: z.object({ ok: z.boolean(), message: z.string() }),
};

const fakeClient = (response: unknown) =>
  ({
    messages: {
      create: vi.fn(async () => response),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

describe('AnthropicProvider', () => {
  it('passes the tool through and returns the validated value', async () => {
    const client = fakeClient({
      content: [{ type: 'tool_use', name: 'emit_status', input: { ok: true, message: 'hi' } }],
      usage: { input_tokens: 12, output_tokens: 4 },
    });
    const provider = new AnthropicProvider({ client, model: 'claude-sonnet-4-6' });
    const r = await provider.callStructured(tool, {
      messages: [{ role: 'user', content: 'go' }],
    });
    expect(r.value).toEqual({ ok: true, message: 'hi' });
    expect(r.usage).toEqual({ inputTokens: 12, outputTokens: 4 });
    expect(r.model).toBe('claude-sonnet-4-6');

    const callArgs = client.messages.create.mock.calls[0]![0] as Record<string, unknown>;
    expect(callArgs['tool_choice']).toEqual({ type: 'tool', name: 'emit_status' });
    expect((callArgs['tools'] as Array<{ name: string }>)[0]!.name).toBe('emit_status');
  });

  it('throws LLMError when the response has no matching tool_use block', async () => {
    const client = fakeClient({
      content: [{ type: 'text', text: 'I cannot do that' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const provider = new AnthropicProvider({ client });
    await expect(
      provider.callStructured(tool, { messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toThrow(LLMError);
  });

  it('throws LLMError when tool input fails the Zod schema', async () => {
    const client = fakeClient({
      content: [{ type: 'tool_use', name: 'emit_status', input: { ok: 'not-a-bool' } }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const provider = new AnthropicProvider({ client });
    await expect(
      provider.callStructured(tool, { messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toThrow(LLMError);
  });

  it('wraps SDK errors in LLMError preserving the cause', async () => {
    const cause = new Error('429 overloaded');
    const client = {
      messages: {
        create: vi.fn(async () => {
          throw cause;
        }),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const provider = new AnthropicProvider({ client });
    await expect(
      provider.callStructured(tool, { messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toMatchObject({ name: 'LLMError', cause });
  });

  it('requires an apiKey when no client is injected', () => {
    const prevKey = process.env['ANTHROPIC_API_KEY'];
    delete process.env['ANTHROPIC_API_KEY'];
    try {
      expect(() => new AnthropicProvider()).toThrow(LLMError);
    } finally {
      if (prevKey !== undefined) process.env['ANTHROPIC_API_KEY'] = prevKey;
    }
  });
});
