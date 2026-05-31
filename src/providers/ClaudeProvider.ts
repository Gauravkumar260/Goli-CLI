import Anthropic from "@anthropic-ai/sdk";
import { Message, ModelProvider } from "./ModelProvider";

export class ClaudeProvider implements ModelProvider {
  private anthropic: Anthropic;
  private model: string;

  constructor(apiKey: string, model: string = "claude-3-5-sonnet-latest") {
    this.anthropic = new Anthropic({ apiKey });
    this.model = model;
  }

  async complete(messages: Message[], systemPrompt?: string): Promise<string> {
    const system = systemPrompt || messages.find(m => m.role === 'system')?.content;
    const filteredMessages = messages.filter(m => m.role !== 'system');

    const response = await this.anthropic.messages.create({
      model: this.model,
      system: system,
      messages: filteredMessages.map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content,
      })),
      max_tokens: 4096,
    });

    const content = response.content[0];
    if (content.type === 'text') {
      return content.text;
    }
    return "";
  }
}
