/**
 * Tool layer public exports (Module 3, part 1).
 *
 * @module tools
 */

/**
 *
 */
export type {
  Tool,
  ToolResult,
  ToolContext,
  ToolDefinition,
  ToolInputSchema,
  ToolHandler,
  PermissionTier,
  ToolApprovalRequest,
  ToolApprovalDecision,
} from './types.js';
/**
 *
 */
export { toToolDefinition, toToolCallUpdate } from './types.js';
/**
 *
 */
export { ToolRegistry } from './registry.js';
/**
 *
 */
export type { ToolRegistryOptions } from './registry.js';
/**
 *
 */
export { validateToolArgs, formatValidationErrors } from './schema-validator.js';
/**
 *
 */
export type { ValidationResult, ValidationError } from './schema-validator.js';
/**
 *
 */
export { truncateResult, MAX_TOOL_RESULT_TOKENS } from './truncation.js';
/**
 *
 */
export type { TruncationResult } from './truncation.js';

// Hooks (Phase 6)
/**
 *
 */
export { HookEngine, registerBuiltinHooks } from './hooks/index.js';
/**
 *
 */
export type {
  HookEvent,
  HookDecision,
  PreToolUseHookResult,
  PostToolUseHookResult,
  UserPromptSubmitHookResult,
  HookContext,
  Hook,
} from './hooks/index.js';
/**
 *
 */
export {
  BLOCK_DESTRUCTIVE_HOOK,
  BLOCK_SECRETS_HOOK,
  BLOCK_WRITES_OUTSIDE_WORKSPACE_HOOK,
  AUTO_FORMAT_HOOK,
  GIT_CHECKPOINT_HOOK,
  AUDIT_LOG_HOOK,
  // P0-8: user-defined hook configuration
  loadUserHooks,
  saveUserHooks,
  hookMatches,
  UserHookSchema,
  UserHookConfigSchema,
} from './hooks/index.js';
/**
 *
 */
export type { UserHook, UserHookConfig } from './hooks/index.js';

// MCP client (Phase 6)
/**
 *
 */
export { MCPClientManager, REFERENCE_MCP_SERVERS, buildReferenceMcpServers } from './mcp/index.js';
/**
 *
 */
export type {
  MCPTransport,
  MCPServerConfig,
  MCPTool,
  MCPSession,
  MCPConnectionState,
  MCPClientManagerOptions,
  MCPToolCallResult,
  ReferenceMcpServer,
} from './mcp/index.js';

// Self-registering registry + toolsets (Hermes improvement H1)
/**
 *
 */
export { SelfRegisteringRegistry, selfRegisteringRegistry, toolError, toolResult } from './self-registering-registry.js';
/**
 *
 */
export type { ToolEntry } from './self-registering-registry.js';
/**
 *
 */
export { TOOLSETS, resolveToolset, listToolsets, getToolsetDefinitions, CORE_TOOLS } from './toolsets.js';
/**
 *
 */
export type { Toolset } from './toolsets.js';

// Footprint Ladder (T-020) — tool classification + rung descriptions.
// The previous barrel omitted these exports, leaving three fully-
// implemented modules as dead code (callable only via deep imports).
/**
 *
 */
export {
  FOOTPRINT_LADDER_RUNGS,
  RUNG_DESCRIPTIONS,
  TOOL_CLASSIFICATIONS,
  describeRung,
  recommendRung,
  classifyAllTools,
} from './footprint-ladder.js';
/**
 *
 */
export type { FootprintLadderRung, ToolClassification } from './footprint-ladder.js';

// Shared path-safety utilities (used by all core file tools).
/**
 *
 */
export { resolveUserPath, checkPathInWorkspace, isSymlink } from './core/path-safety.js';

// Parallel execution (Hermes improvement H4)
/**
 *
 */
export {
  shouldParallelizeToolBatch,
  pathsOverlap,
  executeToolCallsConcurrent,
  PARALLEL_SAFE_TOOLS,
  PATH_SCOPED_TOOLS,
  NEVER_PARALLEL_TOOLS,
  MAX_CONCURRENT_TOOLS,
} from './parallel-execution.js';
/**
 *
 */
export type { ParallelizationDecision } from './parallel-execution.js';

// Checkpoint manager (Hermes improvement H6)
/**
 *
 */
export { CheckpointManager } from './checkpoint-manager.js';
/**
 *
 */
export type { Checkpoint, CheckpointManagerOptions } from './checkpoint-manager.js';

// Dynamic tool manager (next-gen tool layer)
/**
 * Dynamic tool manager — lets the agent create and persist new tools.
 */
export { DynamicToolManager, SAVE_TOOL_TOOL } from './dynamic-tool-manager.js';
/**
 *
 */
export type { DynamicToolManagerOptions } from './dynamic-tool-manager.js';

// Core tools
/**
 *
 */
export { READ_FILE_TOOL } from './core/read-file.js';
/**
 *
 */
export { WRITE_FILE_TOOL } from './core/write-file.js';
/**
 *
 */
export { EDIT_FILE_TOOL } from './core/edit-file.js';
/**
 *
 */
export { LIST_DIRECTORY_TOOL } from './core/list-directory.js';
/**
 *
 */
export { GREP_TOOL } from './core/grep.js';
/**
 *
 */
export { BASH_TOOL } from './core/bash.js';
/**
 * Web search tool (competitive gap #1).
 */
export { WEB_SEARCH_TOOL } from './core/web-search.js';
/**
 * Web fetch tool (competitive gap #1).
 */
export { WEB_FETCH_TOOL } from './core/web-fetch.js';
/**
 * TodoWrite tool — user-visible planning (competitive gap #2).
 */
export { TODO_WRITE_TOOL, getCurrentTodos, clearTodos } from './core/todo-write.js';
/**
 *
 */
export type { TodoItem } from './core/todo-write.js';
/**
 * Background shell management (competitive gap #3).
 */
export { BASH_OUTPUT_TOOL, KILL_SHELL_TOOL, startBackgroundShell, hasShell, cleanupAllShells, getActiveShells } from './core/background-shell.js';
/**
 * AskUserQuestion tool (competitive gap #7).
 */
export { ASK_USER_QUESTION_TOOL, registerPendingQuestion, resolvePendingQuestion } from './core/ask-user.js';
/**
 * NotebookEdit tool (competitive gap #9).
 */
export { NOTEBOOK_EDIT_TOOL } from './core/notebook-edit.js';

// Diff-first editing (Hermes improvement H14, ADR-0037)
/**
 * Diff utilities for diff-first editing — shared by edit_file, write_file,
 * and the TUI's DiffReviewDialog.
 */
export { computeDiff, buildDiffEntry, formatDiffAsString } from './core/diff-utils.js';
/**
 *
 */
export type { DiffEntry, DiffApprovalResult } from './core/diff-utils.js';

// Spec-driven development (Hermes improvement H13, ADR-0038)
/**
 * Spec tools — formal specification documents that gate implementation.
 */
export { SPEC_WRITE_TOOL } from './core/spec-write.js';
/**
 *
 */
export { SPEC_REVIEW_TOOL } from './core/spec-review.js';
/**
 *
 */
export { SPEC_UPDATE_TOOL } from './core/spec-update.js';
/**
 *
 */
export { specRegistry, SpecRegistry, newSpecId, deriveTitle, renderSpecMarkdown } from './core/spec-registry.js';
/**
 *
 */
export type { Spec, SpecStatus } from './core/spec-registry.js';

// Parallel sub-agents (Hermes improvement H15, ADR-0039)
/**
 * spawn_subagent tool — spawns a sub-agent in a git worktree for
 * parallel execution of independent subtasks.
 */
export { SPAWN_SUBAGENT_TOOL } from './core/spawn-subagent.js';
/**
 *
 */
export type { SubagentSpawnInput, SubagentResult } from './core/spawn-subagent.js';

// Tool-result streaming (Hermes improvement H18, ADR-0042)
/**
 * Tool-result streaming utilities — emit chunks to the consumer as
 * they become available, for real-time progress on long-running tools.
 */
export {
  createChunkEmitter,
  splitIntoChunks,
  splitIntoLines,
} from './core/tool-streaming.js';
/**
 *
 */
export type { ToolResultChunk } from './core/tool-streaming.js';

// LSP integration (Hermes improvement H21, ADR-0045)
/**
 * LSP tools — hover, goto-definition, references, diagnostics.
 */
export {
  LSP_HOVER_TOOL,
  LSP_GOTO_DEFINITION_TOOL,
  LSP_REFERENCES_TOOL,
  LSP_DIAGNOSTICS_TOOL,
  LSP_TOOLS,
} from './core/lsp-tools.js';
/**
 *
 */
export type {
  LspClient,
  LspLocation,
  LspHoverResult,
  LspDiagnostic,
  LspSeverity,
} from './core/lsp-types.js';
/**
 *
 */
export { formatLocation, formatDiagnostic } from './core/lsp-types.js';
// P3-4: Concrete LSP client implementation (TypeScript).
/**
 *
 */
export { TypeScriptLspClient } from './core/typescript-lsp-client.js';

// Internal imports for createDefaultToolRegistry
import { ASK_USER_QUESTION_TOOL } from './core/ask-user.js';
import { BASH_OUTPUT_TOOL } from './core/background-shell.js';
import { KILL_SHELL_TOOL } from './core/background-shell.js';
import { BASH_TOOL } from './core/bash.js';
import { EDIT_FILE_TOOL } from './core/edit-file.js';
import { GREP_TOOL } from './core/grep.js';
import { LIST_DIRECTORY_TOOL } from './core/list-directory.js';
import {
  LSP_HOVER_TOOL,
  LSP_GOTO_DEFINITION_TOOL,
  LSP_REFERENCES_TOOL,
  LSP_DIAGNOSTICS_TOOL,
} from './core/lsp-tools.js';
import { NOTEBOOK_EDIT_TOOL } from './core/notebook-edit.js';
import { READ_FILE_TOOL } from './core/read-file.js';
import { SPAWN_SUBAGENT_TOOL } from './core/spawn-subagent.js';
import { SPEC_REVIEW_TOOL } from './core/spec-review.js';
import { SPEC_UPDATE_TOOL } from './core/spec-update.js';
import { SPEC_WRITE_TOOL } from './core/spec-write.js';
import { TODO_WRITE_TOOL } from './core/todo-write.js';
import { WEB_FETCH_TOOL } from './core/web-fetch.js';
import { WEB_SEARCH_TOOL } from './core/web-search.js';
import { WRITE_FILE_TOOL } from './core/write-file.js';
import { HookEngine, registerBuiltinHooks } from './hooks/index.js';
import { ToolRegistry } from './registry.js';

/**
 * Create a ToolRegistry with all default core tools + builtin hooks registered.
 *
 * The registry includes:
 * - 21 core tools across 3 tiers:
 *   - T0 (Safe, 12): read_file, list_directory, grep, web_search, web_fetch,
 *     todo_write, bash_output, ask_user, lsp_hover, lsp_goto_definition,
 *     lsp_references, lsp_diagnostics
 *   - T1 (Risky, 7): write_file, edit_file, notebook_edit, spec_write,
 *     spec_review, spec_update, kill_shell
 *   - T2 (Destructive, 2): bash, spawn_subagent
 * - 6 builtin hooks (block_destructive, block_secrets, block_writes_outside_workspace,
 *   audit_log, auto_format, git_checkpoint)
 *
 * P1-8 fix (verification report item #14): the previous docstring said
 * "12 core tools" which was stale — the registry grew to 21 tools as
 * LSP, spec, and other tools were added. The actual count is verified
 * by `tests/unit/tool-registry.test.ts` and `footprint-ladder.ts:79`.
 *
 * @param opts
 */
export function createDefaultToolRegistry(
  opts?: import('./registry.js').ToolRegistryOptions,
): ToolRegistry {
  const hookEngine = new HookEngine({ logger: opts?.logger });
  registerBuiltinHooks(hookEngine);

  const registry = new ToolRegistry({
    ...opts,
    hookEngine,
  });
  // File tools (T0/T1)
  registry.register(READ_FILE_TOOL);
  registry.register(WRITE_FILE_TOOL);
  registry.register(EDIT_FILE_TOOL);
  registry.register(LIST_DIRECTORY_TOOL);
  registry.register(GREP_TOOL);
  registry.register(BASH_TOOL);
  // Web tools (T0) — competitive gap #1
  registry.register(WEB_SEARCH_TOOL);
  registry.register(WEB_FETCH_TOOL);
  // Planning tool (T0) — competitive gap #2
  registry.register(TODO_WRITE_TOOL);
  // Background shell management (T0/T1) — competitive gap #3
  registry.register(BASH_OUTPUT_TOOL);
  registry.register(KILL_SHELL_TOOL);
  // Structured clarification (T0) — competitive gap #7
  registry.register(ASK_USER_QUESTION_TOOL);
  // Notebook editing (T1) — competitive gap #9
  registry.register(NOTEBOOK_EDIT_TOOL);
  // Spec-driven development (T0/T1) — Hermes improvement H13
  registry.register(SPEC_WRITE_TOOL);
  registry.register(SPEC_REVIEW_TOOL);
  registry.register(SPEC_UPDATE_TOOL);
  // Parallel sub-agents (T2) — Hermes improvement H15
  registry.register(SPAWN_SUBAGENT_TOOL);
  // LSP integration (T0) — Hermes improvement H21
  registry.register(LSP_HOVER_TOOL);
  registry.register(LSP_GOTO_DEFINITION_TOOL);
  registry.register(LSP_REFERENCES_TOOL);
  registry.register(LSP_DIAGNOSTICS_TOOL);
  return registry;
}
