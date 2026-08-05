 
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
 * Provider types that are LEGALLY blocked from use in this build.
 *
 * OpenAI is blocked per the org's legal review (HIGH-71). The router
 * refuses to construct an OpenAI provider even if the user configures
 * one — this prevents accidental use. The previous implementation
 * happily constructed an OpenAI provider (with an empty API key from
 * `process.env.OPENAI_API_KEY || ''`), silently producing a provider
 * that would fail at call time with a confusing 401 error.
 */
const LEGALLY_BLOCKED_PROVIDERS = new Set(['openai']);

/**
 *
 */
export function isProviderLegallyBlocked(providerType: string): boolean {
  return LEGALLY_BLOCKED_PROVIDERS.has(providerType);
}

/**
 *
 * @param spec
 */
export async function createProvider(spec?: ModelSpec): Promise<ModelProvider> {
  const modelSpec = spec || getDefaultModelSpec();
  // Use `indexOf` (not `split('/')` then `[0]`) so a model name like
  // `ollama/foo/bar` (where `foo/bar` is the model ID) splits correctly.
  // The previous implementation did `modelSpec.split('/')` which split
  // on EVERY slash, so `ollama/foo/bar` produced `['ollama', 'foo',
  // 'bar']` and `modelName` was just `'foo'` (losing the `/bar` part).
  const slashIdx = modelSpec.indexOf('/');
  const providerType = slashIdx === -1 ? modelSpec : modelSpec.slice(0, slashIdx);
  const modelName = slashIdx === -1 ? '' : modelSpec.slice(slashIdx + 1);

  // Legal gate (MEDIUM-62). The previous implementation happily
  // constructed legally-blocked providers (e.g. OpenAI), then failed
  // at call time with a confusing auth error. We now refuse up front
  // with a clear error message.
  if (isProviderLegallyBlocked(providerType)) {
    throw new Error(
      `Provider "${providerType}" is legally blocked in this build and cannot be used. ` +
        `Pick a different provider (gemini, ollama, anthropic) or contact legal@ for review.`,
    );
  }

  if (providerType === 'gemini') {
    const apiKey = process.env.GEMINI_API_KEY || '';
    if (!apiKey) {
      throw new Error(
        'Gemini provider requires GEMINI_API_KEY environment variable. Set it and retry.',
      );
    }
    return buildProvider({
      type: 'gemini',
      apiKey,
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

  if (providerType === 'anthropic') {
    const apiKey = process.env.ANTHROPIC_API_KEY || '';
    if (!apiKey) {
      throw new Error(
        'Anthropic provider requires ANTHROPIC_API_KEY environment variable. Set it and retry.',
      );
    }
    return buildProvider({
      type: 'anthropic',
      apiKey,
      model: modelName || 'claude-3-5-sonnet-20241022',
    });
  }

  if (providerType === 'mock') {
    return buildProvider({ type: 'mock', model: modelName || 'mock-model' });
  }

  throw new Error(`Unsupported provider type: ${providerType}`);
}
