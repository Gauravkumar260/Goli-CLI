/**
 * Goli Studio — shared domain types.
 *
 * Framework-agnostic. Imported by:
 *  - Next.js app (API routes + React client via @/lib/types alias)
 *  - mini-services/agent-runtime (via relative path ../../src/lib/types)
 *
 * NOTHING in this file may import from next/*, react, or any provider SDK.
 */

/** Conversation role. `tool` carries a tool result back to the model. */
export type Role = 'system' | 'user' | 'assistant' | 'tool';

/**
 * Permission modes (subset of the vault's 7-mode system).
 * - ask              : reads auto-approved; writes/execute/network prompt the user.
 * - yolo             : auto-approve every action (opt-in, dangerous).
 * - plan             : no execution; the agent only proposes a plan.
 */
export type PermissionMode = 'ask' | 'yolo' | 'plan';

/** A single message in the agent conversation transcript. */
export interface ChatMessage {
  role: Role;
  content: string;
  /** For role === 'tool': the name of the tool that produced this result. */
  toolName?: string;
  /** For role === 'tool': a stable id to correlate with the originating call. */
  toolCallId?: string;
  /** True when a tool returned an error, so the UI can style it. */
  isError?: boolean;
}

/** The permission class a tool declares it needs. */
export type PermissionLevel = 'read' | 'write' | 'execute' | 'network';

/** Context handed to every tool execution. */
export interface ToolContext {
  /** Absolute, validated workspace root. Tools must not escape it. */
  workspaceDir: string;
  /** Current session id (for logging / per-session state). */
  sessionId: string;
}

/** Structured result returned by every tool. */
export interface ToolResult {
  ok: boolean;
  /** Human/LLM-readable result (usually a string, often JSON for structured tools). */
  content: string;
  /** True if the tool ran but reported a logical error (e.g. file not found). */
  isError?: boolean;
}

/**
 * A tool the agent can call. Self-contained: schema + executor.
 * Tools MUST return serialized strings, never call an LLM provider directly.
 */
export interface Tool {
  name: string;
  description: string;
  /** JSON Schema describing the tool's input. Sent to the model in the system prompt. */
  inputSchema: Record<string, unknown>;
  permissionRequired: PermissionLevel;
  execute: (input: unknown, ctx: ToolContext) => Promise<ToolResult>;
}

/** A tool call parsed out of the model's streamed text. */
export interface ParsedToolCall {
  name: string;
  input: Record<string, unknown>;
  /** Offset in the raw text where the call block started (for UI anchoring). */
  index: number;
}

/** Options passed into the agent loop. */
export interface RunAgentLoopOptions {
  sessionId: string;
  prompt: string;
  workspaceDir: string;
  permissionMode: PermissionMode;
  /** Tools available for this run. */
  tools: Tool[];
  /** System prompt preamble (AGENTS.md etc.). Empty string if none. */
  systemPreamble?: string;
  /** Hard cap on ReAct turns. Default 25. */
  maxTurns?: number;
  /** Emit live events as the loop runs. */
  emit: AgentLoopEmitter;
}

/** Event sink the loop calls. Implemented by the socket.io mini-service. */
export interface AgentLoopEmitter {
  start(runId: string): void;
  token(runId: string, text: string): void;
  toolStart(runId: string, toolCallId: string, name: string, input: Record<string, unknown>): void;
  toolEnd(runId: string, toolCallId: string, result: ToolResult): void;
  permissionRequest(runId: string, toolCallId: string, name: string, input: Record<string, unknown>, summary: string): void;
  final(runId: string, text: string): void;
  error(runId: string, message: string): void;
  end(runId: string, turns: number): void;
}

/** Result of a completed loop run. */
export interface LoopResult {
  runId: string;
  turns: number;
  finalText: string;
}
