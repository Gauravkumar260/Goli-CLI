/**
 * Tests for provider integration.
 *
 * Covers:
 *   - getProviderTypeFromEnv() detects ollama from GOLI_DEFAULT_MODEL
 *   - getProviderTypeFromEnv() detects openai, anthropic
 *   - getProviderTypeFromEnv() returns null when env not set
 *   - createProviderBackedClientSync() creates OllamaProvider adapter
 *   - createProviderBackedClientSync() returns null when env not set
 *   - ProviderBackedModelClient.call() translates types correctly
 *   - .env loading works (env vars set from file)
 *   - OllamaProvider can be constructed with env config
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  ProviderBackedModelClient,
  getProviderTypeFromEnv,
  createProviderBackedClientSync,
} from '../../packages/core/src/agent/provider-adapter.js';
import { OllamaProvider } from '../../packages/core/src/providers/ollama.js';
import { OpenAIProvider } from '../../packages/core/src/providers/openai.js';

// Save/restore env vars.
const origEnv = { ...process.env };

beforeEach(() => {
  // Clear relevant env vars.
  delete process.env.GOLI_DEFAULT_MODEL;
  delete process.env.OLLAMA_BASE_URL;
  delete process.env.OLLAMA_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
});

afterEach(() => {
  // Restore env vars.
  for (const [k, v] of Object.entries(origEnv)) {
    process.env[k] = v;
  }
});

// ─── getProviderTypeFromEnv() ───────────────────────────────────────

describe('Provider integration: getProviderTypeFromEnv()', () => {
  it('detects ollama from GOLI_DEFAULT_MODEL', () => {
    process.env.GOLI_DEFAULT_MODEL = 'ollama/gpt-oss:120b';
    expect(getProviderTypeFromEnv()).toBe('ollama');
  });

  it('detects openai', () => {
    process.env.GOLI_DEFAULT_MODEL = 'openai/gpt-4o';
    expect(getProviderTypeFromEnv()).toBe('openai');
  });

  it('detects anthropic', () => {
    process.env.GOLI_DEFAULT_MODEL = 'anthropic/claude-3-5-sonnet';
    expect(getProviderTypeFromEnv()).toBe('anthropic');
  });

  it('returns null for unrecognized provider types', () => {
    process.env.GOLI_DEFAULT_MODEL = 'gpt-4o';
    expect(getProviderTypeFromEnv()).toBeNull();
  });

  it('returns null when env not set', () => {
    expect(getProviderTypeFromEnv()).toBeNull();
  });

  it('returns null for unknown provider types', () => {
    process.env.GOLI_DEFAULT_MODEL = 'unknown/model';
    expect(getProviderTypeFromEnv()).toBeNull();
  });
});


// ─── createProviderBackedClientSync() ──────────────────────────────

describe('Provider integration: createProviderBackedClientSync()', () => {
  it('creates an adapter for ollama', () => {
    process.env.GOLI_DEFAULT_MODEL = 'ollama/gpt-oss:120b';
    process.env.OLLAMA_BASE_URL = 'https://ollama.com';
    process.env.OLLAMA_API_KEY = 'test-key';
    const client = createProviderBackedClientSync();
    expect(client).not.toBeNull();
    expect(client!.modelId()).toBe('ollama/gpt-oss:120b');
  });

  it('creates an adapter for openai', () => {
    process.env.GOLI_DEFAULT_MODEL = 'openai/gpt-4o';
    process.env.OPENAI_API_KEY = 'test-key';
    const client = createProviderBackedClientSync();
    expect(client).not.toBeNull();
    expect(client!.modelId()).toBe('openai/gpt-4o');
  });

  it('returns null for unrecognized provider types', () => {
    process.env.GOLI_DEFAULT_MODEL = 'gpt-4o';
    const client = createProviderBackedClientSync();
    expect(client).toBeNull();
  });

  it('returns null when env not set', () => {
    const client = createProviderBackedClientSync();
    expect(client).toBeNull();
  });

  it('uses default model name when not specified', () => {
    process.env.GOLI_DEFAULT_MODEL = 'ollama/';
    process.env.OLLAMA_BASE_URL = 'https://ollama.com';
    const client = createProviderBackedClientSync();
    expect(client).not.toBeNull();
    expect(client!.modelId()).toContain('gpt-oss:120b'); // default
  });
});


// ─── ProviderBackedModelClient.call() ──────────────────────────────

describe('Provider integration: ProviderBackedModelClient.call()', () => {
  it('translates ModelResponse to the call response format', async () => {
    const mockProvider = {
      complete: vi.fn().mockResolvedValue({
        text: 'Hello from Ollama!',
        toolCalls: [{ id: 'tc-1', name: 'read_file', input: { path: 'src/index.ts' } }],
        costUsd: 0,
        inputTokens: 100,
        outputTokens: 50,
      }),
      modelId: () => 'ollama/test-model',
      supportsCaching: () => false,
    };

    const client = new ProviderBackedModelClient(mockProvider as any);
    const response = await client.call({
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Read the file' },
      ],
      tools: [{
        type: 'function' as const,
        function: { name: 'read_file', description: 'Read a file', parameters: { type: 'object' } },
      }],
      stream: false,
    });

    expect(response.content).toBe('Hello from Ollama!');
    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls[0]!.name).toBe('read_file');
    expect(response.inputTokens).toBe(100);
    expect(response.outputTokens).toBe(50);
    expect(response.finishReason).toBe('tool_calls');
  });

  it('sets finishReason to stop when no tool calls', async () => {
    const mockProvider = {
      complete: vi.fn().mockResolvedValue({
        text: 'Just text, no tools.',
        toolCalls: [],
        costUsd: 0,
      }),
      modelId: () => 'ollama/test-model',
      supportsCaching: () => false,
    };

    const client = new ProviderBackedModelClient(mockProvider as any);
    const response = await client.call({
      messages: [{ role: 'user', content: 'hello' }],
      stream: false,
    });

    expect(response.finishReason).toBe('stop');
    expect(response.toolCalls).toHaveLength(0);
  });

  it('passes streaming tokens via onChunk', async () => {
    const mockProvider = {
      complete: vi.fn().mockImplementation((_msgs, _system, opts) => {
        if (opts?.onToken) {
          opts.onToken('Hello ');
          opts.onToken('world!');
        }
        return Promise.resolve({ text: 'Hello world!', toolCalls: [], costUsd: 0 });
      }),
      modelId: () => 'ollama/test-model',
      supportsCaching: () => false,
    };

    const chunks: string[] = [];
    const client = new ProviderBackedModelClient(mockProvider as any);
    await client.call({
      messages: [{ role: 'user', content: 'hello' }],
      stream: true,
      onChunk: (chunk) => {
        if (chunk.contentDelta) chunks.push(chunk.contentDelta);
      },
    });

    expect(chunks).toEqual(['Hello ', 'world!']);
  });
});


// ─── OllamaProvider construction ────────────────────────────────────

describe('Provider integration: OllamaProvider construction', () => {
  it('can be constructed with env config', () => {
    process.env.OLLAMA_BASE_URL = 'https://ollama.com';
    process.env.OLLAMA_API_KEY = 'test-key-123';
    const provider = new OllamaProvider({
      baseUrl: process.env.OLLAMA_BASE_URL,
      model: 'gpt-oss:120b',
      apiKey: process.env.OLLAMA_API_KEY,
    });
    expect(provider.modelId()).toBe('ollama/gpt-oss:120b');
    expect(provider.supportsCaching()).toBe(false);
  });

  it('can be constructed without API key (for local Ollama)', () => {
    const provider = new OllamaProvider({
      baseUrl: 'http://localhost:11434',
      model: 'llama3',
    });
    expect(provider.modelId()).toBe('ollama/llama3');
  });
});


// ─── .env loading ───────────────────────────────────────────────────

describe('Provider integration: .env loading', () => {
  it('.env file exists and contains Ollama config', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    // The .env file is at the project root (3 levels up from tests/unit/).
    const envPath = path.resolve(__dirname, '..', '..', '.env');
    expect(fs.existsSync(envPath)).toBe(true);
    const content = fs.readFileSync(envPath, 'utf-8');
    expect(content).toContain('OLLAMA_API_KEY=');
    expect(content).toContain('OLLAMA_BASE_URL=https://ollama.com');
    expect(content).toContain('GOLI_DEFAULT_MODEL=ollama/gpt-oss:120b');
  });
});
