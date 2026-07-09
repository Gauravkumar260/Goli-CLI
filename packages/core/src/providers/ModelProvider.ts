/**
 *
 */
export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool' | 'model';
  content: string | unknown;
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
 *
 */
export type ProviderConfig =
  | { type: 'anthropic'; apiKey: string; model: string }
  | { type: 'openai';   apiKey: string; model: string }
  | { type: 'gemini';   apiKey: string; model: string }
  | { type: 'ollama';   baseUrl: string; model: string; apiKey?: string };
