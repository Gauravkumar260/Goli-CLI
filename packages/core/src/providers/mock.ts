 
import type { ModelProvider, Message, ModelResponse, CompletionOptions } from './ModelProvider.js';

/**
 *
 */
export class MockProvider implements ModelProvider {
  async complete(
    _messages: Message[],
    system: string,
    options?: CompletionOptions,
  ): Promise<ModelResponse> {
    let text = '';
    if (system.includes('You are the Planner agent')) {
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

  modelId() { return 'mock-model'; }
  supportsCaching() { return false; }
}
