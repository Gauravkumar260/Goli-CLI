import { type Message, type ModelProvider } from "./ModelProvider";

export class MockProvider implements ModelProvider {
  private responses: string[];
  private currentIndex: number = 0;

  constructor(responses: string[]) {
    this.responses = responses;
  }

  async complete(_messages: Message[], _systemPrompt?: string): Promise<string> {
    const response = this.responses[this.currentIndex++];
    if (!response) {
      return "DONE";
    }
    return response;
  }
}
