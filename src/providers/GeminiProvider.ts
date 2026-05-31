import { GoogleGenerativeAI } from "@google/generative-ai";
import { Message, ModelProvider } from "./ModelProvider";

export class GeminiProvider implements ModelProvider {
  private genAI: GoogleGenerativeAI;

  constructor(private apiKey: string, private modelName: string = "gemini-1.5-flash") {
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async complete(messages: Message[], systemPrompt?: string): Promise<string> {
    const system = systemPrompt || messages.find(m => m.role === 'system')?.content;
    
    // Create model instance with system instruction
    const model = this.genAI.getGenerativeModel({ 
      model: this.modelName,
      systemInstruction: system ? { role: 'system', parts: [{ text: system }] } : undefined
    });

    const history = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }],
      }));

    const chat = model.startChat({
      history: history.slice(0, -1),
    });

    const lastMessage = history[history.length - 1];
    const result = await chat.sendMessage(lastMessage.parts[0].text);
    return result.response.text();
  }
}
