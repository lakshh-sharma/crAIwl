import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MockLLMProvider } from './mock.js';
import { LLMError, type LLMTool } from './types.js';

const tool: LLMTool<{ greeting: string; count: number }> = {
  name: 'emit_greeting',
  description: 'Emit a greeting and a count.',
  inputSchema: {
    type: 'object',
    properties: { greeting: { type: 'string' }, count: { type: 'number' } },
    required: ['greeting', 'count'],
    additionalProperties: false,
  },
  outputSchema: z.object({ greeting: z.string(), count: z.number() }),
};

describe('MockLLMProvider', () => {
  it('runs the responder and returns the validated value with provenance', async () => {
    const llm = new MockLLMProvider(() => ({ greeting: 'hi', count: 2 }));
    const r = await llm.callStructured(tool, { messages: [{ role: 'user', content: 'hello' }] });
    expect(r.value).toEqual({ greeting: 'hi', count: 2 });
    expect(r.model).toBe('mock-llm');
  });

  it('records each call so tests can assert prompt contents', async () => {
    const llm = new MockLLMProvider(() => ({ greeting: 'hi', count: 1 }));
    await llm.callStructured(tool, {
      system: 'be friendly',
      messages: [{ role: 'user', content: 'hi there' }],
    });
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]!.tool).toBe('emit_greeting');
    expect(llm.calls[0]!.system).toBe('be friendly');
    expect(llm.calls[0]!.opts.messages[0]!.content).toBe('hi there');
  });

  it('rejects responder output that fails schema validation', async () => {
    const llm = new MockLLMProvider(() => ({ greeting: 'hi' /* missing count */ }));
    await expect(
      llm.callStructured(tool, { messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toThrow(LLMError);
  });

  it('passes the tool and opts into the responder so it can branch', async () => {
    let received: { name: string; userText: string } | undefined;
    const llm = new MockLLMProvider((t, opts) => {
      received = { name: t.name, userText: opts.messages[0]!.content };
      return { greeting: 'ok', count: 0 };
    });
    await llm.callStructured(tool, { messages: [{ role: 'user', content: 'compile-this' }] });
    expect(received).toEqual({ name: 'emit_greeting', userText: 'compile-this' });
  });
});
