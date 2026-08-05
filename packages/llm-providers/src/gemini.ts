
import type { ModelProvider, Message, ModelResponse, CompletionOptions, ToolCall } from './ModelProvider.js';

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
    // Pass tool declarations if the caller supplied tools. The
    // previous implementation NEVER read `options.tools`, so any
    // agent loop that relied on tool calls would get no tool
    // calls back from Gemini. Gemini supports function calling
    // via `tools: [{ functionDeclarations: [...] }]` in the
    // model config.
    const toolsConfig = options?.tools && options.tools.length > 0
      ? {
          tools: [{
            functionDeclarations: options.tools.map((t) => {
              const tool = t as { name: string; description: string; parameters: unknown };
              return {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
              };
            }),
          }],
        }
      : undefined;
    const model = genAI.getGenerativeModel({
      model: this.model,
      systemInstruction: system,
      ...(toolsConfig ?? {}),
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
        const toolCalls: ToolCall[] = [];
        for await (const chunk of result.stream) {
            const chunkText = chunk.text();
            if (chunkText) {
                text += chunkText;
                options.onToken(chunkText);
            }
            // Collect tool calls from the chunk. Gemini's
            // function-call responses come as
            // `chunk.functionCalls()` (or `functionResponse`).
            try {
              const fns = (chunk as unknown as { functionCalls?: () => Array<{ name: string; args: Record<string, unknown> }> }).functionCalls?.();
              if (fns) {
                for (const fn of fns) {
                  toolCalls.push({
                    id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
                    name: fn.name,
                    input: fn.args ?? {},
                  });
                }
              }
            } catch {
              // chunk may not support functionCalls — skip.
            }
        }
        return { text, toolCalls, costUsd: 0 };
    } else {
        const result = await model.generateContent({
            contents,
            generationConfig: {
                maxOutputTokens: options?.maxTokens,
            },
        });
        // Collect tool calls from the non-streaming response.
        const toolCalls: ToolCall[] = [];
        try {
          const fns = (result.response as unknown as { functionCalls?: () => Array<{ name: string; args: Record<string, unknown> }> }).functionCalls?.();
          if (fns) {
            for (const fn of fns) {
              toolCalls.push({
                id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
                name: fn.name,
                input: fn.args ?? {},
              });
            }
          }
        } catch {
          // result.response may not support functionCalls — skip.
        }
        return { text: result.response.text(), toolCalls, costUsd: 0 };
    }
  }

  modelId(): string {
    return `gemini/${this.model}`;
  }

  supportsCaching(): boolean {
    return true;
  }
}
