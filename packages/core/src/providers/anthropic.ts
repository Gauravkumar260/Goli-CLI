/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ModelProvider, Message, ModelResponse, CompletionOptions, ToolCall } from './ModelProvider.js';

/**
 *
 */
export class AnthropicProvider implements ModelProvider {
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(cfg: { apiKey: string; model: string }) {
    this.apiKey = cfg.apiKey;
    this.model = cfg.model;
    this.baseUrl = 'https://api.anthropic.com/v1';
  }

  async complete(
    messages: Message[],
    system: string,
    options?: CompletionOptions,
  ): Promise<ModelResponse> {
    const body: Record<string, unknown> = {
      model: this.model,
      system,
      messages: messages.map(m => {
        if (m.role === 'system') return null;
        if (m.role === 'tool') {
          return {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: m.toolCallId,
                content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
              },
            ],
          };
        }
        return {
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        };
      }).filter(Boolean),
      max_tokens: options?.maxTokens ?? 8192,
      stream: !!options?.onToken,
    };

    if (options?.tools && options.tools.length > 0) {
      body.tools = options.tools.map((t: any) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }

    const response = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: options?.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic error (${response.status}): ${errorText || response.statusText}`);
    }

    if (options?.onToken) {
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body from Anthropic');

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
          if (!trimmed.startsWith('data:') || trimmed === 'data: [DONE]') continue;
          try {
            const json = JSON.parse(trimmed.slice(5).trim());
            if (json.type === 'content_block_delta' && json.delta?.text) {
              fullText += json.delta.text;
              options.onToken(json.delta.text);
            }
            if (json.type === 'content_block_start' && json.content_block?.type === 'tool_use') {
              toolCalls.push({
                id: json.content_block.id || `call_${Date.now()}`,
                name: json.content_block.name,
                input: json.content_block.input || {},
              });
            }
          } catch {
            // skip unparseable lines
          }
        }
      }
      return { text: fullText, toolCalls, costUsd: 0 };
    }

    const json = (await response.json()) as any;
    let text = '';
    const toolCalls: ToolCall[] = [];

    for (const block of json.content || []) {
      if (block.type === 'text') text += block.text;
      if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          input: block.input || {},
        });
      }
    }

    const inputTokens = json.usage?.input_tokens || 0;
    const outputTokens = json.usage?.output_tokens || 0;

    return { text, toolCalls, costUsd: 0, inputTokens, outputTokens };
  }

  modelId(): string {
    return `anthropic/${this.model}`;
  }

  supportsCaching(): boolean {
    return true;
  }
}
