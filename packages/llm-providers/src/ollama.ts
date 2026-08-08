/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ModelProvider, Message, ModelResponse, CompletionOptions, ToolCall } from './ModelProvider.js';

/**
 *
 */
export class OllamaProvider implements ModelProvider {
  private baseUrl: string;
  private model: string;
  private apiKey?: string;

  constructor(cfg: { baseUrl: string; model: string; apiKey?: string }) {
    this.baseUrl = cfg.baseUrl.replace(/\/$/, '');
    this.model = cfg.model;
    this.apiKey = cfg.apiKey;
  }

  async complete(
    messages: Message[],
    system: string,
    options?: CompletionOptions,
  ): Promise<ModelResponse> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const body: any = {
      model: this.model,
      messages: [
        { role: 'system', content: system },
        ...messages.map(m => ({
            role: m.role === 'tool' ? 'tool' : m.role,
            content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
        })),
      ],
      stream: !!options?.onToken,
    };

    if (options?.tools && options.tools.length > 0) {
      body.tools = options.tools.map((t: any) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters
        }
      }));
    }

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: options?.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      let msg = `Ollama error (${response.status}): ${errorText || response.statusText}`;
      if (response.status === 500) {
        msg += '\nTIP: If you are using Ollama Cloud, this might be a timeout or model load error. Try a smaller model (e.g., qwen2.5-coder:7b) or check https://ollama.com status.';
      }
      throw new Error(msg);
    }

    if (options?.onToken) {
        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body from Ollama');

        const decoder = new TextDecoder();
        let buffer = '';
        let fullText = '';
        const toolCalls: ToolCall[] = [];
        let inputTokens = 0;
        let outputTokens = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const json = JSON.parse(line);
                    if (json.message?.content) {
                        const content = json.message.content;
                        fullText += content;
                        options.onToken(content);
                    }
                    // Ollama sends token counts on the final `done: true` chunk.
                    if (typeof json.prompt_eval_count === 'number') inputTokens = json.prompt_eval_count;
                    if (typeof json.eval_count === 'number') outputTokens = json.eval_count;
                    if (json.message?.tool_calls) {
                        for (const tc of json.message.tool_calls) {
                            toolCalls.push({
                                id: tc.id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
                                // Defensive: `tc.function` may be undefined
                                // on a malformed response — was a `TypeError`.
                                name: tc.function?.name ?? '',
                                input: tc.function?.arguments ?? {},
                            });
                        }
                    }
                } catch (_e) {
                    // skip unparseable lines
                }
            }
        }
        return { text: fullText, toolCalls, costUsd: 0, inputTokens, outputTokens };
    } else {
        const json = await response.json() as any;
        const toolCalls: ToolCall[] = (json.message?.tool_calls || []).map((tc: any) => ({
            id: tc.id || `call_${Date.now()}`,
            name: tc.function?.name ?? '',
            input: tc.function?.arguments ?? {}
        }));
        return { 
            text: json.message.content || '', 
            toolCalls,
            costUsd: 0,
            inputTokens: json.prompt_eval_count ?? 0,
            outputTokens: json.eval_count ?? 0
        };
    }
  }

  modelId(): string {
    return `ollama/${this.model}`;
  }

  supportsCaching(): boolean {
    return false;
  }
}
