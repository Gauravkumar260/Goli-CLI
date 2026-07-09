/**
 * Tool layer types (Module 3, part 1).
 *
 * Defines the core data structures for the tool registry: Tool, ToolResult,
 * ToolInput, ToolSchema. These types are the contract between the agent
 * loop (Module 1) and the tool implementations.
 *
 * @module tools/types
 */

import type { ToolCall } from '../agent/types.js';
import type { DiffEntry, DiffApprovalResult } from './core/diff-utils.js';
import type { LspClient } from './core/lsp-types.js';
import type { SubagentSpawnInput, SubagentResult } from './core/spawn-subagent.js';
import type { ToolResultChunk } from './core/tool-streaming.js';

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
  logger?: import('../utils/logger.js').Logger;
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
