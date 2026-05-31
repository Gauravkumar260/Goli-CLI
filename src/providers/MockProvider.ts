import { Message, ModelProvider } from "./ModelProvider";

export class MockProvider implements ModelProvider {
  private responses: string[];
  private currentIndex: number = 0;

  constructor(responses: string[]) {
    this.responses = responses;
  }

  async complete(messages: Message[], systemPrompt?: string): Promise<string> {
    if (this.currentIndex >= this.responses.length) {
      return "DONE";
    }
    return this.responses[this.currentIndex++];
  }
}
