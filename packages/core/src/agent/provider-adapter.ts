/**
 * agent/provider-adapter.ts — Adapter to use ModelProvider as the loop's model client.
 *
 * Wraps any ModelProvider (Ollama, OpenAI, Anthropic, Gemini) so the
 * AgentLoop can call it via a uniform `call({messages, tools, stream, ...})`
 * interface without caring about the underlying provider.
 *
 * Usage:
 *   import { createProviderBackedClientSync, ProviderBackedModelClient } from './provider-adapter.js';
 *   const client = new ProviderBackedModelClient(provider);
 *   const response = await client.call({ messages, tools });
 */

import { AnthropicProvider } from '../providers/anthropic.js';
import { OllamaProvider } from '../providers/ollama.js';
import { OpenAIProvider } from '../providers/openai.js';

import type { Message, ToolCall } from './types.js';
import type { ModelProvider, ModelResponse } from '../providers/ModelProvider.js';
import type { ReasoningEffort } from '../config/schema.js';

/** A single streaming chunk from the model. */
export interface ModelStreamChunk {
  contentDelta?: string;
  toolCallDeltas?: Array<{
    index: number;
    id?: string;
    name?: string;
    argumentsFragment?: string;
  }>;
  usage?: { inputTokens: number; outputTokens: number; thinkingTokens: number };
  finishReason?: string;
}

/** The response shape the AgentLoop expects from a model call. */
export interface ModelCallResponse {
  content: string;
  thinking: string;
  toolCalls: ToolCall[];
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  finishReason: string;
}

/**
 * Adapter that wraps a ModelProvider to present a uniform call interface.
 *
 * The AgentLoop only calls `client.call(...)`, so we only need to
 * implement that method.
 */
export class ProviderBackedModelClient {
  private provider: ModelProvider;

  constructor(provider: ModelProvider) {
    this.provider = provider;
  }

  /**
   * Call the model via the ModelProvider, converting types as needed.
   */
  async call(params: {
    messages: Message[];
    tools?: Array<{ type: 'function'; function: { name: string; description: string; parameters: unknown } }>;
    effort?: ReasoningEffort;
    stream?: boolean;
    onChunk?: (chunk: ModelStreamChunk) => void;
    signal?: AbortSignal;
  }): Promise<ModelCallResponse> {
    const { messages, tools, stream = true, onChunk, signal } = params;

    // Convert messages to provider format.
    const providerMessages = messages.map((m) => ({
      role: m.role as 'user' | 'assistant' | 'system' | 'tool',
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      toolCallId: m.toolCallId,
      toolName: m.toolName,
    }));

    // Convert tools to provider format.
    const providerTools = tools?.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters as Record<string, unknown>,
    }));

    // Build system prompt from the first system message (if any).
    const systemMessages = messages.filter((m) => m.role === 'system');
    const system = systemMessages.length > 0
      ? systemMessages.map((m) => typeof m.content === 'string' ? m.content : '').join('\n')
      : '';

    // Remove system messages from the provider messages (providers handle system separately).
    const nonSystemMessages = providerMessages.filter((m) => m.role !== 'system');

    // Call the provider.
    const response: ModelResponse = await this.provider.complete(
      nonSystemMessages,
      system,
      {
        tools: providerTools,
        onToken: stream && onChunk
          ? (token: string) => {
              onChunk({ contentDelta: token });
            }
          : undefined,
        signal,
      },
    );

    // Convert provider's response to ModelCallResponse.
    return {
      content: response.text,
      thinking: '',
      toolCalls: (response.toolCalls ?? []).map((tc) => ({
        id: tc.id,
        name: tc.name,
        arguments: typeof tc.input === 'string' ? tc.input : JSON.stringify(tc.input),
        status: 'pending' as const,
      })) as unknown as ToolCall[],
      inputTokens: response.inputTokens ?? 0,
      outputTokens: response.outputTokens ?? 0,
      thinkingTokens: 0,
      finishReason: response.toolCalls && response.toolCalls.length > 0 ? 'tool_calls' : 'stop',
    };
  }

  /** Returns the provider's model ID. */
  modelId(): string {
    return this.provider.modelId();
  }

  /** Providers don't support caching (only Anthropic does, and it's handled internally). */
  supportsCaching(): boolean {
    return this.provider.supportsCaching();
  }
}

/**
 * Check if the GOLI_DEFAULT_MODEL env var specifies a provider type.
 * Returns the provider type ('ollama', 'gemini', 'openai', 'anthropic') or null.
 */
export function getProviderTypeFromEnv(): string | null {
  const modelSpec = process.env.GOLI_DEFAULT_MODEL ?? '';
  if (!modelSpec) return null;
  const [providerType] = modelSpec.split('/');
  if (providerType && ['ollama', 'gemini', 'openai', 'anthropic'].includes(providerType)) {
    return providerType;
  }
  return null;
}

/**
 * Create a model client from the providers module (sync version).
 * Uses GOLI_DEFAULT_MODEL env var to determine which provider to use.
 * Returns null if the env var is not set.
 */
export function createProviderBackedClientSync(): ProviderBackedModelClient | null {
  const providerType = getProviderTypeFromEnv();
  if (!providerType) return null;

  const modelSpec = process.env.GOLI_DEFAULT_MODEL ?? '';
  const [, modelName] = modelSpec.split('/');

  if (providerType === 'ollama') {
    const provider = new OllamaProvider({
      baseUrl: process.env.OLLAMA_BASE_URL || 'https://ollama.com',
      model: modelName || 'gpt-oss:120b-cloud',
      apiKey: process.env.OLLAMA_API_KEY,
    });
    return new ProviderBackedModelClient(provider);
  }

  if (providerType === 'openai') {
    const provider = new OpenAIProvider({
      apiKey: process.env.OPENAI_API_KEY || '',
      model: modelName || 'gpt-4o',
    });
    return new ProviderBackedModelClient(provider);
  }

  if (providerType === 'anthropic') {
    const provider = new AnthropicProvider({
      apiKey: process.env.ANTHROPIC_API_KEY || '',
      model: modelName || 'claude-3-5-sonnet-20241022',
    });
    return new ProviderBackedModelClient(provider);
  }

  return null;
}

/**
 * Async version (supports all providers including Gemini).
 */
export async function createProviderBackedClient(): Promise<ProviderBackedModelClient | null> {
  const providerType = getProviderTypeFromEnv();
  if (!providerType) return null;

  const { createProvider } = await import('../providers/router.js');
  const provider = await createProvider();
  return new ProviderBackedModelClient(provider);
}
