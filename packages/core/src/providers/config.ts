/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ModelProvider, ProviderConfig } from './ModelProvider.js';

/**
 * Build a provider instance from a ProviderConfig.
 * Uses dynamic imports so unused provider packages (e.g. @google/generative-ai)
 * are only loaded when that provider is actually used.
 *
 * @param cfg
 */
export async function buildProvider(cfg: ProviderConfig): Promise<ModelProvider> {
  switch (cfg.type) {
    case 'gemini': {
      const { GeminiProvider } = await import('./gemini.js');
      return new GeminiProvider(cfg);
    }
    case 'ollama': {
      const { OllamaProvider } = await import('./ollama.js');
      return new OllamaProvider(cfg);
    }
    case 'anthropic': {
      const { AnthropicProvider } = await import('./anthropic.js');
      return new AnthropicProvider(cfg);
    }
    case 'openai': {
      const { OpenAIProvider } = await import('./openai.js');
      return new OpenAIProvider(cfg);
    }
    default:
      throw new Error(`Unknown provider type: ${(cfg as any).type}`);
  }
}
