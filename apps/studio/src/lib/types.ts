/**
 * Goli Studio — shared domain types.
 */

/** Permission mode controls how the agent asks before running mutating tools. */
export type PermissionMode = 'ask' | 'yolo' | 'plan';

/** Socket-style connection state (kept for UI parity; we use SSE under the hood). */
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

/** A single row in the chat transcript (UI-side shape). */
export interface TranscriptItem {
  id: string;
  kind: 'user' | 'assistant' | 'tool' | 'permission' | 'error' | 'system';
  text?: string;
  /** True while the assistant message is still streaming tokens. */
  streaming?: boolean;
  /** Tool-call correlation id (for tool / permission rows). */
  toolCallId?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: { ok: boolean; content: string; isError?: boolean };
  toolState?: 'running' | 'done' | 'error';
  /** Human-readable summary for permission prompts. */
  summary?: string;
  /** Permission decision state. */
  decision?: 'pending' | 'allow' | 'deny';
  /** Correlates a transcript row to a single agent run. */
  runId?: string;
  /** Unix millis. */
  at: number;
}

/** Session summary for the sidebar. */
export interface SessionSummary {
  id: string;
  title: string;
  permissionMode: PermissionMode;
  createdAt: string;
  updatedAt: string;
  messageCount?: number;
  lastSnippet?: string;
}

/** Tool descriptor surfaced to the UI. */
export interface ToolDescriptor {
  name: string;
  description: string;
  /** Quick category for icon/color pickers. */
  category: 'fs' | 'search' | 'edit' | 'exec' | 'web' | 'other';
}

/** Server-sent event payload over the chat SSE stream. */
export type ChatStreamEvent =
  | { type: 'start'; runId: string; at: number }
  | { type: 'token'; runId: string; text: string }
  | { type: 'tool_start'; runId: string; toolCallId: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_end'; runId: string; toolCallId: string; result: { ok: boolean; content: string; isError?: boolean } }
  | { type: 'permission_request'; runId: string; toolCallId: string; name: string; input: Record<string, unknown>; summary: string }
  | { type: 'final'; runId: string; text: string }
  | { type: 'error'; runId: string; message: string }
  | { type: 'end'; runId: string; turns: number };

/** Tools exposed by the agent (used by Settings / command palette). */
export const TOOL_CATALOG: ToolDescriptor[] = [
  { name: 'read_file', description: 'Read a file from the workspace sandbox.', category: 'fs' },
  { name: 'write_file', description: 'Write or overwrite a file in the workspace sandbox.', category: 'edit' },
  { name: 'list_files', description: 'List the entries of a directory.', category: 'fs' },
  { name: 'edit_file', description: 'Apply a structured diff to an existing file.', category: 'edit' },
  { name: 'run_command', description: 'Run a shell command in the workspace (sandboxed).', category: 'exec' },
  { name: 'web_search', description: 'Search the public web for current information.', category: 'web' },
];
