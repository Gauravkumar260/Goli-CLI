import { Ollama } from 'ollama';
import { type Message, type ModelProvider } from './ModelProvider';

export class OllamaCloudProvider implements ModelProvider {
  private ollama: Ollama;

  constructor(private apiKey: string, private modelName: string = 'gpt-oss:120b') {
    this.ollama = new Ollama({
      host: 'https://ollama.com',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });
  }

  async complete(messages: Message[], systemPrompt?: string): Promise<string> {
    const formattedMessages = messages.map(m => ({
      role: m.role,
      content: m.content
    }));

    if (systemPrompt) {
        formattedMessages.unshift({ role: 'system', content: systemPrompt });
    }

    try {
      const response = await this.ollama.chat({
        model: this.modelName,
        messages: formattedMessages,
        stream: false
      });
      return response.message.content;
    } catch (e: any) {
      console.error("Ollama Cloud Error:", e.message);
      throw e;
    }
  }
}
