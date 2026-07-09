/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ModelProvider, Message, ModelResponse, CompletionOptions, ToolCall } from './ModelProvider.js';

/**
 *
 */
export class OpenAIProvider implements ModelProvider {
  private baseUrl: string;
  private model: string;
  private apiKey: string;

  constructor(cfg: { apiKey: string; model: string; baseUrl?: string }) {
    this.apiKey = cfg.apiKey;
    this.model = cfg.model;
    this.baseUrl = (cfg.baseUrl && cfg.baseUrl !== '' ? cfg.baseUrl : 'https://api.openai.com/v1').replace(/\/$/, '');
  }

  async complete(
    messages: Message[],
    system: string,
    options?: CompletionOptions,
  ): Promise<ModelResponse> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: [
        { role: 'system', content: system },
        ...messages.map(m => ({
          role: m.role === 'tool' ? 'tool' : m.role,
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
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
          parameters: t.parameters,
        },
      }));
    }

    if (options?.maxTokens) {
      body.max_tokens = options.maxTokens;
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: options?.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI error (${response.status}): ${errorText || response.statusText}`);
    }

    if (options?.onToken) {
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body from OpenAI');

      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';
      const toolCalls: ToolCall[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:') || trimmed === 'data: [DONE]') continue;

          try {
            const json = JSON.parse(trimmed.slice(5).trim());
            const delta = json.choices?.[0]?.delta;
            if (delta?.content) {
              fullText += delta.content;
              options.onToken(delta.content);
            }
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                toolCalls.push({
                  id: tc.id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
                  name: tc.function?.name || '',
                  input: tc.function?.arguments || {},
                });
              }
            }
          } catch {
            // skip unparseable lines
          }
        }
      }
      return { text: fullText, toolCalls, costUsd: 0 };
    }

    const json = (await response.json()) as any;
    const choice = json.choices?.[0];
    const toolCalls: ToolCall[] = (choice?.message?.tool_calls || []).map((tc: any) => ({
      id: tc.id || `call_${Date.now()}`,
      name: tc.function.name,
      input: (() => {
        try { return JSON.parse(tc.function.arguments); } catch { return tc.function.arguments; }
      })(),
    }));

    return {
      text: choice?.message?.content || '',
      toolCalls,
      costUsd: 0,
    };
  }

  modelId(): string {
    return `openai/${this.model}`;
  }

  supportsCaching(): boolean {
    return true;
  }
}
