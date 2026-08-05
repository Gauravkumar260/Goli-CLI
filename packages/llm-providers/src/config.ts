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
    case 'mock': {
      // The previous implementation had NO 'mock' case, so calling
      // `buildProvider({ type: 'mock', ... })` fell through to the
      // default branch and threw "Unknown provider type: mock". The
      // MockProvider class exists and is used in tests, but could
      // only be instantiated directly (not via the factory).
      const { MockProvider } = await import('./mock.js');
      return new MockProvider(cfg);
    }
    default: {
      // Exhaustiveness check — if a new ProviderConfig variant is
      // added without a case above, TypeScript flags this as a type
      // error (the `_exhaustive` variable has type `never`).
      const _exhaustive: never = cfg;
      throw new Error(`Unknown provider type: ${String((_exhaustive as any).type)}`);
    }
  }
}
