/**
 * Provider module public exports.
 *
 * MockProvider is exported alongside the real providers so tests can
 * construct it directly (the previous barrel omitted it, leaving it
 * accessible only via deep imports — MEDIUM-64).
 */
export { GeminiProvider } from './gemini.js';
/**
 *
 */
export { OllamaProvider } from './ollama.js';
/**
 *
 */
export { OpenAIProvider } from './openai.js';
/**
 *
 */
export { AnthropicProvider } from './anthropic.js';
/**
 *
 */
export { MockProvider } from './mock.js';
/**
 *
 */
export { buildProvider } from './config.js';
/**
 *
 */
export { createProvider, getDefaultModelSpec, isProviderLegallyBlocked } from './router.js';
/**
 *
 */
export type { ModelSpec } from './router.js';
/**
 *
 */
export type { ModelProvider, ProviderConfig, Message, ToolCall, ModelResponse, CompletionOptions } from './ModelProvider.js';
