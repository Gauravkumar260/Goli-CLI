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
      messages: normalizeAnthropicMessages(messages.map(m => {
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
          } as { role: string; content: unknown };
        }
        return {
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        } as { role: string; content: unknown };
      }).filter((m): m is { role: string; content: unknown } => m !== null)),
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
            // Tool-call input: Anthropic streams the tool input as
            // `input_json_delta` events containing `partial_json`
            // strings that must be concatenated and parsed at the
            // END of the content_block. The previous implementation
            // only captured the initial empty `input: {}` from
            // `content_block_start` and never processed
            // `input_json_delta` events. As a result, every
            // streaming tool call had `input: {}` — the agent
            // never saw the tool arguments.
            if (
              json.type === 'content_block_start' &&
              json.content_block?.type === 'tool_use'
            ) {
              toolCalls.push({
                id: json.content_block.id || `call_${Date.now()}`,
                name: json.content_block.name,
                input: {}, // will be filled by input_json_delta events
                _inputBuffer: '', // accumulator (private field)
              } as ToolCall & { _inputBuffer: string });
            }
            if (json.type === 'content_block_delta' && json.delta?.type === 'input_json_delta') {
              // Append the partial_json string to the LAST tool
              // call's accumulator.
              const lastCall = toolCalls[toolCalls.length - 1] as
                | (ToolCall & { _inputBuffer?: string })
                | undefined;
              if (lastCall && typeof lastCall._inputBuffer === 'string') {
                lastCall._inputBuffer += json.delta.partial_json ?? '';
              }
            }
            if (json.type === 'content_block_stop') {
              // End of a content block — if the last tool call has
              // an accumulated input buffer, parse it now.
              const lastCall = toolCalls[toolCalls.length - 1] as
                | (ToolCall & { _inputBuffer?: string })
                | undefined;
              if (lastCall && lastCall._inputBuffer && lastCall._inputBuffer.length > 0) {
                try {
                  lastCall.input = JSON.parse(lastCall._inputBuffer);
                } catch {
                  // Malformed partial_json — leave as the empty
                  // object from content_block_start.
                }
                delete lastCall._inputBuffer;
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

/**
 * Anthropic's API requires alternating `user` / `assistant` roles.
 * Tool messages are mapped to `user` (with a `tool_result` content
 * block), so two consecutive `user` messages can occur when a
 * user message follows a tool message (common in multi-turn agent
 * loops). Anthropic may reject this or silently merge in
 * unexpected ways.
 *
 * We detect and merge consecutive `user` messages into a single
 * `user` message with concatenated content. Content-block arrays
 * are concatenated; string content is joined with a newline.
 */
function normalizeAnthropicMessages<T extends { role: string; content: unknown }>(messages: T[]): T[] {
  if (messages.length < 2) return messages;
  const out: T[] = [messages[0]!];
  for (let i = 1; i < messages.length; i++) {
    const prev = out[out.length - 1]!;
    const cur = messages[i]!;
    if (prev.role === 'user' && cur.role === 'user') {
      // Merge — concatenate content blocks if both are arrays;
      // join with newline if both are strings; mixed (one
      // array + one string) — wrap the string in a text block.
      const prevContent = prev.content;
      const curContent = cur.content;
      if (Array.isArray(prevContent) && Array.isArray(curContent)) {
        prev.content = [...prevContent, ...curContent];
      } else if (typeof prevContent === 'string' && typeof curContent === 'string') {
        prev.content = prevContent + '\n' + curContent;
      } else {
        // Mixed — normalize both to arrays.
        const prevArr = Array.isArray(prevContent) ? prevContent : [{ type: 'text', text: prevContent }];
        const curArr = Array.isArray(curContent) ? curContent : [{ type: 'text', text: curContent }];
        prev.content = [...prevArr, ...curArr];
      }
    } else {
      out.push(cur);
    }
  }
  return out;
}
