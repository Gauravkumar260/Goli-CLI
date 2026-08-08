/**
 * Shared types for the Agent Core Loop (Module 1).
 *
 * This file is the single source of truth for the data structures that
 * flow through the ReAct master loop: messages, tool calls, conversation
 * state, agent events, and stop reasons.
 *
 * @module agent/types
 */

/* eslint-disable import/order -- compat shim: re-export + local import blocks interleave deliberately */

import type { SandboxMode } from '@goli-cli/config';

// Re-export shared protocol types from @goli-cli/shared so callers that
// import from '@goli-cli/agent-core' continue to work unchanged.
// These types live in @goli-cli/shared to break the circular dependency:
//   agent-core → tool-system → agent-core
/**
 *
 */
export type {
  ToolCall,
  ToolCallStatus,
  ToolCallProvenance,
  AgentRole,
  Message,
  MessageRole,
  StopReason,
  Todo,
  TodoStatus,
  TodoPriority,
} from '@goli-cli/shared';
/**
 *
 */
export { AGENT_ROLES, AGENT_ROLE_LABELS } from '@goli-cli/shared';

// Import for use within this file's type definitions.
import type {
  AgentRole,
  Message,
  ToolCall,
  StopReason,
  Todo,
} from '@goli-cli/shared';

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

// ─── Prompt context base ──────────────────────────────────────────────

/**
 * Base context fields shared by `SystemPromptContext` (system-prompt.ts).
 *
 * (Historically also shared with `PromptBuildContext` from
 * `prompt-builder.ts`. That file is dead in production — not exported
 * from the agent-core barrel — and is retained on disk only for the
 * T-021 prompt-caching invariant tests. The base interface is retained
 * because external callers may still extend it for custom assemblers.)
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
