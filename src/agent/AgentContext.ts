import { Message } from "../providers/ModelProvider";
import { ToolCall, ToolResult } from "../tools/ToolRegistry";

export class AgentContext {
  public messages: Message[] = [];
  public systemPrompt: string = "";
  public tokenCount: number = 0;
  public windowSize: number = 128000; // Default for Sonnet

  constructor(messages: Message[] = []) {
    this.messages = messages;
  }

  appendToolResult(toolCall: ToolCall, result: ToolResult) {
    this.messages.push({
      role: 'user',
      content: `Tool Result (${toolCall.name}):\n${result.output || result.error || "No output"}`
    });
  }

  // Token counting placeholder - would use a library in a real implementation
  updateTokenCount() {
    this.tokenCount = this.messages.reduce((acc, m) => acc + (m.content?.length || 0) / 4, 0);
  }
}
