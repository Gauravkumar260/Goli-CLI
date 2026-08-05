/**
 * Tool layer types (Module 3, part 1).
 *
 * Defines the core data structures for the tool registry: Tool, ToolResult,
 * ToolInput, ToolSchema. These types are the contract between the agent
 * loop (Module 1) and the tool implementations.
 *
 * @module tools/types
 */

import type { DiffEntry, DiffApprovalResult } from './core/diff-utils.js';
import type { LspClient } from './core/lsp-types.js';
import type { SubagentSpawnInput, SubagentResult } from './core/spawn-subagent.js';
import type { ToolResultChunk } from './core/tool-streaming.js';
import type { ToolCall } from '@goli-cli/shared';

/** A JSON Schema definition for a tool's input parameters. */
export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

/** The OpenAI function-calling tool definition format. */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: ToolInputSchema;
  };
}

/** The result of executing a tool. */
export interface ToolResult {
  /** The tool call ID this result corresponds to. */
  toolCallId: string;
  /** Whether the tool execution succeeded. */
  ok: boolean;
  /** The output content (string, may be truncated). */
  content: string;
  /** Error message if `ok` is false. */
  error?: string;
  /** Whether the output was truncated. */
  truncated?: boolean;
  /** Total tokens in the untruncated output (for accounting). */
  totalTokens?: number;
  /** Wall-clock duration in ms. */
  durationMs?: number;
  /** Permission tier required (T0–T3/BLK). Set by the tool. */
  tier?: PermissionTier;
}

/** Permission tiers matching the user's 3-Tier model + extended. */
export type PermissionTier = 'T0' | 'T1' | 'T2' | 'T3' | 'BLK';

/**
 * Request for pre-execution approval, passed to
 * `ToolContext.requestApproval`.
 *
 * P1-3 fix (audit Finding CC-2): this is the contract between T1+
 * tools (bash, write_file, etc.) and the interactive approver (TUI's
 * `PermissionDialog` or headless auto-deny). The tool constructs this
 * after the `ApprovalEngine.decide()` returns `'ask'` and BEFORE
 * executing the action.
 */
export interface ToolApprovalRequest {
  /** The tool call ID this approval is for. */
  toolCallId: string;
  /** The tool name (e.g. `'bash'`, `'write_file'`). */
  toolName: string;
  /** The permission tier the engine classified this action as. */
  tier: PermissionTier;
  /**
   * A short human-readable description of what the action does
   * (e.g. `"rm -rf node_modules"`, `"write 2.3 KB to src/auth.ts"`).
   * The TUI renders this in the PermissionDialog so the user knows
   * what they're approving.
   */
  description: string;
  /**
   * The raw arguments the tool was called with. The TUI may render
   * a preview (e.g. show the bash command, or the diff for write_file).
   * This is the same shape as the tool handler's `args` parameter.
   */
  args: Record<string, unknown>;
  /** ISO timestamp of the request. */
  timestamp: string;
  /**
   * P0-3 fix (remediation plan Phase 3): optional diff payload for
   * mutating tools (edit_file / write_file / edit_batch / notebook_edit).
   *
   * When populated, the TUI's `CliAgentLoop.bridgeRequestApproval`
   * bridges it into the `PendingPermission.diffEntry` field, which
   * `App.tsx` reads to render the `DiffReviewDialog` so the user can
   * visually review the proposed change before approving.
   *
   * When undefined (read-only tools, bash, spawn_subagent, or older
   * callers that don't populate it), the TUI falls back to the
   * simple yes/no/always PermissionDialog — no regression.
   *
   * Tools should populate this for ANY file-mutating action where
   * the user would benefit from seeing the diff before approving.
   * The `oldContent` field is the current file content (empty string
   * for new files via write_file); `newContent` is the proposed
   * content after the edit.
   */
  diffEntry?: {
    /** The absolute or workspace-relative file path. */
    filePath: string;
    /** The tool that produced the diff (edit_file / write_file). */
    tool: string;
    /** The old content (empty string for new files via write_file). */
    oldContent: string;
    /** The proposed new content. */
    newContent: string;
  };
}

/**
 * The user's decision on a `ToolApprovalRequest`.
 */
export interface ToolApprovalDecision {
  /** Whether the user approved the action. */
  approved: boolean;
  /**
   * If `approved` is true and `always` is true, the caller should
   * add this (tool, arg-prefix) pair to the session allowlist so
   * future calls don't re-prompt. The TUI's `AppStateStore.resolveApproval`
   * already handles this — tools just need to propagate the flag.
   */
  always: boolean;
  /** Optional reason for denial (logged for auditability). */
  reason?: string;
}

/** The handler function that executes a tool. */
export type ToolHandler = (
  args: Record<string, unknown>,
  context: ToolContext,
) => Promise<ToolResult> | ToolResult;

/** Runtime context passed to every tool handler. */
export interface ToolContext {
  /** The tool call ID. */
  toolCallId: string;
  /** The workspace root (cwd). */
  workspaceRoot: string;
  /** Set of files the agent has read (for Read-before-Edit tracking). */
  readFiles: Set<string>;
  /** Whether god mode is active (bypasses safety). */
  godMode: boolean;
  /** Whether auto mode is active (auto-approve Tier 2). */
  autoMode: boolean;
  /** The current sandbox mode. */
  sandboxMode: 'read-only' | 'workspace-write' | 'danger-full-access';
  /** Logger instance. */
  logger?: import('@goli-cli/shared/utils/logger.js').Logger;
  /**
   * Pre-execution approval callback (P1-3, audit Finding CC-2 / 3.18 / 6.2).
   *
   * When the ApprovalEngine's `decide()` returns `'ask'`, T1+ tools
   * (bash, write_file, edit_file, notebook_edit, background_shell,
   * spawn_subagent) MUST call this callback BEFORE executing the
   * action. The callback resolves with the user's decision
   * (`{ approved: true, always: boolean }` to proceed, or
   * `{ approved: false, always: false }` to deny). If denied, the
   * tool MUST return a `ToolResult` with `ok: false` and a clear
   * error message — it must NOT execute the action.
   *
   * When `undefined` (headless mode without an interactive approver),
   * tools fall back to the policy: `'ask'` is treated as `'deny'`
   * (fail-closed) so a headless run never silently executes a T1+
   * action that needed approval. The agent can override this with
   * `--auto` (autoMode) or `--god` (godMode) at the CLI level.
   *
   * The TUI provides this callback via `CliAgentLoop.requestApproval`,
   * which delegates to `AppStateStore.waitForApproval()` — the same
   * Promise the `PermissionDialog` resolves when the user picks
   * `[y]es` / `[a]lways` / `[n]o`.
   *
   * This is the fix for the audit's most critical finding: the
   * previous implementation emitted a `tool` event to the TUI AFTER
   * the tool had already started executing, then the TUI called
   * `waitForApproval` — but the bash command had already run by
   * then. Routing approval through `ctx.requestApproval` makes the
   * gate *pre-execution* and *blocking*.
   */
  requestApproval?: (request: ToolApprovalRequest) => Promise<ToolApprovalDecision>;
  /**
   * Diff-first approval callback (H14).
   *
   * When set, mutating tools (edit_file, write_file) MUST call this with
   * the proposed diff BEFORE writing. The callback resolves with the
   * user's per-entry accept/reject decisions. If any entry is rejected,
   * the tool must NOT write that file.
   *
   * When undefined (headless mode without `--diff-review`, or auto-approve),
   * tools write directly without interactive review.
   *
   * The TUI provides this callback via `AppStateStore.waitForDiffReview`.
   * Headless mode provides an auto-accepter when `--diff-review` is passed
   * (otherwise the callback is undefined and tools write directly).
   */
  requestDiffApproval?: (entries: DiffEntry[]) => Promise<DiffApprovalResult>;
  /**
   * Whether diff review has been disabled for the rest of this session
   * (the user pressed `R` to reject all future diffs). Mutating tools
   * should check this and either skip the diff and write directly
   * (if `autoMode`) or refuse to write (otherwise).
   */
  diffReviewDisabled?: boolean;
  /**
   * Whether spec-driven mode is active (H13, ADR-0038).
   *
   * When true, `edit_file`/`write_file` refuse to write unless at
   * least one spec has been approved via `spec_review`. The agent
   * must call `spec_write` then `spec_review` before implementing.
   *
   * Set by the `--spec-mode` CLI flag.
   */
  specMode?: boolean;
  /**
   * Subagent spawn callback (H15, ADR-0039).
   *
   * When set, the `spawn_subagent` tool delegates to this callback to
   * actually spawn a child agent. The callback is responsible for:
   *   - Optionally creating a git worktree for isolation
   *   - Constructing a new AgentLoop with the given role
   *   - Running the subagent to completion
   *   - Returning the result (content, worktree path, branch, etc.)
   *
   * When undefined, `spawn_subagent` throws with a helpful message.
   */
  spawnSubagent?: (input: SubagentSpawnInput) => Promise<SubagentResult>;
  /**
   * Tool-result streaming callback (H18, ADR-0042).
   *
   * When set, tools that produce large outputs (read_file, bash,
   * web_fetch) emit chunks to this callback as they become available.
   * The consumer (TUI or headless) renders the chunks in real-time,
   * giving the user visible progress for long-running tools.
   *
   * When undefined (default), tools return the full result at once —
   * no streaming, no overhead. This is the behavior for scripts and CI.
   *
   * The tool still returns a full `ToolResult` at the end (for the
   * model's context window). Streaming is purely for the user's benefit.
   */
  onToolResultChunk?: (chunk: ToolResultChunk) => void;
  /**
   * LSP client (H21, ADR-0045).
   *
   * When set, the four LSP tools (`lsp_hover`, `lsp_goto_definition`,
   * `lsp_references`, `lsp_diagnostics`) delegate to this client for
   * hover docs, goto-definition, references, and diagnostics.
   *
   * When undefined, the LSP tools throw with a helpful message.
   * The agent loop provides the client (or doesn't, in tests).
   */
  lspClient?: LspClient;
}

/** A registered tool. */
export interface Tool {
  /** The tool name (e.g. `'read_file'`, `'grep'`). */
  name: string;
  /** Human-readable description (used in the tool definition sent to the model). */
  description: string;
  /** JSON Schema for the input parameters. */
  inputSchema: ToolInputSchema;
  /** The handler that executes the tool. */
  handler: ToolHandler;
  /** The permission tier required (default: T1). */
  tier?: PermissionTier;
  /** Whether this tool is read-only (never modifies state). */
  readOnly?: boolean;
  /**
   * Service-gated availability check (Footprint Ladder rung 3, T-020).
   *
   * When present, the ToolRegistry calls this function at schema-generation
   * time. If it returns `false` (or resolves to `false`), the tool is
   * EXCLUDED from the LLM's tool schema — zero permanent schema cost when
   * the prerequisite is unmet.
   *
   * Use cases:
   *  - A `vision_analyze` tool that only appears when `GOLI_VISION_ENDPOINT`
   *    is set.
   *  - A `notebook_edit` tool that only appears when Jupyter is installed.
   *  - An `lsp_hover` tool that only appears when an LSP server is running.
   *
   * The function MAY be async. Results are cached for CHECK_FN_TTL_MS
   * (default 30s) by SelfRegisteringToolRegistry to amortise repeated
   * probes during a single agent turn.
   *
   * Example:
   * ```ts
   * const visionTool: Tool = {
   *   name: 'vision_analyze',
   *   description: 'Analyze an image.',
   *   inputSchema: { ... },
   *   handler: async (args) => { ... },
   *   check_fn: () => Boolean(process.env.GOLI_VISION_ENDPOINT),
   * };
   * ```
   */
  check_fn?: () => boolean | Promise<boolean>;
}

/**
 * Convert a {@link Tool} to the OpenAI tool definition format.
 * @param tool
 */
export function toToolDefinition(tool: Tool): ToolDefinition {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  };
}

/**
 * Convert a {@link ToolResult} to a tool-call update for the conversation.
 * @param toolCall
 * @param result
 */
export function toToolCallUpdate(toolCall: ToolCall, result: ToolResult): ToolCall {
  return {
    ...toolCall,
    status: result.ok ? 'completed' : 'failed',
    result: result.content,
    error: result.error,
    durationMs: result.durationMs,
  };
}
