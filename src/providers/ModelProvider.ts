export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ModelProvider {
  complete(messages: Message[], systemPrompt?: string): Promise<string>;
}
