import { GoogleGenerativeAI } from "@google/generative-ai";
import { type Message, type ModelProvider } from "./ModelProvider";

export class GeminiProvider implements ModelProvider {
  private genAI: GoogleGenerativeAI;

  constructor(private apiKey: string, private modelName: string = "gemini-1.5-flash") {
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async complete(messages: Message[], systemPrompt?: string): Promise<string> {
    const system = systemPrompt || messages.find(m => m.role === 'system')?.content;

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

    if (history.length === 0) return "";

    const chat = model.startChat({
      history: history.slice(0, -1),
    });

    const lastMessage = history[history.length - 1];
    if (!lastMessage || !lastMessage.parts[0]) return "";

    // Root Fix: Exponential Backoff for 429 Errors
    let retries = 0;
    const maxRetries = 5;
    let delay = 2000; // Start with 2s

    while (retries < maxRetries) {
        try {
            const result = await chat.sendMessage(lastMessage.parts[0].text);
            return result.response.text();
        } catch (e: any) {
            if (e.message.includes("429") || e.message.includes("Too Many Requests")) {
                retries++;
                console.log(`\n⚠️ API Rate Limit (429). Retrying in ${delay/1000}s... (Attempt ${retries}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2; // Exponential backoff
            } else {
                throw e;
            }
        }
    }

    throw new Error(`Gemini API failed after ${maxRetries} retries due to Rate Limits (429).`);
  }
}
