/**
 * A local model through Ollama (decision D2: emergency data never leaves the
 * machine). Talks only to localhost.
 */
import { ChatMessage, ChatModel } from './agent';
import { ToolCall, ToolSpec } from './gate';

export class OllamaModel implements ChatModel {
  constructor(
    readonly name: string,
    private readonly baseUrl = 'http://127.0.0.1:11434',
    private readonly timeoutMs = 180_000,
  ) {
    const host = new URL(baseUrl).hostname;
    if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('OllamaModel only talks to this machine');
  }

  async chat(messages: ChatMessage[], tools: readonly ToolSpec[]): Promise<{ content: string; toolCalls: ToolCall[] }> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({
          model: this.name,
          stream: false,
          options: { temperature: 0 },
          messages,
          tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })),
        }),
      });
      if (!res.ok) throw new Error(`ollama ${res.status}`);
      const body = (await res.json()) as {
        message?: { content?: string; tool_calls?: { function?: { name?: string; arguments?: unknown } }[] };
      };
      const calls: ToolCall[] = (body.message?.tool_calls ?? []).map((c) => {
        let args: unknown = c.function?.arguments ?? {};
        if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
        return { name: String(c.function?.name ?? ''), args: (args && typeof args === 'object' ? args : {}) as Record<string, unknown> };
      });
      return { content: body.message?.content ?? '', toolCalls: calls };
    } finally {
      clearTimeout(timer);
    }
  }
}
