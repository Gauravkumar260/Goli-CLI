 
import { buildProvider } from './config.js';

import type { ModelProvider } from './ModelProvider.js';

/**
 *
 */
export type ModelSpec = string;

const DEFAULT_MODEL = process.env.GOLI_DEFAULT_MODEL || 'ollama/gpt-oss:120b-cloud';

/**
 *
 */
export function getDefaultModelSpec(): ModelSpec {
  return DEFAULT_MODEL;
}

/**
 *
 * @param spec
 */
export async function createProvider(spec?: ModelSpec): Promise<ModelProvider> {
  const modelSpec = spec || getDefaultModelSpec();
  const [providerType, modelName] = modelSpec.split('/');

  if (providerType === 'gemini') {
    return buildProvider({
      type: 'gemini',
      apiKey: process.env.GEMINI_API_KEY || '',
      model: modelName || 'gemini-2.0-flash',
    });
  }

  if (providerType === 'ollama') {
    return buildProvider({
      type: 'ollama',
      baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
      model: modelName || 'gpt-oss:120b-cloud',
      apiKey: process.env.OLLAMA_API_KEY,
    });
  }

  if (providerType === 'openai') {
    return buildProvider({
      type: 'openai',
      apiKey: process.env.OPENAI_API_KEY || '',
      model: modelName || 'gpt-4o',
    });
  }

  if (providerType === 'anthropic') {
    return buildProvider({
      type: 'anthropic',
      apiKey: process.env.ANTHROPIC_API_KEY || '',
      model: modelName || 'claude-3-5-sonnet-20241022',
    });
  }

  throw new Error(`Unsupported provider type: ${providerType}`);
}
