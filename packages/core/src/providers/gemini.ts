 
import type { ModelProvider, Message, ModelResponse, CompletionOptions } from './ModelProvider.js';

/**
 *
 */
export class GeminiProvider implements ModelProvider {
  private apiKey: string;
  private model: string;

  constructor(cfg: { apiKey: string; model: string }) {
    this.apiKey = cfg.apiKey;
    this.model = cfg.model;
  }

  async complete(
    messages: Message[],
    system: string,
    options?: CompletionOptions
  ): Promise<ModelResponse> {
    // Dynamic import — @google/generative-ai may not be installed.
    // @ts-expect-error — module is optional; only loaded when Gemini provider is used
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(this.apiKey);
    const model = genAI.getGenerativeModel({
      model: this.model,
      systemInstruction: system,
    });

    const contents = messages.map(m => ({
      role: (m.role === 'assistant' || m.role === 'model') ? 'model' : 'user',
      parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }],
    }));

    if (options?.onToken) {
        const result = await model.generateContentStream({
            contents,
            generationConfig: {
                maxOutputTokens: options.maxTokens,
            },
        });

        let text = '';
        for await (const chunk of result.stream) {
            const chunkText = chunk.text();
            if (chunkText) {
                text += chunkText;
                options.onToken(chunkText);
            }
        }
        return { text, costUsd: 0 };
    } else {
        const result = await model.generateContent({
            contents,
            generationConfig: {
                maxOutputTokens: options?.maxTokens,
            },
        });
        return { text: result.response.text(), costUsd: 0 };
    }
  }

  modelId(): string {
    return `gemini/${this.model}`;
  }

  supportsCaching(): boolean {
    return true;
  }
}
