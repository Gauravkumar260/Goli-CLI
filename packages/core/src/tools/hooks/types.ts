/**
 * Hook engine types (Module 3, part 2).
 *
 * Defines the hook event types and the hook handler interface. Hooks
 * are deterministic guardrails that fire regardless of model compliance
 * — they convert safety from probability (prompts) to guarantee (code).
 *
 * ## Hook Events (mirrors Claude Code's lifecycle)
 *
 * - **SessionStart**: fires when the agent loop starts a new session.
 *   Useful for loading memory, initializing state, logging session start.
 * - **PreToolUse**: fires before a tool executes. Can allow, deny, or
 *   escalate (ask user). Can modify the tool input.
 * - **PostToolUse**: fires after a tool executes. Can inject feedback
 *   into the conversation (e.g. "formatter ran", "snapshot created").
 * - **UserPromptSubmit**: fires when the user submits a prompt. Can
 *   modify or reject the prompt.
 * - **PreCompact**: fires before context compaction runs. Can inject
 *   additional context to preserve (e.g. "don't summarize this file").
 * - **Stop**: fires when the agent loop stops. Useful for cleanup,
 *   final commit, trajectory recording.
 *
 * ## Why hooks > prompts (ADR-0018)
 *
 * Prompts are probabilistic — the model might ignore them under context
 * pressure. Hooks fire every time, regardless of what the model does.
 * Safety logic belongs in hooks, not prompts.
 *
 * @module tools/hooks/types
 */

import type { ToolCall } from '../../agent/types.js';
import type { ToolResult } from '../types.js';

/** The events that hooks can subscribe to. */
export type HookEvent =
  | 'SessionStart'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'UserPromptSubmit'
  | 'PreCompact'
  | 'Stop';

/** The decision a PreToolUse hook can make. */
export type HookDecision = 'allow' | 'deny' | 'ask';

/** The result of a PreToolUse hook. */
export interface PreToolUseHookResult {
  /** The decision: allow, deny, or ask the user. */
  decision: HookDecision;
  /** Why this decision was made (shown to the model / user). */
  reason?: string;
  /** Modified tool input (if the hook rewrites the arguments). */
  modifiedInput?: Record<string, unknown>;
}

/** The result of a PostToolUse hook. */
export interface PostToolUseHookResult {
  /** Feedback to inject into the conversation (shown to the model). */
  feedback?: string;
  /** Whether to re-run the tool (e.g. formatter changed the file). */
  reRun?: boolean;
}

/** The result of a UserPromptSubmit hook. */
export interface UserPromptSubmitHookResult {
  /** Whether to allow the prompt. */
  allow: boolean;
  /** Modified prompt (if the hook rewrites it). */
  modifiedPrompt?: string;
  /** Why the prompt was blocked (if `allow` is false). */
  reason?: string;
}

/** The result of a SessionStart hook. */
export interface SessionStartHookResult {
  /** Additional context to inject into the session (e.g. loaded memory). */
  additionalContext?: string;
}

/** The result of a PreCompact hook. */
export interface PreCompactHookResult {
  /**
   * Messages to preserve during compaction (won't be summarized).
   * The compaction engine should keep these messages verbatim.
   */
  preserveMessages?: number[];
  /** Additional context to include in the summary. */
  additionalContext?: string;
}

/** Context passed to every hook handler. */
export interface HookContext {
  /** The tool name. */
  toolName: string;
  /** The tool call (for PreToolUse / PostToolUse). */
  toolCall?: ToolCall;
  /** The tool arguments (parsed). */
  args: Record<string, unknown>;
  /** The tool result (for PostToolUse). */
  result?: ToolResult;
  /** The workspace root. */
  workspaceRoot: string;
  /** The user prompt (for UserPromptSubmit). */
  prompt?: string;
  /** Whether god mode is active. */
  godMode: boolean;
  /** Whether --auto mode is active (auto-approve Tier 2 actions). */
  autoMode?: boolean;
  /** The current sandbox mode (read-only / workspace-write / danger-full-access). */
  sandboxMode?: import('../../sandbox/types.js').SandboxMode;
  /** The session ID (for SessionStart / Stop hooks). */
  sessionId?: string;
  /** The stop reason (for Stop hooks). */
  stopReason?: string;
  /** The message count before compaction (for PreCompact hooks). */
  messageCount?: number;
  /** Logger instance. */
  logger?: import('../../utils/logger.js').Logger;
}

/** A PreToolUse hook handler. */
export type PreToolUseHandler = (ctx: HookContext) => Promise<PreToolUseHookResult> | PreToolUseHookResult;

/** A PostToolUse hook handler. */
export type PostToolUseHandler = (ctx: HookContext) => Promise<PostToolUseHookResult> | PostToolUseHookResult;

/** A UserPromptSubmit hook handler. */
export type UserPromptSubmitHandler = (ctx: HookContext) => Promise<UserPromptSubmitHookResult> | UserPromptSubmitHookResult;

/** A SessionStart hook handler. */
export type SessionStartHandler = (ctx: HookContext) => Promise<SessionStartHookResult> | SessionStartHookResult;

/** A PreCompact hook handler. */
export type PreCompactHandler = (ctx: HookContext) => Promise<PreCompactHookResult> | PreCompactHookResult;

/** A Stop hook handler. */
export type StopHandler = (ctx: HookContext) => Promise<void> | void;

/** A registered hook. */
export interface Hook {
  /** The hook name (for debugging / logging). */
  name: string;
  /** The event this hook listens to. */
  event: HookEvent;
  /** The handler function. */
  handler: PreToolUseHandler | PostToolUseHandler | UserPromptSubmitHandler | SessionStartHandler | PreCompactHandler | StopHandler;
  /** Which tools to match (empty = all tools). */
  toolMatch?: string[];
  /** Priority (lower = runs first). Default: 100. */
  priority?: number;
  /** Whether this hook can be disabled. Default: false (safety hooks are mandatory). */
  disableable?: boolean;
}
