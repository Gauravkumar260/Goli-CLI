import type { ModelProvider, Message, ModelResponse, CompletionOptions, ProviderConfig } from './ModelProvider.js';

/**
 * Mock provider for tests and offline development.
 *
 * ## Why a real constructor?
 *
 * The previous implementation had no constructor (the class used the
 * default `constructor() {}`). `buildProvider({ type: 'mock', model,
 * responses })` needs to pass the config to the constructor so the
 * mock can return canned responses. We now accept a `MockConfig`
 * (which is the `'mock'` variant of `ProviderConfig`) and:
 *  - Pre-scripted responses (`cfg.responses`) are returned in order.
 *  - If no responses are provided, fall back to the system-prompt
 *    heuristic (the previous behavior). The heuristic was fragile
 *    (string matching on the system prompt) — the new
 *    `cfg.responses` array is the recommended way to use the mock.
 */
export class MockProvider implements ModelProvider {
  private readonly model: string;
  private readonly responses: string[];
  private responseIndex = 0;

  constructor(cfg: Extract<ProviderConfig, { type: 'mock' }> = { type: 'mock', model: 'mock-model' }) {
    this.model = cfg.model;
    this.responses = cfg.responses ?? [];
  }

  async complete(
    _messages: Message[],
    system: string,
    options?: CompletionOptions,
  ): Promise<ModelResponse> {
    let text: string;
    if (this.responses.length > 0) {
      // Return the next pre-scripted response (cycling if exhausted).
      text = this.responses[this.responseIndex % this.responses.length] ?? '';
      this.responseIndex++;
    } else if (system.includes('You are the Planner agent')) {
      text = JSON.stringify({
        taskSummary: 'mock task',
        steps: [
          { id: '1', description: 'Simulate tool call', files: ['index.ts'], rationale: 'mock rationale', dependsOn: [] }
        ]
      });
    } else if (system.includes('You are the Scout agent')) {
      text = 'Scout complete.';
    } else if (system.includes('You are the Implementer agent')) {
      text = 'Implementer complete.';
    } else {
      text = 'Final result merged.';
    }

    if (options?.onToken) {
      options.onToken(text);
    }

    return { text, costUsd: 0 };
  }

  modelId() { return this.model; }
  supportsCaching() { return false; }
}
