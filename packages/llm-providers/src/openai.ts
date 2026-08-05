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
    // Build the messages array. The previous implementation
    // ALWAYS prepended a system message — if the caller's
    // `messages` already included one (common in the agent loop),
    // OpenAI received two system messages. OpenAI merges them but
    // this is wasteful and can cause unexpected prompt behavior.
    // We now only prepend if the caller didn't include a system
    // message.
    const hasSystem = messages.some(m => m.role === 'system');
    const messagesArray: Array<{ role: string; content: string }> = [];
    if (!hasSystem && system) {
      messagesArray.push({ role: 'system', content: system });
    }
    for (const m of messages) {
      messagesArray.push({
        // Removed dead ternary `m.role === 'tool' ? 'tool' : m.role`
        // (returns `m.role` in both branches — was a no-op).
        role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      });
    }
    const body: Record<string, unknown> = {
      model: this.model,
      messages: messagesArray,
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

    // Retry on 429 / 5xx with exponential backoff. The previous
    // implementation issued a single `fetch` with no retry, so a
    // transient 429 from OpenAI would fail the entire agent
    // iteration. We retry up to 3 times with 500ms / 1s / 2s backoff.
    // We also enforce a 60s default timeout (in addition to the
    // caller-supplied signal) so a hung connection fails fast.
    const maxRetries = 3;
    const baseDelayMs = 500;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // Per-attempt timeout via AbortController. We compose with
      // the caller's signal so either source aborts the fetch.
      const timeoutAc = new AbortController();
      const timeoutMs = 60_000;
      const timer = setTimeout(() => timeoutAc.abort(), timeoutMs);
      // If the caller's signal aborts, abort our controller too.
      const onCallerAbort = () => timeoutAc.abort();
      if (options?.signal) {
        if (options.signal.aborted) timeoutAc.abort();
        else options.signal.addEventListener('abort', onCallerAbort, { once: true });
      }
      try {
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: timeoutAc.signal,
        });

        if (!response.ok) {
          const errorText = await response.text();
          // Retry on 429 (rate limit) and 5xx (server errors). Don't
          // retry on 4xx (client errors — bad request, auth).
          const retryable = response.status === 429 || (response.status >= 500 && response.status < 600);
          if (retryable && attempt < maxRetries) {
            // Honor Retry-After header if present.
            const retryAfter = response.headers.get('Retry-After');
            const delayMs = retryAfter
              ? Math.min(parseInt(retryAfter, 10) * 1000, 30_000)
              : baseDelayMs * Math.pow(2, attempt);
            await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
            continue;
          }
          throw new Error(`OpenAI error (${response.status}): ${errorText || response.statusText}`);
        }

        return await this.handleResponse(response, options);
      } catch (err) {
        lastErr = err;
        // Don't retry on AbortError (caller cancelled).
        if (err instanceof Error && err.name === 'AbortError' && options?.signal?.aborted) {
          throw err;
        }
        // Retry on network errors (TypeError: fetch failed).
        if (attempt < maxRetries) {
          const delayMs = baseDelayMs * Math.pow(2, attempt);
          await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
          continue;
        }
        throw err;
      } finally {
        clearTimeout(timer);
        if (options?.signal) {
          options.signal.removeEventListener('abort', onCallerAbort);
        }
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('OpenAI fetch failed (no retries left)');
  }

  /** Handle the response — extracted so the retry loop can call it. */
  private async handleResponse(
    response: Response,
    options?: CompletionOptions,
  ): Promise<ModelResponse> {
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
      // Defensive: `tc.function` may be undefined on a malformed response.
      name: tc.function?.name ?? '',
      input: (() => {
        // The previous implementation returned the raw string on
        // parse failure (`catch { return tc.function.arguments; }`)
        // — but `ToolCall.input` is typed `Record<string, unknown>`.
        // A string is not a Record. Downstream code that does
        // `tc.input.someField` would crash with "cannot read
        // properties of string". We now fall back to an empty
        // object on parse failure (matches the type contract).
        try { return JSON.parse(tc.function?.arguments ?? '{}'); } catch { return {}; }
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
