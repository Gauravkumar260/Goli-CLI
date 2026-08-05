/**
 * Shared types for the Agent Core Loop (Module 1).
 *
 * This file is the single source of truth for the data structures that
 * flow through the ReAct master loop: messages, tool calls, conversation
 * state, agent events, and stop reasons.
 *
 * @module agent/types
 */

import type { SandboxMode } from '../config/schema.js';

// ─── Messages ─────────────────────────────────────────────────────────

/** Roles a message can play in the conversation. */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * A single message in the conversation.
 *
 * Maps to the OpenAI Chat Completions message format, extended with
 * GOLI-CLI-specific fields for thinking tokens and tool-call tracking.
 */
export interface Message {
  /** The role of the message author. */
  role: MessageRole;
  /** The text content (may be empty for pure tool-call assistant messages). */
  content: string;
  /** Thinking/reasoning content (separate from content). */
  thinking?: string;
  /** Tool calls made by the assistant (only for `role: 'assistant'`). */
  toolCalls?: ToolCall[];
  /** The tool call ID this result corresponds to (only for `role: 'tool'`). */
  toolCallId?: string;
  /** The name of the tool that produced this result (only for `role: 'tool'`). */
  toolName?: string;
  /** Timestamp the message was created (ISO 8601). */
  timestamp: string;
}

// ─── Tool Calls ───────────────────────────────────────────────────────

/** Status of a tool call as it flows through the dispatch pipeline. */
export type ToolCallStatus = 'pending' | 'executing' | 'completed' | 'failed' | 'denied';

/**
 * A single tool call requested by the model.
 *
 * The `arguments` field is a raw JSON string as received from the model.
 * Use {@link parseToolCallArgs} (from `./json-repair.js`) to safely parse
 * it into an object — never use `JSON.parse` directly, as the model can
 * emit malformed JSON under heavy multi-tool turns.
 */
export interface ToolCall {
  /** Unique ID for this tool call (assigned by the model or the client). */
  id: string;
  /** The tool/function name (e.g. `'read_file'`, `'grep'`, `'plan_task'`). */
  name: string;
  /** Raw JSON string of the tool arguments (parse with `parseToolCallArgs`). */
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
  /**
   * P1-9 fix (remediation plan Phase 9): provenance tag.
   *
   * Populated by `ProvenanceTracker` when the tool result is recorded
   * into the conversation state. Surfaces the source ('tool', 'mcp',
   * 'subagent', 'hook', 'user', 'system'), the originating session ID,
   * the turn number, and the timestamp — so downstream consumers (TUI,
   * audit log, trajectory export) can attribute the result.
   *
   * When undefined (older callers that don't track provenance), all
   * sub-fields are simply omitted — no behavior change.
   */
  provenance?: ToolCallProvenance;
}

/**
 * P1-9: Provenance tag attached to a `ToolCall` after execution.
 *
 * Set by `ProvenanceTracker.tagToolCall()` in `loop.ts` immediately
 * after `toolRegistry.dispatch()` returns. The tag is then read by:
 *   - `CliAgentLoop.tryRunStream()` to bridge into the TUI's
 *     `kind: 'tool'` event (so HistoryScroll can render it).
 *   - `audit-log.ts` to record the source alongside the action.
 *   - `trajectory/store.ts` to attribute the result in training data.
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

// ─── Agent Roles (11-agent swarm, Phase 13) ───────────────────────────

/**
 * The 11 specialized agent roles in the GOLI-CLI swarm.
 *
 * In Phase 2, the core loop runs as a single agent (the Orchestrator
 * role). Phase 13 (Module 7) wires the full Scout → Documenter pipeline
 * where each role is an instance of the core loop with a specialized
 * system prompt and tool set.
 */
export type AgentRole =
  | 'orchestrator' // Phase 2 default
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
 *
 * Phase 13 will iterate through this array, spawning each agent in
 * sequence with the appropriate context handoff.
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

// ─── Conversation State ───────────────────────────────────────────────

/**
 * The full state of a conversation at any point in time.
 *
 * The agent loop reads from this to build the next API call, and writes
 * to it after each iteration (new messages, updated budget, etc.).
 */
export interface ConversationState {
  /** The full message history (system + user + assistant + tool). */
  messages: Message[];
  /** The current agent role (Phase 2: always 'orchestrator'). */
  role: AgentRole;
  /** The TODO list (managed by the planner). */
  todos: Todo[];
  /** Set of file paths the agent has read (for Read-before-Edit tracking, Phase 4). */
  readFiles: Set<string>;
  /** Total input tokens consumed so far. */
  inputTokens: number;
  /** Total output tokens consumed so far. */
  outputTokens: number;
  /** Total thinking tokens consumed so far. */
  thinkingTokens: number;
  /** Number of loop iterations completed. */
  iterations: number;
  /** Session start timestamp (ISO 8601). */
  startedAt: string;
  /** Recent tool calls for stall detection (serialized for equality check). */
  recentToolCallSignatures: string[];
  /**
   * P1-9 fix (remediation plan Phase 9): session ID for provenance
   * tagging. Populated by `AgentLoop.run()` from `input.sessionId`
   * (or auto-generated when absent). Read by `executeToolCall()` to
   * tag each `ToolCall.provenance` so downstream consumers can
   * attribute the result to the originating session.
   */
  sessionId?: string;
}

// ─── Stop Reasons ─────────────────────────────────────────────────────

/**
 * Why the agent loop stopped.
 *
 * The five stop conditions from the Module 1 spec:
 * 1. `completed` — the model stopped calling tools (natural completion)
 * 2. `budget` — hit a budget limit (tokens / cost / iterations / wallclock)
 * 3. `stall` — detected 3 identical tool calls in a row
 * 4. `error` — repeated parse failures or unrecoverable error
 * 5. `aborted` — user aborted (Ctrl+C or programmatic abort)
 * 6. `loop_detected` — the loop-detector flagged a non-identical-but-
 *    semantically-repeating pattern (e.g. toggling between two states).
 *
 * LOW-priority fix: the previous type included `'not-implemented'`
 * (a Phase 1 stub variant). Phase 2 removed the stub but kept the
 * type variant — no code path emits it, so it's dead. We keep it
 * for backwards-compat (callers that switch on `StopReason` may have
 * a `case 'not-implemented'` arm) but mark it `@deprecated`.
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

// ─── Agent Events (streamed from the loop) ────────────────────────────

/** The type of event streamed from the agent loop. */
export type AgentEventType =
  | 'loop-start'
  | 'loop-iteration'
  | 'thinking'
  | 'content-delta'
  | 'tool-call-start'
  | 'tool-call-result'
  | 'todo-updated'
  | 'stop'
  | 'error';

/**
 * An event streamed from the agent loop.
 *
 * The loop is an async generator that yields these events. The TUI
 * (Phase 3) and the CLI consume them to render streaming output.
 */
export interface AgentEvent {
  /** The event type. */
  type: AgentEventType;
  /** The event payload (varies by type). */
  data: AgentEventData;
  /** Timestamp (ISO 8601). */
  timestamp: string;
  /** The iteration number this event belongs to. */
  iteration: number;
}

/** Union of all event payload shapes. */
export type AgentEventData =
  | { type: 'loop-start'; prompt: string; role: AgentRole }
  | { type: 'loop-iteration'; iteration: number }
  | { type: 'thinking'; delta: string }
  | { type: 'content-delta'; delta: string }
  | { type: 'tool-call-start'; toolCall: ToolCall }
  | { type: 'tool-call-result'; toolCall: ToolCall }
  | { type: 'todo-updated'; todos: Todo[] }
  | { type: 'stop'; reason: StopReason; message: string }
  | { type: 'error'; error: string; code: string };

// ─── TODOs (planner) ──────────────────────────────────────────────────

/** Status of a TODO item (one-`in_progress`-at-a-time enforced). */
export type TodoStatus = 'pending' | 'in_progress' | 'completed';

/** Priority of a TODO item. */
export type TodoPriority = 'high' | 'medium' | 'low';

/**
 * A single TODO item, managed by the planner.
 *
 * The agent uses the `plan_task` tool to create/update TODOs. The
 * current TODO is injected into the system prompt every iteration so
 * the model stays focused.
 */
export interface Todo {
  /** The task description. */
  content: string;
  /** Current status. */
  status: TodoStatus;
  /** Priority (affects ordering). */
  priority: TodoPriority;
}

// ─── Prompt context base ──────────────────────────────────────────────

/**
 * Base context fields shared by `SystemPromptContext` (system-prompt.ts).
 *
 * (Historically also shared with `PromptBuildContext` from
 * `prompt-builder.ts`, but that file was deleted in P2-18 / remediation
 * plan Phase 18 as dead code. The base interface is retained because
 * external callers may still extend it for custom assemblers.)
 *
 * Extracted during dedup loop iteration 7 from the first 10 fields that
 * were duplicated verbatim in both interfaces. Each consumer interface
 * extends this base and adds its own specialized fields.
 */
export interface BasePromptContext {
  /** The agent role. */
  role: AgentRole;
  /** Available tool names. */
  toolNames: string[];
  /** Current sandbox mode. */
  sandboxMode: SandboxMode;
  /** Current TODO list. */
  todos: Todo[];
  /** Memory snapshot (frozen at session start). */
  memorySnapshot?: {
    memory?: string;
    user?: string;
    project?: string;
  };
  /** The user's preferred response language. */
  language: string;
  /** Current git branch. */
  gitBranch?: string;
  /** Whether god mode is active. */
  godMode: boolean;
  /** The task prompt. */
  taskPrompt: string;
  /**
   * The current AppMode (read-only / plan / build / god / local-llms).
   * Drives the mode-specific system-prompt fragment AND the tool-filtering
   * logic. If absent, the assembler derives it from `godMode`.
   */
  appMode?: 'read-only' | 'plan' | 'build' | 'god' | 'local-llms';
  /**
   * P2-7: Code-intelligence context retrieved from the symbol graph +
   * hybrid retriever. When the AgentLoop is constructed with a context
   * engine (via `createContextEngine()`), it queries the retriever with
   * the task prompt and passes the top-k results here. The system-prompt
   * assembler injects them as a "Retrieved Context" fragment so the
   * agent sees relevant symbols before its first tool call.
   *
   * When undefined, no code-intelligence context is injected (the agent
   * must discover code structure via read_file / grep).
   */
  retrievedContext?: string;
  /**
   * P1-4 fix (verification report item #4): L1 metadata for the skills
   * subsystem (ADR-0026). When the AgentLoop is constructed with a
   * SkillLoader, it calls `formatL1ForPrompt()` at session start and
   * passes the resulting string here. The system-prompt assembler
   * injects it as a "Skills" fragment so the agent knows which skills
   * are available and can request L2 instructions via the `ask_user`
   * tool or by emitting a skill-name tool call.
   *
   * When undefined or empty, no skills fragment is injected (the
   * agent has no skill catalog).
   */
  skillsL1?: string;
  /**
   * P0-6 fix (remediation plan Phase 6): on-demand L2 skill
   * instructions. When the `SkillLoader` is configured AND the user's
   * query matches one or more skill triggers, the AgentLoop calls
   * `loadL2Instructions(skillId)` for the top matches and concatenates
   * their full instructions here. The system-prompt assembler injects
   * this as an "L2 Skill Instructions" fragment so the agent sees the
   * complete playbook for matching skills — not just the L1 metadata.
   *
   * Capped at `L2_BUDGET_TOKENS` (4000) to prevent L2 from consuming
   * too much context. When undefined or empty, no L2 fragment is
   * injected (backward-compatible for callers that don't wire L2).
   */
  skillsL2?: string;
  /**
   * P2-9 fix (re-verification report item #11): the set of files the
   * agent has read so far this run (via `read_file`). Tracked in
   * `loop.ts` as `state.readFiles` (a `Set<string>` of resolved
   * absolute paths) for Read-before-Edit enforcement, but previously
   * NEVER injected into the system prompt — the agent had no
   * prompt-level awareness of which files it had already read, so it
   * would often re-read the same file or lose track of context after
   * compaction.
   *
   * The assembler injects this as a "Recent File Reads" fragment
   * listing the most recent N paths (capped to keep the prompt
   * bounded). When undefined or empty, the fragment is omitted
   * (backward-compatible for callers that don't track read files).
   */
  recentReadFiles?: string[];
  /**
   * P2-18 fix (remediation plan Phase 18): pre-formatted reflections
   * from `ReflexionEngine.formatForPrompt()`. The AgentLoop instantiates
   * a `ReflexionEngine` and calls `reflect()` after each tool-call
   * failure (best-effort, non-blocking). The resulting reflections are
   * accumulated in the engine and rendered as a "Recent Reflections
   * (lessons from failures)" fragment by the system-prompt assembler
   * so the agent adapts its strategy on subsequent turns.
   *
   * When undefined or empty, no reflections fragment is injected
   * (backward-compatible for callers that don't wire ReflexionEngine).
   */
  reflections?: string;
}
