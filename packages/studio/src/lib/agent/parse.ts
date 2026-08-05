/**
 *
 */
export interface ParsedToolCall {
  name: string;
  input: Record<string, unknown>;
}

/**
 *
 */
export interface ParsedToolResult {
  status: 'ok' | 'error';
  content: string;
}

/**
 *
 */
export function parseToolCalls(text: string): { calls: ParsedToolCall[]; textWithoutToolBlocks: string } {
  // Mock implementation for backward compatibility with studio UI
  return { calls: [], textWithoutToolBlocks: text };
}

/**
 *
 */
export function parseToolResults(_text: string): ParsedToolResult[] {
  // Mock implementation
  return [];
}

/**
 *
 */
export function isToolResultMessage(text: string): boolean {
  return text.includes('<tool_result>') || text.includes('tool_result');
}
