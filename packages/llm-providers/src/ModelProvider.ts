/**
 *
 */
export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool' | 'model';
  /**
   * Message content. May be a plain string (the common case) or a
   * structured content array (OpenAI/Anthropic multimodal format:
   * `[{ type: 'text', text }, { type: 'image_url', image_url: {...} }]`).
   *
   * The previous typing `string | unknown` collapsed to `unknown`
   * (since `unknown` is the supertype of every type), which meant
   * callers got NO type-safety on the content field. We now type it
   * as `string | unknown[]` — the two shapes that actually appear in
   * practice — and consumers can narrow via `Array.isArray(content)`.
   */
  content: string | unknown[];
  toolCallId?: string;
  toolName?: string;
}

/**
 *
 */
export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 *
 */
export interface ModelResponse {
  text: string;
  toolCalls?: ToolCall[];
  isFinalAnswer?: boolean;
  costUsd: number;
  inputTokens?: number;
  outputTokens?: number;
}

/**
 *
 */
export interface CompletionOptions {
  tools?: unknown[];
  onToken?: (token: string) => void;
  maxTokens?: number;
  signal?: AbortSignal;
}

/**
 *
 */
export interface ModelProvider {
  complete(
    messages: Message[],
    system: string,
    options?: CompletionOptions
  ): Promise<ModelResponse>;
  modelId(): string;
  supportsCaching(): boolean;
}

/**
 * Provider configuration union.
 *
 * The previous union omitted the `'mock'` provider type, even though
 * `MockProvider` exists in `./mock.ts` and is used in tests. Adding
 * `'mock'` here lets `buildProvider` switch on it (MEDIUM-63) and
 * lets callers construct a `ProviderConfig` for the mock provider
 * without casting.
 */
export type ProviderConfig =
  | { type: 'anthropic'; apiKey: string; model: string }
  | { type: 'openai';   apiKey: string; model: string }
  | { type: 'gemini';   apiKey: string; model: string }
  | { type: 'ollama';   baseUrl: string; model: string; apiKey?: string }
  | { type: 'mock';     model: string; responses?: string[] };
