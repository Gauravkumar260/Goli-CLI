/**
 * Shared protocol types used by both @goli-cli/agent-core and
 * @goli-cli/tool-system. Placing them here breaks the circular
 * dependency: tool-system → agent-core → tool-system.
 *
 * @module shared/types
 */

// ─── Tool Calls ───────────────────────────────────────────────────────

/** Status of a tool call as it flows through the dispatch pipeline. */
export type ToolCallStatus = 'pending' | 'executing' | 'completed' | 'failed' | 'denied';

/**
 * Provenance tag attached to a `ToolCall` after execution.
 */
export interface ToolCallProvenance {
  /** Origin of the tool call. */
  source: 'tool' | 'mcp' | 'subagent' | 'hook' | 'user' | 'system';
  /** The original tool name (before any MCP namespacing). */
  toolName: string;
  /** Unix epoch ms when the tool call was emitted. */
  timestamp: number;
  /** The originating session ID. */
  sessionId: string;
  /** The turn number within the session (0-indexed). */
  turn: number;
}

/**
 * A single tool call requested by the model.
 *
 * Shared between agent-core and tool-system to avoid circular deps.
 */
export interface ToolCall {
  /** Unique ID for this tool call. */
  id: string;
  /** The tool/function name (e.g. `'read_file'`, `'grep'`). */
  name: string;
  /** Raw JSON string of the tool arguments. */
  arguments: string;
  /** Parsed arguments (set after successful JSON parsing). */
  argumentsParsed?: Record<string, unknown>;
  /** Error message if JSON parsing failed. */
  parseError?: string;
  /** Current status in the dispatch pipeline. */
  status: ToolCallStatus;
  /** The result content (string) once the tool completes. */
  result?: string;
  /** Error message if the tool failed. */
  error?: string;
  /** Wall-clock duration of the tool execution in ms. */
  durationMs?: number;
  /** Tokens consumed by this tool call (for accounting). */
  tokensUsed?: number;
  /** Provenance tag populated by ProvenanceTracker. */
  provenance?: ToolCallProvenance;
}

// ─── Agent Roles ──────────────────────────────────────────────────────

/**
 * The 11 specialized agent roles in the GOLI-CLI swarm.
 */
export type AgentRole =
  | 'orchestrator'
  | 'scout'
  | 'researcher'
  | 'architect'
  | 'planner'
  | 'implementer'
  | 'debugger'
  | 'qa-tester'
  | 'security-auditor'
  | 'reviewer'
  | 'documenter';

/**
 * The 11-agent swarm roles in lifecycle order.
 */
export const AGENT_ROLES: AgentRole[] = [
  'scout',
  'researcher',
  'architect',
  'planner',
  'implementer',
  'debugger',
  'qa-tester',
  'security-auditor',
  'reviewer',
  'orchestrator',
  'documenter',
];

/** Human-readable label for each agent role. */
export const AGENT_ROLE_LABELS: Record<AgentRole, string> = {
  orchestrator: 'Orchestrator',
  scout: 'Scout',
  researcher: 'Researcher',
  architect: 'Architect',
  planner: 'Planner',
  implementer: 'Implementer',
  debugger: 'Debugger',
  'qa-tester': 'QA / Tester',
  'security-auditor': 'Security Auditor',
  reviewer: 'Reviewer',
  documenter: 'Documenter',
};

// ─── Messages ─────────────────────────────────────────────────────────

/** Roles a message can play in the conversation. */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * A single message in the conversation.
 */
export interface Message {
  role: MessageRole;
  content: string;
  thinking?: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  toolName?: string;
  timestamp: string;
}

// ─── Stop Reasons ─────────────────────────────────────────────────────

/**
 * Why the agent loop stopped.
 */
export type StopReason =
  | 'completed'
  | 'budget'
  | 'stall'
  | 'error'
  | 'aborted'
  /** @deprecated Phase 1 stub — no code path emits this. */
  | 'not-implemented'
  | 'loop_detected';

// ─── TODOs ────────────────────────────────────────────────────────────

/** Status of a TODO item. */
export type TodoStatus = 'pending' | 'in_progress' | 'completed';

/** Priority of a TODO item. */
export type TodoPriority = 'high' | 'medium' | 'low';

/**
 * A single TODO item, managed by the planner.
 */
export interface Todo {
  content: string;
  status: TodoStatus;
  priority: TodoPriority;
}
