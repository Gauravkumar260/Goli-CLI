/**
 * ReAct master loop (Module 1).
 *
 * The single-threaded master loop that powers every agent in the 11-agent
 * swarm. Each iteration:
 *
 * 1. **Pre-check + compaction** — check budget; if context > 50% (in-loop)
 *    or > 85% (safety-net), compact (ADR-0023 revised — see
 *    `docs/decisions/0023-compaction-at-70-percent.md` Revision Notes)
 * 2. **Assemble system prompt** — from 13 conditional fragments
 *    (identity, tools, sandbox, mode, language, git, todo, memory,
 *    retrieved-context, skills, recent-read-files, safety,
 *    output-format — see `agent/system-prompt.ts`)
 * 3. **Call model** — with streaming, tools, and reasoning effort
 * 4. **Parse response** — content, thinking, tool calls (defensive JSON)
 * 5. **Check stop conditions** — natural completion / budget / stall / error
 * 6. **Execute tool calls** — dispatch to tool registry (Phase 4 implements
 *    the registry; Phase 2 stubs tool execution with a "not implemented" result)
 * 7. **Append results to conversation** — for the next iteration's context
 * 8. **Update budget + stall detector** — record tokens, tool calls
 *
 * The loop is an async generator that yields {@link AgentEvent}s. The TUI
 * (Phase 3) and the CLI consume these to render streaming output.
 *
 * ## Phase 2 Status
 *
 * Phase 2 implements the loop with:
 * - ✅ Streaming model client
 * - ✅ Dynamic system prompt assembler
 * - ✅ TODO/planner engine
 * - ✅ Budget tracker (4 dimensions)
 * - ✅ Stall detector
 * - ✅ Retry with jittered backoff
 * - ✅ 4-condition stop engine
 * - ⏳ Tool execution (STUB — Phase 4 implements the tool registry)
 * - ⏳ Compaction (STUB — Phase 7 implements the context engine)
 *
 * @module agent/loop
 */

import { randomUUID } from 'node:crypto';
import { readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

import { MidSessionIntegrityChecker } from '@goli-cli/config/integrity.js';
import { isToolAllowedForMode } from '@goli-cli/config/mode-prompts.js';
import { OllamaProvider } from '@goli-cli/llm-providers/ollama.js';
import { type ToolRegistry, createDefaultToolRegistry, toToolDefinition } from '@goli-cli/tool-system/index.js';
import { MCPClientManager } from '@goli-cli/tool-system/mcp/index.js';
import { executeToolCallsConcurrent } from '@goli-cli/tool-system/parallel-execution.js';


import { AdvancedCompressor } from './advanced-compression.js';
import { BudgetTracker } from './budget.js';
import { type CredentialPool } from './credential-pool.js';
import { EffortRoutingClient } from './effort-router.js';
import { classifyApiError } from './error-classifier.js';
import { createFrozenSnapshot, type FrozenSnapshot } from './frozen-snapshot.js';
import { parseToolCallArgs } from './json-repair.js';
import { LocalLlmsRouter } from './local-llms-router.js';
import { LoopDetector } from './loop-detector.js';
import { Planner, PLAN_TASK_TOOL } from './planner.js';
import { ProvenanceTracker, deriveToolSource } from './provenance.js';
import { ProviderBackedModelClient, createProviderBackedClientSync } from './provider-adapter.js';
import { ReflexionEngine } from './reflexion.js';
import { callWithRetry } from './retry.js';
import { StallDetector } from './stall-detector.js';
import { StopEngine } from './stop-engine.js';
import { SystemPromptAssembler } from './system-prompt.js';
import { ToolGuardrailController } from './tool-guardrails.js';
import { ToolsetSnapshot } from './toolset-snapshot.js';

import type {
  Message,
  ToolCall,
  Todo,
  ConversationState,
  AgentEvent,
  AgentRole,
} from './types.js';
import type { AppConfig, ReasoningEffort } from '@goli-cli/config/schema.js';
import type { TrajectoryEntry } from '@goli-cli/memory-engine/skills/types.js';
import type { Logger } from '@goli-cli/shared/utils/logger.js';
import type { ToolContext } from '@goli-cli/tool-system/index.js';
import type { MCPServerConfig, MCPTool } from '@goli-cli/tool-system/mcp/index.js';
import type { McpInputSchema } from '@goli-cli/tool-system/mcp/types.js';
import type { ToolDefinition, ToolApprovalRequest, ToolApprovalDecision } from '@goli-cli/tool-system/types.js';

// Lazy-cached loader for the ephemeral SessionMemory module. The memory
// graph is heavy and only needed when a memory curator is configured, so we
// keep it out of the static import graph and instantiate on first use.
let sessionMemoryModule:
  | typeof import('@goli-cli/memory-engine/session/ephemeral.js')
  | undefined;

async function loadSessionMemory(): Promise<
  import('@goli-cli/memory-engine/session/ephemeral.js').SessionMemory
> {
  if (!sessionMemoryModule) {
    sessionMemoryModule = await import('@goli-cli/memory-engine/session/ephemeral.js');
  }
  return new sessionMemoryModule.SessionMemory();
}

/**
 * Minimal interface the agent loop needs from a model client.
 * Any provider adapter or direct provider wrapper can satisfy this.
 */
interface ModelClient {
  call(params: {
    messages: Message[];
    tools?: ToolDefinition[];
    effort?: ReasoningEffort;
    stream?: boolean;
    onChunk?: (chunk: unknown) => void;
    signal?: AbortSignal;
  }): Promise<{
    content: string;
    thinking: string;
    toolCalls: ToolCall[];
    inputTokens: number;
    outputTokens: number;
    thinkingTokens: number;
    finishReason: string;
  }>;
  markCredentialError?(error: unknown): void;
}

/** Options for constructing an {@link AgentLoop}. */
export interface AgentLoopOptions {
  /** The loaded and validated app config. */
  config: AppConfig;
  /** Logger instance. */
  logger: Logger;
  /** Whether --god mode is active (bypasses safety). */
  godMode?: boolean;
  /** Whether --auto mode is active (auto-approve Tier 2 actions). */
  autoMode?: boolean;
  /** Override reasoning effort for this run. */
  effortOverride?: ReasoningEffort;
  /** Override model ID for this run. */
  modelOverride?: string;
  /**
   * Optional credential pool for multi-key failover (H3).
   *
   * When provided, the provider draws API keys from the pool instead
   * of the static config key. On 429/402 errors, the retry layer
   * automatically rotates to the next available key.
   */
  credentialPool?: CredentialPool;
  /**
   * The current AppMode (read-only / plan / build / god). Controls
   * the mode-specific system-prompt fragment AND the tool-filtering
   * logic. If absent, defaults to `godMode ? 'god' : 'build'`.
   */
  appMode?: 'read-only' | 'plan' | 'build' | 'god' | 'local-llms';
  /**
   * Pre-execution approval callback (P1-3, audit Finding CC-2).
   *
   * When set, this is propagated into every `ToolContext` so that T1+
   * tools (bash, write_file, edit_file, notebook_edit, background_shell,
   * spawn_subagent) can block on user approval BEFORE executing.
   *
   * When undefined (headless mode without an interactive approver),
   * tools fail-closed: `ApprovalEngine.decide() === 'ask'` is treated
   * as `'deny'`. The caller can override this with `--auto` or `--god`.
   *
   * The TUI provides this callback via `CliAgentLoop.requestApproval`,
   * which delegates to `AppStateStore.waitForApproval()`.
   */
  requestApproval?: (request: ToolApprovalRequest) => Promise<ToolApprovalDecision>;
  /**
   * MCP server configurations (P2-5, audit Finding 5.11 / 5.12).
   *
   * When provided, the AgentLoop instantiates a `MCPClientManager`,
   * connects to each server (stdio or http), discovers tools via
   * `tools/list`, and registers each as a virtual `Tool` in the
   * registry with the namespaced name `serverName:toolName` and
   * tier `T1`. The virtual tool's handler delegates to
   * `mcpManager.callTool()`.
   *
   * When undefined (no MCP servers configured), the MCP subsystem is
   * not initialized — the previous implementation exported
   * `MCPClientManager` but never instantiated it, so MCP servers
   * configured via `goli mcp add` were never connected at agent
   * startup. MCP tool calls also bypassed the approval pipeline
   * (Finding 5.12); we now route them through the same `ctx.requestApproval`
   * gate as builtin tools by giving them tier `T1`.
   *
   * The CLI loads this from `$GOLI_HOME/mcp-servers.toml` via
   * `loadMcpServers()` in `cli/src/commands/mcp-config.ts`.
   */
  mcpServers?: MCPServerConfig[];
  /**
   * Memory curator (P2-6, audit Finding 5.28 / CC-4).
   *
   * When provided, the AgentLoop instantiates a `SessionMemory` and
   * records within-session learnings (tool results that look like
   * durable facts). At the end of each `run()`, the curator's
   * `curate()` method is called to promote learnings from ephemeral
   * session memory to persistent files (MEMORY.md / USER.md /
   * PROJECT.md). Without this, within-session learnings never reach
   * L2 — the 3-tier memory is actually 2 disconnected tiers.
   *
   * When undefined, no memory curation happens (the agent still runs
   * — curation is an enhancement, not a hard gate).
   */
  memoryCurator?: import('@goli-cli/memory-engine/curator/agent.js').MemoryCurator;
  /**
   * Context engine bundle (P2-7, audit Finding 5.31 / 5.34 / CC-4).
   *
   * When provided, the AgentLoop queries the hybrid retriever
   * (tree-sitter symbol graph + ripgrep lexical + semantic) with the
   * task prompt at the start of each `run()` and injects the top-k
   * results into the system prompt as a "Retrieved Context" fragment.
   * This lets the agent see relevant symbols, callers, and file paths
   * before its first tool call — reducing exploratory read_file/grep.
   *
   * The bundle is created by `createContextEngine({ workspaceRoot })`
   * (from `@goli/core`). The caller is responsible for calling
   * `bundle.indexWorkspace(filePaths)` to populate the symbol graph;
   * without that, the retriever returns empty results (no harm, but
   * no benefit either).
   *
   * When undefined, no code-intelligence context is injected.
   */
  contextEngine?: ReturnType<typeof import('@goli-cli/context-engine/index.js').createContextEngine>;
  /**
   * LSP client (P3-4, audit Finding 5.23).
   *
   * When provided, the 4 LSP tools (`lsp_hover`, `lsp_goto_definition`,
   * `lsp_references`, `lsp_diagnostics`) delegate to this client.
   * Without it, they throw "LSP client not configured".
   *
   * The CLI constructs a `TypeScriptLspClient` (spawning
   * `typescript-language-server --stdio`). Other languages (Python,
   * Rust, Go) would need their own `LspClient` implementations.
   */
  lspClient?: import('@goli-cli/tool-system/core/lsp-types.js').LspClient;
  /**
   * P1-4 fix (verification report item #4): SkillLoader for the skills
   * subsystem (ADR-0026). When provided, the AgentLoop calls
   * `formatL1ForPrompt()` once per run (at the top of the ReAct loop,
   * before assembling the system prompt) and injects the result as the
   * `skillsL1` field on `SystemPromptContext`. The system-prompt
   * assembler then renders it as the "Skills" fragment.
   *
   * When undefined, no skills fragment is injected (the agent has no
   * skill catalog). This preserves backward compatibility for callers
   * that don't configure a SkillLoader.
   */
  skillLoader?: import('@goli-cli/memory-engine/skills/loader.js').SkillLoader;
  /**
   * P2-18 fix (remediation plan Phase 18): Reflexion engine for
   * post-failure strategy adaptation. When provided, the AgentLoop
   * calls `reflect()` after each tool-call failure (best-effort,
   * non-blocking) and injects the accumulated reflections into the
   * next system prompt as a "Recent Reflections" fragment.
   *
   * When undefined, the AgentLoop constructs a default ReflexionEngine
   * with no LLM client (heuristic-only mode — maps error categories to
   * pre-written strategies). Callers that want LLM-driven reflections
   * should construct `new ReflexionEngine({ llmClient, logger })` and
   * pass it here.
   */
  reflexionEngine?: ReflexionEngine;
  /**
   * P0-7 fix (remediation plan Phase 7): SkillWriter for extracting
   * skills from successful trajectories. When provided, the AgentLoop
   * calls `createSkill(trajectory)` at the end of each successful run
   * (5+ tool calls + `ok: true`). The SkillWriter archives any
   * existing version before writing the new one, preserving the full
   * version history.
   *
   * When undefined, no skill extraction happens (the agent still runs
   * — extraction is an enhancement, not a gate).
   */
  skillWriter?: import('@goli-cli/memory-engine/skills/writer.js').SkillWriter;
}

/** Input to a single agent run. */
export interface AgentLoopInput {
  /** The user's prompt. */
  prompt: string;
  /** The agent role (Phase 2: always 'orchestrator'). */
  role?: AgentRole;
  /** Abort signal (for cancellation). */
  signal?: AbortSignal;
  /**
   * Per-run AppMode override. If set, overrides the loop's default
   * `appMode` for this run only. This lets the TUI pass the current
   * mode without reconstructing the AgentLoop.
   */
  appMode?: 'read-only' | 'plan' | 'build' | 'god' | 'local-llms';
  /**
   * P1-9 fix (remediation plan Phase 9): optional session ID for
   * provenance tagging. When provided, propagated to
   * `state.sessionId` and stamped onto every `ToolCall.provenance`
   * emitted during this run. When absent, the loop generates one via
   * `crypto.randomUUID()` so provenance is always attributable.
   */
  sessionId?: string;
}

/** Result of a single agent run. */
export interface AgentLoopResult {
  /** Whether the run completed without errors. */
  ok: boolean;
  /** Why the run stopped. */
  stopReason?: 'completed' | 'budget' | 'stall' | 'error' | 'aborted' | 'not-implemented' | 'loop_detected';
  /** Final assistant content (concatenated from all iterations). */
  content: string;
  /** Total tokens consumed (input + output + thinking). */
  totalTokens: number;
  /** Total cost in USD. */
  totalCostUsd: number;
  /** Number of iterations completed. */
  iterations: number;
  /** Wall-clock duration in ms. */
  durationMs: number;
  /** Final TODO list. */
  todos: Todo[];
  /** Error message (if `ok` is false). */
  error?: string;
  /**
   * P2-9 fix (re-verification report item N3): all tool calls made
   * during this run, collected from `state.messages` (assistant turns
   * carry `toolCalls` arrays). Surfaced so consumers like the CLI's
   * `CliAgentLoop` can render the tool-call trail in the transcript
   * without re-scanning the message history.
   *
   * Each entry mirrors the `ToolCall` shape from `./types.ts` (id,
   * name, arguments, status, result, error, durationMs, tokensUsed).
   * The `tier` field is NOT present here (tiers are an approval-layer
   * concept); consumers that need tier info should look it up via
   * `ApprovalEngine.classifyCommand` or the tool registry.
   */
  toolCalls?: ToolCall[];
  /**
   * P1-11 fix (remediation plan Phase 11): details of the most recent
   * compaction that ran during this `run()` call. Populated by the
   * in-loop compaction check (50% trigger) or the retry layer's
   * `forceCompaction` flag (overflow trigger). When undefined, no
   * compaction occurred (token usage stayed under the threshold).
   *
   * `CliAgentLoop` consumes this to emit a `kind: 'compaction'` event
   * to the TUI so the user sees a banner showing tokens reclaimed.
   */
  lastCompaction?: CompactionSummary;
}

/**
 * P1-11: Summary of a single compaction pass. Mirrors the fields the TUI
 * needs to render the `CompactionBanner`. Populated from
 * `AdvancedCompressor.CompressionResult` (mapped in `loop.ts`).
 */
export interface CompactionSummary {
  /** What triggered the compaction. */
  triggeredBy: 'auto' | 'manual' | 'overflow';
  /** Tokens before compaction. */
  tokensBefore: number;
  /** Tokens after compaction. */
  tokensAfter: number;
  /** Tokens reclaimed. */
  tokensReclaimed: number;
  /** Wall-clock duration in ms. */
  durationMs: number;
  /** Number of messages evicted by the Evict layer. */
  evictedTurns: number;
  /** Number of tool results pruned by the Prune layer. */
  summarizedTurns: number;
  /** The 7-phase layers that ran (dedupe/boundaries/evict/prune/summarize/freeze/assemble). */
  layersApplied: string[];
}

/**
 * P1-11 fix (verification report deferred item #3): Infer the permission
 * tier of an MCP tool from its name and input schema, instead of
 * hardcoding `tier: 'T1'` for every MCP tool.
 *
 * Heuristic (name-based, then schema-based fallback):
 *   - T0 (Safe, read-only): tool name contains `search`, `list`, `get`,
 *     `read`, `fetch`, `query`, `describe`, `status`, `info`, `view`,
 *     `inspect`, or `ping`. These are conventionally read-only operations.
 *   - T2 (Destructive, state-modifying): tool name contains `create`,
 *     `update`, `delete`, `remove`, `write`, `post`, `put`, `patch`,
 *     `send`, `publish`, `deploy`, `execute`, `run`, `start`, `stop`,
 *     `restart`, `kill`, `terminate`, or the input schema has a
 *     `command`/`script`/`code`/`query` property (exec or SQL injection
 *     risk).
 *   - T1 (Risky, default): everything else. MCP tools are external, so
 *     we default to the "ask before running" tier rather than T0.
 *   - T3 (Network): not inferred — T3 is for tools that make outbound
 *     network calls the sandbox should restrict. MCP tools all
 *     communicate via stdio/http to the MCP server, so the network
 *     boundary is at the server, not the tool. T3 is reserved for
 *     future use.
 *
 * The heuristic is conservative: when in doubt, we pick the HIGHER
 * (more restrictive) tier. A read-only tool misclassified as T1 just
 * means an extra approval prompt; a destructive tool misclassified as
 * T0 means the agent can run it without asking. So the name-based T0
 * detection is intentionally narrow (only well-known read-only verbs).
 *
 * @param toolName - The MCP tool name (without the server prefix).
 * @param inputSchema - The tool's JSON Schema (used for the exec/SQL
 *   fallback check).
 * @returns The inferred {@link PermissionTier}.
 */
function inferMcpToolTier(
  toolName: string,
  inputSchema: McpInputSchema,
): import('@goli-cli/tool-system/types.js').PermissionTier {
  const name = toolName.toLowerCase();

  // ─── T0: read-only verbs ──────────────────────────────────────────
  // Match common read-only operation prefixes/words. We use word
  // boundaries so `list_issues` matches but `list_issues_to_delete`
  // also matches (the destructive verb `delete` wins later).
  const readOnlyVerbs = [
    'search', 'list', 'get', 'read', 'fetch', 'query', 'describe',
    'status', 'info', 'view', 'inspect', 'ping', 'whoami', 'health',
    'count', 'exists', 'find',
  ];
  // ─── T2: state-modifying verbs ────────────────────────────────────
  const destructiveVerbs = [
    'create', 'update', 'delete', 'remove', 'write', 'post', 'put',
    'patch', 'send', 'publish', 'deploy', 'execute', 'run', 'start',
    'stop', 'restart', 'kill', 'terminate', 'cancel', 'submit', 'apply',
    'merge', 'approve', 'reject', 'archive', 'purge', 'wipe', 'reset',
  ];

  // Check destructive verbs FIRST (a tool named `delete_and_list` is
  // destructive even though it contains `list`).
  for (const verb of destructiveVerbs) {
    // Match as a word boundary so `get` doesn't match `budget`.
    const re = new RegExp(`\\b${verb}`, 'i');
    if (re.test(name)) {
      return 'T2';
    }
  }

  // Then check read-only verbs.
  for (const verb of readOnlyVerbs) {
    const re = new RegExp(`\\b${verb}`, 'i');
    if (re.test(name)) {
      return 'T0';
    }
  }

  // ─── Schema-based fallback: exec / SQL injection risk ─────────────
  // If the input schema has a `command`, `script`, `code`, or `query`
  // property, the tool likely executes arbitrary code or SQL — treat
  // as T2 (destructive). This catches tools like `shell_exec`,
  // `db_query`, `eval_code` even if the name doesn't contain a
  // destructive verb.
  const props = inputSchema.properties ?? {};
  const execLikeProps = ['command', 'script', 'code', 'query', 'sql', 'cmd', 'expr'];
  for (const prop of execLikeProps) {
    if (prop in props) {
      return 'T2';
    }
  }

  // ─── Default: T1 (Risky) ──────────────────────────────────────────
  // MCP tools are external — we default to "ask before running" rather
  // than T0 because we can't verify what the server actually does.
  return 'T1';
}

/**
 * The agent loop — a single-threaded ReAct master loop.
 *
 * Usage:
 * ```ts
 * const loop = new AgentLoop({ config, logger });
 * const result = await loop.run({ prompt: 'Fix the bug in parser.ts' });
 * console.log(result.content);
 * ```
 */
export class AgentLoop {
  private readonly config: AppConfig;
  private readonly log: Logger;
  private readonly godMode: boolean;
  private readonly autoMode: boolean;
  private readonly effort: ReasoningEffort;
  private readonly client: ModelClient;
  private readonly assembler: SystemPromptAssembler;
  private readonly planner: Planner;
  private readonly budget: BudgetTracker;
  private readonly stallDetector: StallDetector;
  private readonly toolRegistry: ToolRegistry;
  private readonly compressor: AdvancedCompressor;
  /** Tool-call loop guardrails (H8) — detects exact-failure, same-tool-failure, and no-progress loops. */
  private readonly guardrails: ToolGuardrailController;
  /** T-065: Loop detector — catches repeated identical tool calls / content outputs. */
  private readonly loopDetector: LoopDetector;
  /**
   * P2-2: Provenance tracker — tags every context block (message, tool
   * result) with its source (user / trusted / web / tool / untrusted).
   * Used for prompt-injection defense: sensitive tools (bash, write_file)
   * can call `canTriggerAction(toolName, recentBlockIds)` to check whether
   * the instruction to call them came from a trusted source. The previous
   * implementation exported `ProvenanceTracker` but never instantiated it,
   * so the prompt-injection defense was inert.
   */
  private readonly provenance: ProvenanceTracker;
  /** Flag set by the retry callback when the error classifier says context is too long. */
  private forceCompaction = false;
  private stopEngine?: StopEngine;
  // Per-run abort controller. A fresh one is created at the top of each
  // `run()` so that aborting one run does not poison subsequent runs
  // (the previous implementation shared a single controller across all
  // runs, which made the loop a no-op after the first abort).
  private currentAbortController?: AbortController;
  /**
   * The default AppMode for this loop. Can be overridden per-run via
   * `AgentLoopInput.appMode`. If absent, derived from `godMode`.
   */
  private readonly defaultAppMode: 'read-only' | 'plan' | 'build' | 'god' | 'local-llms';
  /**
   * P1-3: Pre-execution approval callback. Propagated into every
   * `ToolContext` so T1+ tools can block on user approval. When
   * undefined, tools fail-closed (treat 'ask' as 'deny').
   */
  private readonly requestApproval?: (request: ToolApprovalRequest) => Promise<ToolApprovalDecision>;
  /**
   * P2-5: MCP client manager. When `mcpServers` is provided in the
   * constructor options, this is instantiated and used to connect to
   * each server, discover tools, and register them as virtual `Tool`s
   * in the registry. When undefined, no MCP tools are available.
   */
  private readonly mcpManager?: MCPClientManager;
  /**
   * P2-5: MCP server configs pending connection. Set in the constructor
   * when `opts.mcpServers` is non-empty; consumed and cleared by
   * `connectMcpServers()`.
   */
  private pendingMcpConfigs?: MCPServerConfig[];
  /**
   * P2-6: Memory curator. When `memoryCurator` is provided in the
   * constructor options, this holds the reference; `run()` calls
   * `curator.curate(sessionMemory.getAll())` at the end of each turn
   * to promote learnings to persistent memory.
   */
  private readonly memoryCurator?: import('@goli-cli/memory-engine/curator/agent.js').MemoryCurator;
  /**
   * P2-6: Ephemeral session memory. Records within-session learnings
   * (tool results that look like durable facts). Instantiated only
   * when `memoryCurator` is provided. Cleared at the start of each
   * `run()` so cross-run learnings don't bleed.
   */
  private sessionMemory?: import('@goli-cli/memory-engine/session/ephemeral.js').SessionMemory;
  /**
   * P2-7: Context engine bundle (tree-sitter indexer + symbol graph +
   * hybrid retriever). When provided, the loop queries the retriever
   * with the task prompt at the start of each `run()` and injects the
   * results into the system prompt.
   */
  private readonly contextEngine?: ReturnType<typeof import('@goli-cli/context-engine/index.js').createContextEngine>;
  /**
   * P3-1: FrozenSnapshot captured at session start. Re-injected by the
   * compressor's Freeze layer after every compaction so the agent
   * never loses sight of the original task / role / constraints.
   * Set once on the first `run()` call, then reused for subsequent runs.
   */
  private frozenSnapshot?: FrozenSnapshot;
  /**
   * P3-3: Current subagent depth. 0 = top-level agent. Each nested
   * `spawnSubagent` call increments this. Capped at `maxSubagentDepth`
   * (default 3) to prevent infinite recursion.
   */
  private currentDepth = 0;
  /**
   * P3-3: Maximum subagent nesting depth (default 3). Prevents
   * runaway recursion where a subagent spawns a subagent that spawns
   * a subagent... The cap is conservative; the brief doesn't specify
   * a number but 3 matches Claude Code's default.
   */
  private readonly maxSubagentDepth: number = 3;
  /**
   * P3-4: LSP client. When provided, the 4 LSP tools delegate to it.
   * When undefined, they throw "LSP client not configured".
   */
  private readonly lspClient?: import('@goli-cli/tool-system/core/lsp-types.js').LspClient;
  /**
   * P1-4 fix (verification report item #4): SkillLoader for the skills
   * subsystem. Stored at construction; queried once per `run()` to
   * populate `skillsL1` in the system prompt.
   */
  private readonly skillLoader?: import('@goli-cli/memory-engine/skills/loader.js').SkillLoader;
  /**
   * P0-7 fix (remediation plan Phase 7): SkillWriter for extracting
   * skills from successful trajectories. Stored at construction;
   * called from `run()` after a successful run with 5+ tool calls.
   */
  private readonly skillWriter?: import('@goli-cli/memory-engine/skills/writer.js').SkillWriter;
  /**
   * P2-18 fix (remediation plan Phase 18): ReflexionEngine for
   * post-failure strategy adaptation. Stored at construction; called
   * from `executeToolCall()` after a tool failure (best-effort) and
   * queried at system-prompt assembly time via `formatForPrompt()`.
   */
  private readonly reflexionEngine: ReflexionEngine;
  /**
   * P0-4 fix (remediation plan Phase 4): tracks whether the context
   * engine's symbol graph has been populated for this AgentLoop
   * instance. Set to `true` after `initializeSymbolGraph()` completes
   * (success or failure). Subsequent `run()` calls skip the indexing
   * step — the symbol graph persists for the lifetime of the
   * AgentLoop instance (in-memory). Reset to `false` if the caller
   * ever wants to force a re-index (e.g. after a bulk file change).
   */
  private symbolGraphIndexed = false;
  /**
   * P0-5 fix (remediation plan Phase 5): mid-session policy integrity
   * checker. Captures a baseline hash of all safety-critical files
   * (approval/engine.ts, sandbox/executor.ts, config/integrity.ts,
   * memory/sica/immutable-registry.ts, etc.) at the start of the
   * first `run()` call, then re-verifies before each T1+ tool
   * execution. When a mismatch is detected, the tool call is denied
   * and the run aborts.
   *
   * The check is cached for 60 seconds (see `MID_SESSION_CACHE_TTL_MS`)
   * so the per-T1+ overhead is negligible after the first check.
   */
  private readonly integrityChecker: MidSessionIntegrityChecker;
  /**
   * P0-5: tracks whether the integrity baseline has been captured.
   * Set to `true` after the first `run()` call. Subsequent runs
   * reuse the same baseline (so changes are detected across the
   * entire session).
   */
  private policyBaselineCaptured = false;
  /**
   * P2-9 fix (re-verification report item N2/N3): the result of the
   * most recent `run()` call. Stored so `runStream()` consumers (and
   * any caller that wants post-hoc access to tool calls / token usage
   * after the stream ends) can retrieve it via `getLastRunResult()`
   * without re-running the loop.
   *
   * Reset to `null` at the start of each `run()` call so concurrent
   * (or overlapping) runs don't leak the previous result.
   */
  private lastResult: AgentLoopResult | null = null;
  /**
   * P1-11 fix (remediation plan Phase 11): cached compaction summary
   * from the most recent `compressor.compress()` call. Reset to
   * `undefined` at the start of each `run()` so a stale summary from
   * a previous run doesn't leak. Surfaced on `AgentLoopResult.lastCompaction`
   * so `CliAgentLoop` can emit a `kind: 'compaction'` event to the TUI.
   */
  private lastCompactionSummary?: CompactionSummary;

  constructor(opts: AgentLoopOptions) {
    this.config = opts.config;
    this.log = opts.logger;
    this.godMode = opts.godMode ?? false;
    this.autoMode = opts.autoMode ?? false;
    this.effort = opts.effortOverride ?? opts.config.model.defaultEffort;
    this.defaultAppMode = opts.appMode ?? (this.godMode ? 'god' : 'build');
    // P1-3: Store the pre-execution approval callback so we can
    // propagate it into every ToolContext in executeToolCall().
    this.requestApproval = opts.requestApproval;
    // P2-6: Store the memory curator and instantiate a SessionMemory
    // to collect within-session learnings. The curator runs at the
    // end of each `run()` to promote learnings to persistent files.
    this.memoryCurator = opts.memoryCurator;
    // SessionMemory is instantiated lazily on first `run()` (see
    // loadSessionMemory) so the memory module graph isn't loaded when
    // curation is not configured.
    // P2-7: Store the context engine bundle. The retriever is queried
    // at the start of each `run()` to populate `retrievedContext` in
    // the system prompt.
    this.contextEngine = opts.contextEngine;
    // P3-4: Store the LSP client. Propagated into every ToolContext so
    // the 4 LSP tools can delegate hover/goto-definition/references/
    // diagnostics queries.
    this.lspClient = opts.lspClient;
    // P1-4 fix (verification report item #4): Store the SkillLoader.
    // Queried once per `run()` to populate `skillsL1` in the system
    // prompt assembler.
    this.skillLoader = opts.skillLoader;
    // P0-7: store the SkillWriter. Called from `run()` after a
    // successful run with 5+ tool calls to extract a skill.
    this.skillWriter = opts.skillWriter;
    // P2-18 fix (remediation plan Phase 18): instantiate the
    // ReflexionEngine. Caller may pass a pre-configured instance (with
    // an LLM client for richer reflections); otherwise we construct a
    // heuristic-only engine. The engine is queried from
    // `executeToolCall()` on failure and from `run()` at system-prompt
    // assembly time.
    this.reflexionEngine = opts.reflexionEngine ?? new ReflexionEngine({ logger: this.log });
    // P0-5: instantiate the mid-session integrity checker. The
    // baseline is captured lazily on the first `run()` call (so the
    // checker doesn't hash files at construction time — that would
    // slow down `goli --help` and other non-run code paths).
    this.integrityChecker = new MidSessionIntegrityChecker();

    const syncClient = createProviderBackedClientSync();
    const innerClient = syncClient ?? new ProviderBackedModelClient(
      new OllamaProvider({
        apiKey: process.env.OLLAMA_API_KEY || '',
        model: process.env.OLLAMA_MODEL || 'gpt-oss:120b-cloud',
        baseUrl: process.env.OLLAMA_BASE_URL || 'https://ollama.com',
      }),
    );

    // 5th AppMode: when 'local-llms' is active, wrap the inner client
    // in the three-axis router. The router holds its own pool of 5
    // OllamaProvider instances and routes each call across them. The
    // inner client (above) is the fallback if the router is somehow
    // unavailable (e.g. local Ollama is down).
    if (this.defaultAppMode === 'local-llms') {
      this.client = new LocalLlmsRouter({
        config: opts.config.localLlms,
        logger: this.log,
      }) as unknown as ModelClient;
      this.log?.info('Local-LLMs three-axis router enabled', {
        orchestrator: opts.config.localLlms.orchestratorModel,
        coder: opts.config.localLlms.coderModel,
        general: opts.config.localLlms.generalModel,
        fast: opts.config.localLlms.fastModel,
        cloud: opts.config.localLlms.cloudModel,
        piiGatingMode: opts.config.localLlms.piiGatingMode,
      });
    } else {
      this.client = innerClient;
    }

    // P2-3 fix (audit Finding CC-4 / 2.18): wrap the model client in
    // EffortRoutingClient so reasoning effort is auto-routed per turn.
    // The previous implementation exported EffortRoutingClient but never
    // instantiated it — the agent always used the caller's `effort`
    // setting, wasting tokens on simple tool-execution turns (where
    // 'high' is sufficient) and under-investing on planner turns (where
    // 'max' is needed for deep decomposition).
    //
    // The wrapper inspects the conversation context on each call and
    // overrides the effort: tool-execution turns (last message is a
    // tool result) → 'high'; planner turns (system prompt has planner
    // keywords) → 'max'; final-answer turns → 'max'. We skip wrapping
    // for local-llms mode because the LocalLlmsRouter already does its
    // own three-axis routing (sensitivity/complexity/availability) and
    // double-wrapping would be redundant.
    if (this.defaultAppMode !== 'local-llms') {
      this.client = new EffortRoutingClient({
        client: this.client as unknown as import('./effort-router.js').ModelCallable,
        logger: this.log,
      }) as unknown as ModelClient;
    }

    this.assembler = new SystemPromptAssembler();
    this.planner = new Planner();
    this.budget = new BudgetTracker(opts.config.budget);
    this.stallDetector = new StallDetector(opts.config.stall);
    this.toolRegistry = createDefaultToolRegistry({ logger: this.log });
    // P2-5: Instantiate the MCP client manager if servers are configured.
    // The actual connection (which is async) happens in
    // `connectMcpServers()` — the CLI calls it after construction so the
    // constructor stays synchronous. If the caller never calls
    // `connectMcpServers()`, the MCP subsystem stays inert (no tools
    // registered, no servers connected). This matches the audit's
    // recommendation: "In AgentLoop constructor, accept mcpConfig.
    // Instantiate MCPClientManager, connect to each configured server,
    // discover tools, wrap each as a Tool, and register via
    // toolRegistry.register()."
    if (opts.mcpServers && opts.mcpServers.length > 0) {
      this.mcpManager = new MCPClientManager({ logger: this.log });
      // Stash the configs for connectMcpServers() to use. We don't store
      // them on the field because the manager already holds them after
      // connect — but we need them accessible to the async connect method.
      this.pendingMcpConfigs = opts.mcpServers;
    }
    // Wire H5 (advanced compression) into the live loop. The compressor's
    // in-loop trigger fires at 50% of context; the safety-net at 85%.
    // Simplified the llmClient cast — the previous implementation used
    // `as unknown as AdvancedCompressor['llmClient'] extends infer T ? T : never`
    // which is a needlessly complex conditional-type extraction that
    // resolves to the same type as `AdvancedCompressor['llmClient']`
    // directly. It obscures the real type relationship and makes the
    // code harder to maintain.
    this.compressor = new AdvancedCompressor({
      logger: this.log,
      llmClient: this.client as AdvancedCompressor['llmClient'],
    });
    // Wire H8 (tool-call loop guardrails) into the live loop. The controller
    // detects exact-failure loops (same tool + same args + failure), same-tool-
    // failure loops (same tool, different args, but always failing), and
    // no-progress loops (mutating tools that don't change the working tree).
    // Previously this module was exported but never consumed by the loop.
    this.guardrails = new ToolGuardrailController();
    // T-065: Wire the LoopDetector into the loop. Resets per-run, detects
    // consecutive identical tool calls (threshold 5) and content outputs
    // (threshold 10). On detection, logs a warning + breaks the loop.
    this.loopDetector = new LoopDetector({
      onLoopDetected: (event) => {
        this.log.warn('Loop detected — breaking agent loop', {
          type: event.type,
          count: event.count,
          threshold: event.threshold,
          description: event.description,
        });
      },
    });
    // P2-2: Wire the ProvenanceTracker. Tags every context block with
    // its source so prompt-injection defense (canTriggerAction) works.
    this.provenance = new ProvenanceTracker();
  }

  /**
   * Resolve the effective AppMode for a run. Per-run `input.appMode`
   * overrides the loop's `defaultAppMode`. If neither is set, falls
   * back to `godMode ? 'god' : 'build'`.
   */
  private getAppMode(input?: AgentLoopInput): 'read-only' | 'plan' | 'build' | 'god' | 'local-llms' {
    return input?.appMode ?? this.defaultAppMode;
  }

  /**
   * P2-5: Connect to all configured MCP servers and register their
   * tools as virtual `Tool`s in the registry.
   *
   * This is async (each stdio server spawns a child process; each http
   * server opens a connection). The CLI calls this after constructing
   * the AgentLoop, before the first `run()`. If a server fails to
   * connect, we log a warning and continue — one bad server shouldn't
   * block the agent.
   *
   * Each MCP tool is registered with:
   *   - name: `serverName:toolName` (namespaced to avoid collisions)
   *   - tier: `'T1'` (so it goes through the pre-execution approval gate)
   *   - handler: delegates to `mcpManager.callTool(namespacedName, args)`
   *
   * Idempotent: if called twice, the second call is a no-op (the
   * `pendingMcpConfigs` field is cleared after the first call).
   *
   * @returns The number of MCP tools successfully registered.
   */
  async connectMcpServers(): Promise<number> {
    if (!this.mcpManager || !this.pendingMcpConfigs) return 0;
    const configs = this.pendingMcpConfigs;
    this.pendingMcpConfigs = undefined; // idempotent
    let registered = 0;
    for (const config of configs) {
      // Skip servers with autoConnect === false (user opted out).
      if (config.autoConnect === false) continue;
      try {
        const session = await this.mcpManager.connect(config);
        if (session.state !== 'connected') {
          this.log.warn('MCP server failed to connect', {
            server: config.name,
            state: session.state,
            error: session.error,
          });
          continue;
        }
        this.log.info('MCP server connected', {
          server: config.name,
          tools: session.tools.length,
        });
        // Register each discovered tool as a virtual Tool.
        for (const mcpTool of session.tools) {
          const virtualTool = this.wrapMcpTool(config.name, mcpTool);
          try {
            this.toolRegistry.register(virtualTool);
            registered++;
          } catch (err) {
            // A tool with the same namespaced name may already be
            // registered (e.g. two servers exposing a tool with the
            // same name). Log and skip.
            this.log.warn('MCP tool registration failed', {
              tool: virtualTool.name,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      } catch (err) {
        this.log.warn('MCP server connection error', {
          server: config.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (registered > 0) {
      this.log.info('MCP tools registered', { count: registered });
    }
    return registered;
  }

  /**
   * P2-5: Wrap an MCP tool as a builtin `Tool` so the registry can
   * dispatch it through the normal pipeline (schema validation,
   * approval, sandbox, audit log). The handler delegates to
   * `mcpManager.callTool()` and converts the result to a `ToolResult`.
   *
   * P1-11 fix (verification report deferred item #3): infer the tool's
   * permission tier from its name and input schema instead of
   * hardcoding `tier: 'T1'`. The previous implementation always
   * assigned T1 (Risky) to every MCP tool, which meant read-only MCP
   * tools (e.g. `github_search`, `linear_list_issues`) were treated
   * as risky and required approval in build mode, while
   * state-modifying MCP tools (e.g. `github_create_pr`,
   * `slack_post_message`) were under-classified (should be T2). We
   * now infer the tier via {@link inferMcpToolTier} based on the tool
   * name and the presence of write/exec/network args in the schema.
   */
  private wrapMcpTool(serverName: string, mcpTool: MCPTool): import('@goli-cli/tool-system/types.js').Tool {
    const namespacedName = `${serverName}:${mcpTool.name}`;
    const manager = this.mcpManager!;
    // P1-11 fix: infer the tier from the tool name + input schema.
    const inferredTier = inferMcpToolTier(mcpTool.name, mcpTool.inputSchema);
    return {
      name: namespacedName,
      description: mcpTool.description || `MCP tool ${namespacedName}`,
      inputSchema: {
        type: 'object' as const,
        properties: (mcpTool.inputSchema.properties ?? {}) as Record<string, unknown>,
        required: mcpTool.inputSchema.required,
        additionalProperties: mcpTool.inputSchema.additionalProperties ?? true,
      },
      tier: inferredTier,
      readOnly: inferredTier === 'T0',
      handler: async (args: Record<string, unknown>, ctx): Promise<import('@goli-cli/tool-system/types.js').ToolResult> => {
        const result = await manager.callTool(namespacedName, args);
        return {
          toolCallId: ctx.toolCallId,
          ok: result.ok,
          content: result.content || '',
          error: result.error,
          tier: inferredTier,
        };
      },
    };
  }

  /**
   * Run the agent loop with a single prompt.
   *
   * @param input
   * @returns The run result.
   */
  async run(input: AgentLoopInput): Promise<AgentLoopResult> {
    const startedAt = Date.now();
    const role: AgentRole = input.role ?? 'orchestrator';
    const appMode = this.getAppMode(input);

    // P2-9 fix (re-verification report item N2/N3): clear the cached
    // lastResult at the start of each run so concurrent/overlapping
    // runs don't leak the previous run's result to a stream consumer.
    this.lastResult = null;
    // P2-6: Lazy-create the SessionMemory on first run — the memory
    // module graph stays unloaded until a curator is configured AND a
    // run actually happens.
    if (this.memoryCurator && !this.sessionMemory) {
      this.sessionMemory = await loadSessionMemory();
    }
    // P1-11: reset the compaction summary so a stale entry from a
    // previous run doesn't get surfaced on this run's result.
    this.lastCompactionSummary = undefined;

    // Reset per-run state so the second run doesn't inherit the first
    // run's tokens, cost, stall signatures, guardrail failure counts,
    // or compactor previous-summary. `AgentLoop` is designed to be
    // reused — the TUI constructs one and calls `run()` per user
    // message. Without these resets, budget exhaustion accelerates
    // across runs, the stall detector's window never accumulates
    // cross-iteration repetition (the November 2025 LangChain incident
    // pattern), guardrail failure thresholds fire prematurely, and
    // the compressor's `previousSummary` blends tasks across runs.
    this.budget.reset();
    this.stallDetector.reset();
    this.guardrails.reset();
    this.compressor.reset();

    // Fresh AbortController per run. Sharing one across runs meant that
    // after the first abort, every subsequent run was a no-op.
    const abortController = new AbortController();
    this.currentAbortController = abortController;

    // Honor external abort signal — and clean up the listener on exit
    // so that repeated runs with the same signal don't accumulate listeners.
    let externalAbortListener: (() => void) | undefined;
    if (input.signal) {
      if (input.signal.aborted) {
        abortController.abort();
      } else {
        externalAbortListener = () => abortController.abort();
        input.signal.addEventListener('abort', externalAbortListener, { once: true });
      }
    }

    // Redact secrets before logging the user prompt preview. The
    // previous implementation logged the first 100 chars verbatim —
    // if the user pasted an API key, password, or PII into the
    // prompt (common when asking the agent to debug auth issues),
    // it ended up in the log file with no redaction. We now apply
    // the same redaction patterns used by the audit log.
    const promptPreview = redactPromptSecrets(input.prompt.slice(0, 100));
    this.log.info('Agent loop starting', {
      role,
      appMode,
      prompt: promptPreview,
      effort: this.effort,
      godMode: this.godMode,
    });

    this.stopEngine = new StopEngine(this.budget, this.stallDetector, this.config.stall);

    // Build initial conversation state
    const state: ConversationState = {
      messages: [],
      role,
      todos: [],
      readFiles: new Set(),
      inputTokens: 0,
      outputTokens: 0,
      thinkingTokens: 0,
      iterations: 0,
      startedAt: new Date().toISOString(),
      recentToolCallSignatures: [],
      // P1-9: seed sessionId for provenance tagging. Callers can pass
      // their own via `input.sessionId`; otherwise we generate one so
      // every tool call in this run is attributable to a stable ID.
      sessionId: input.sessionId ?? randomUUID(),
    };

    // Add the user's prompt as the first user message
    state.messages.push({
      role: 'user',
      content: input.prompt,
      timestamp: new Date().toISOString(),
    });

    // P3-1: Capture a FrozenSnapshot at session start. The snapshot
    // preserves the original task prompt, role, and identity fragment
    // so the compressor can re-inject them after every compaction
    // (preventing the "amnesia" problem where the agent drifts from
    // the original goal after 3–4 compactions). We capture ONCE per
    // run — if the loop runs multiple turns, the snapshot from the
    // first turn is the one that's frozen.
    if (!this.frozenSnapshot) {
      const identityFragment = this.assembler.assemble({
        role,
        toolNames: [],
        sandboxMode: this.config.sandbox.mode,
        todos: [],
        language: 'English',
        godMode: this.godMode,
        taskPrompt: input.prompt,
        appMode,
      }).split('\n\n---\n\n')[0] ?? ''; // first fragment = identity
      this.frozenSnapshot = createFrozenSnapshot(input.prompt, role, identityFragment);
      // Wire the snapshot into the compressor so the Freeze layer can
      // re-inject it after every compaction.
      this.compressor.setFrozenSnapshot(this.frozenSnapshot);
      this.log.debug('FrozenSnapshot captured at session start', {
        role,
        promptLength: input.prompt.length,
        constraints: this.frozenSnapshot.constraints.length,
      });
    }

    // T-065: Reset the loop detector at the start of each run so that
    // counters from a previous run don't carry over.
    this.loopDetector.reset();

    // P1-4 fix (verification report item #4): Reset the per-run skills
    // L1 cache so the SkillLoader is re-queried on the first iteration
    // of this run. The catalog may have changed since the last run
    // (e.g., the user added a skill via /skills create).
    this.skillsL1Computed = false;
    this.cachedSkillsL1 = undefined;
    // P1-16: also bust the (appMode, prompt)-keyed cache.
    this.skillsL1CacheKey = undefined;
    // P0-6: reset the L2 cache too (same rationale as L1).
    this.skillsL2Computed = false;
    this.cachedSkillsL2 = undefined;
    this.skillsL2CacheKey = undefined;

    // P0-5 fix (remediation plan Phase 5): capture the policy
    // integrity baseline on the first run() call. Subsequent run()
    // calls reuse the same baseline (so the check detects changes
    // across the entire session, not just within a single run()).
    // The baseline is a Map<path, hash> computed from the
    // DEFAULT_POLICY_PATHS list (approval/engine.ts,
    // sandbox/executor.ts, config/integrity.ts, etc.).
    if (!this.policyBaselineCaptured) {
      try {
        this.integrityChecker.captureBaseline();
        this.policyBaselineCaptured = true;
        this.log?.debug('Policy integrity baseline captured', {
          fileCount: (this as unknown as { integrityChecker: { baseline: Map<string, string> | null } }).integrityChecker.baseline?.size ?? 0,
        });
      } catch (err) {
        // Baseline capture failure is non-fatal — the verify()
        // step will be a no-op (returns ok: true) when no baseline
        // exists. We log so the user can debug why the checker is
        // inert.
        this.log?.warn('Policy integrity baseline capture failed — mid-session checks disabled', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Available tools: plan_task + all registered core tools (Phase 4).
    //
    // T-021 (per-conversation prompt caching invariant): the tool list is
    // snapshotted ONCE at conversation start and reused for every turn.
    // This preserves the byte-stable system prompt required for provider-
    // side prompt caching. If a tool's check_fn flips mid-conversation
    // (e.g. an LSP server starts), the change is deferred to the next
    // conversation by default. The user can opt in to immediate
    // invalidation via a slash command with --now (calls
    // toolsetSnapshot.invalidate()).
    const toolsetSnapshot = new ToolsetSnapshot([
      PLAN_TASK_TOOL as ToolDefinition,
      ...this.toolRegistry.list().map((t) => toToolDefinition(t)),
    ]);
    // T-MODE: Filter tools by the current AppMode. In read-only mode
    // only read-only tools pass; in plan mode read-only + plan_task
    // pass; in build/god mode all tools pass. This is the runtime
    // enforcement of the mode → tool contract.
    const allTools = [...toolsetSnapshot.getTools()];
    const availableTools: ToolDefinition[] = allTools.filter((t) =>
      isToolAllowedForMode(appMode, t.function.name),
    );

    // The loop
    let lastAssistantContent = '';
    let stopReason: AgentLoopResult['stopReason'] | undefined;

    // P0-4 fix (remediation plan Phase 4): lazily index the workspace
    // into the context engine's symbol graph BEFORE querying the
    // retriever. Without this call, the symbol graph is always empty
    // and `findCallers`/`findCallees`/`findImports` return `[]` —
    // the "code intelligence" subsystem is structurally present but
    // provides zero value at runtime. We walk the workspace for
    // source files (limited to a reasonable cap to keep indexing
    // fast on large repos) and pass them to `indexWorkspace()`.
    //
    // The index is cached on the AgentLoop instance (not persisted
    // to disk in this phase — a future enhancement can add a
    // `.goli/symbol-graph.cache` file with mtime-based invalidation).
    // Re-indexing happens on the first run after the AgentLoop is
    // constructed; subsequent runs on the same instance reuse the
    // cached index.
    if (this.contextEngine && !this.symbolGraphIndexed) {
      try {
        await this.initializeSymbolGraph();
      } catch (err) {
        this.log?.warn('SymbolGraph initialization failed — code intelligence will be limited', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // P2-7: Query the context engine's hybrid retriever ONCE per run
    // (not per iteration) to get code-intelligence context for the
    // system prompt. The retriever combines tree-sitter symbol-graph
    // traversal + ripgrep lexical + semantic matching. Results are
    // injected as a "Retrieved Context" fragment so the agent sees
    // relevant symbols before its first tool call. Failures are
    // logged but don't block the run — the agent falls back to
    // read_file/grep for code discovery.
    let retrievedContext: string | undefined;
    if (this.contextEngine) {
      try {
        // retrieve() is sync and takes (query, queryType?). We use
        // 'auto' (the default) which runs structural + lexical + semantic
        // and merges via RRF k=60.
        const results = this.contextEngine.retriever.retrieve(input.prompt);
        if (results.length > 0) {
          // Take top 5 (the retriever may return more; it ranks by score).
          const top = results.slice(0, 5);
          retrievedContext = top
            .map((r) => {
              const lineStart = r.lineRange?.start;
              const loc = r.filePath
                ? `${r.filePath}${lineStart ? `:${lineStart}` : ''}`
                : '(no location)';
              const content = r.content ?? r.chunk?.code ?? r.symbol?.name ?? '(no content)';
              return `### ${loc}\n${content}`;
            })
            .join('\n\n');
          this.log.debug('Retrieved context for system prompt', {
            query: promptPreview,
            resultCount: top.length,
          });
        }
      } catch (err) {
        this.log.warn('Context retrieval failed — continuing without retrieved context', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    try {
      // Belt-and-suspenders hard cap: never exceed maxIterations + 5,
      // even if StopEngine has a bug that prevents it from firing.
      const hardCap = this.config.budget.maxIterations + 5;
      for (let safetyIter = 0; safetyIter < hardCap; safetyIter++) {
        // ─── 0. Check abort ────────────────────────────────────
        if (abortController.signal.aborted) {
          stopReason = 'aborted';
          break;
        }

        // ─── 1. Pre-check + compaction (H5: advanced compression) ──
        // Compaction triggers when:
        //   - Token usage exceeds 50% of the context window (in-loop trigger), OR
        //   - The retry layer set `forceCompaction` (the error classifier
        //     detected a "context too long" error from the model API).
        const maxContextTokens = this.config.model.maxContextTokens;
        const currentTokens = this.budget.snapshot().totalTokens;
        const shouldCompact = currentTokens > Math.floor(maxContextTokens * 0.5) || this.forceCompaction;
        if (shouldCompact) {
          this.forceCompaction = false; // Reset the flag.
          try {
            // AdvancedCompressor.compress() signature is
            //   (messages, maxTokens, currentTokens)
            // The previous call site swapped the two numeric arguments,
            // passing `currentTokens` (live value) as `maxTokens` and
            // `maxContextTokens` (config constant) as `currentTokens`.
            // That made `shouldCompressSafetyNet(currentTokens, maxTokens)`
            // evaluate `maxContextTokens >= currentTokens * 0.85` (always
            // true), misreporting the trigger phase as `safety_net`, and
            // `phase2Boundaries` computed `tailBudget = currentTokens * 0.3`
            // (a tiny budget) instead of `maxContextTokens * 0.3`, severely
            // truncating the protected tail. Passing them in the correct
            // order restores the intended tail-budget sizing.
            const compaction = await this.compressor.compress(
              state.messages,
              maxContextTokens,
              currentTokens,
            );
            if (compaction.tokensSaved > 0) {
              state.messages = compaction.messages;
              this.log.info('In-loop compaction', {
                trigger: compaction.triggerPhase,
                tokensBefore: compaction.tokensBefore,
                tokensAfter: compaction.tokensAfter,
                tokensSaved: compaction.tokensSaved,
                pruned: compaction.prunedCount,
              });
              // P1-11 fix (remediation plan Phase 11): record the
              // compaction summary so `AgentLoopResult.lastCompaction`
              // surfaces it to the TUI. `triggeredBy` is mapped from
              // the compressor's `triggerPhase` ('in_loop' → 'auto',
              // 'safety_net' → 'overflow'; 'manual' is set when the
              // user runs `/compact` and would be added by a future
              // hook into `requestCompaction()`).
              this.lastCompactionSummary = {
                triggeredBy: compaction.triggerPhase === 'safety_net' ? 'overflow' : 'auto',
                tokensBefore: compaction.tokensBefore,
                tokensAfter: compaction.tokensAfter,
                tokensReclaimed: compaction.tokensSaved,
                durationMs: 0, // not currently tracked by AdvancedCompressor; future enhancement
                evictedTurns: 0, // evict count not currently surfaced in CompressionResult
                summarizedTurns: compaction.prunedCount,
                layersApplied: ['dedupe', 'boundaries', 'evict', 'prune', 'summarize', 'freeze', 'assemble'],
              };
            }
          } catch (err) {
            this.log.warn('Compaction failed', {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        // ─── 2. Assemble system prompt ────────────────────────
        const systemPrompt = this.assembler.assemble({
          role: state.role,
          toolNames: availableTools.map((t) => t.function.name),
          sandboxMode: this.config.sandbox.mode,
          todos: this.planner.getTodos(),
          language: 'English',
          godMode: this.godMode,
          taskPrompt: input.prompt,
          appMode: this.getAppMode(input),
          // P2-7: inject the retrieved code-intelligence context.
          // This is computed ONCE per run (above the try block) and
          // reused for every iteration — re-querying per iteration
          // would bust the prefix cache and waste tokens.
          retrievedContext,
          // P1-4 fix (verification report item #4): inject the skills
          // L1 metadata. Computed ONCE per run (lazily, on first
          // iteration) and cached for the rest of the run — the
          // skill catalog doesn't change mid-run, and re-querying
          // per iteration would bust the prefix cache.
          skillsL1: this.getCachedSkillsL1(this.getAppMode(input), input.prompt),
          // P0-6 fix (remediation plan Phase 6): inject L2 skill
          // instructions loaded on-demand. When the user's query
          // matches skill triggers, the AgentLoop calls
          // `loadL2Instructions()` for the top matches and
          // concatenates their full playbooks here. Computed ONCE
          // per run (lazily, on first iteration) and cached — same
          // rationale as skillsL1.
          skillsL2: this.getCachedSkillsL2(this.getAppMode(input), input.prompt),
          // P2-9 fix (re-verification report item #11): inject the
          // list of files the agent has read this run. `state.readFiles`
          // is a Set<string> tracked in executeToolCall() (added when
          // read_file succeeds). We spread it into an array — the
          // assembler caps at 20 most-recent paths to keep the prompt
          // bounded. This was previously tracked for Read-before-Edit
          // enforcement but never surfaced in the prompt, so the agent
          // would re-read files it had already seen.
          recentReadFiles: state.readFiles.size > 0 ? [...state.readFiles] : undefined,
          // P2-18 fix (remediation plan Phase 18): inject accumulated
          // Reflexion notes from prior tool failures. The engine
          // returns a formatted string (or empty if no reflections
          // have been generated yet); the assembler filters out the
          // fragment when empty. Computed fresh on each iteration
          // because new tool failures may have appended notes since
          // the last iteration.
          reflections: this.reflexionEngine.formatForPrompt() || undefined,
        });

        // Build the messages array for the API call
        const apiMessages: Message[] = [
          { role: 'system', content: systemPrompt, timestamp: new Date().toISOString() },
          ...state.messages,
        ];

        // ─── 3. Call the model (with retry) ────────────────────
        this.log.debug('Calling model', {
          iteration: state.iterations + 1,
          messageCount: apiMessages.length,
          toolCount: availableTools.length,
        });

        let response;
        try {
          response = await callWithRetry(
            () =>
              this.client.call({
                messages: apiMessages,
                tools: availableTools,
                effort: this.effort,
                stream: this.config.model.streaming,
                signal: abortController.signal,
              }),
            {
              logger: this.log,
              // H3: the onRetry callback now receives the structured
              // ClassifiedError, which tells us whether to rotate
              // credentials (429/402) or compress context (context-too-long).
              onRetry: (_attempt, _delay, error, classification) => {
                if (classification?.shouldRotateCredential) {
                  // Mark the current credential as errored so the pool
                  // rotates to the next key on the next call.
                  this.client.markCredentialError?.(error);
                }
                if (classification?.shouldCompress) {
                  // Force compaction on the next iteration — the context
                  // is too long for the model's window.
                  this.log?.warn('Context too long — forcing compaction on next iteration', {
                    reason: classification.reason,
                  });
                  // We can't compact here (we're in the retry callback),
                  // but we set a flag that the next loop iteration checks.
                  this.forceCompaction = true;
                }
              },
            },
            this.config.retry,
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.log.error('Model call failed', { error: message });
          stopReason = 'error';
          lastAssistantContent = `Error: ${message}`;
          break;
        }

        // ─── 3.5. Parse tool-call arguments (P2-1: JsonRepair) ────
        // The model can emit malformed JSON in tool-call arguments under
        // heavy multi-tool turns (missing closers, unescaped newlines,
        // trailing commas). The previous implementation never called
        // `parseToolCallArgs`, so `tc.argumentsParsed` and `tc.parseError`
        // were always undefined — the loop's parse-failure check (step 5)
        // never fired, and `executeToolCall` received the raw string and
        // silently fell back to `{}`. We now run every tool call through
        // the repair-aware parser, populating `argumentsParsed` on success
        // or `parseError` on failure. The StopEngine then sees the
        // failures and can stop the loop if too many parse errors occur.
        for (const tc of response.toolCalls) {
          // Skip if already parsed (e.g. by a test fixture).
          if (tc.argumentsParsed !== undefined || tc.parseError !== undefined) continue;
          const parsed = parseToolCallArgs(tc.arguments);
          if (parsed.ok) {
            tc.argumentsParsed = parsed.value;
          } else {
            tc.parseError = parsed.error;
          }
        }

        // ─── 4. Record tokens + budget ────────────────────────
        this.budget.recordCall(
          response.inputTokens,
          response.outputTokens,
          response.thinkingTokens,
        );
        state.inputTokens += response.inputTokens;
        state.outputTokens += response.outputTokens;
        state.thinkingTokens += response.thinkingTokens;

        // Each completed model round-trip counts as one iteration. This
        // must happen here (before the stop-condition check below): when
        // StopEngine stops on a final text answer there are no tool calls,
        // so the iteration counter at the bottom of the loop body is never
        // reached — the run would report `iterations: 0` despite having
        // made a real model call.
        this.budget.recordIteration();
        state.iterations++;

        // ─── 5. Check for parse failures ──────────────────────
        const parseFailures = response.toolCalls.filter((tc) => tc.parseError).length;
        if (parseFailures > 0) {
          for (let i = 0; i < parseFailures; i++) {
            this.stopEngine.recordParseFailure();
          }
          this.log.warn('Tool-call parse failures', { count: parseFailures });
        } else {
          this.stopEngine.resetParseFailures();
        }

        // ─── 6. Check stop conditions ─────────────────────────
        const stopResult = this.stopEngine.check(response);
        if (stopResult.shouldStop) {
          stopReason = stopResult.reason;
          if (response.content) lastAssistantContent = response.content;
          this.log.info('Agent loop stopping', {
            reason: stopResult.reason,
            message: stopResult.message,
            iterations: state.iterations,
            tokens: this.budget.snapshot().totalTokens,
          });
          break;
        }

        // ─── 7. Append assistant message to conversation ──────
        const assistantMessage: Message = {
          role: 'assistant',
          content: response.content,
          thinking: response.thinking,
          toolCalls: response.toolCalls,
          timestamp: new Date().toISOString(),
        };
        state.messages.push(assistantMessage);
        if (response.content) lastAssistantContent = response.content;

        // T-065: Check for content loop (repeated identical assistant content).
        if (response.content) {
          const contentLoop = this.loopDetector.recordContent(response.content);
          if (contentLoop) {
            stopReason = 'loop_detected';
            this.log.warn('Content loop detected — stopping agent loop', {
              count: contentLoop.event.count,
              threshold: contentLoop.event.threshold,
            });
            break;
          }
        }

        // T-065: Check for tool-call loop (repeated identical tool calls).
        if (response.toolCalls.length > 0) {
          let toolLoop = null;
          for (const tc of response.toolCalls) {
            toolLoop = this.loopDetector.recordToolCall({
              name: tc.name,
              args: tc.argumentsParsed ?? tc.arguments,
            });
            if (toolLoop) break;
          }
          if (toolLoop) {
            stopReason = 'loop_detected';
            this.log.warn('Tool-call loop detected — stopping agent loop', {
              count: toolLoop.event.count,
              threshold: toolLoop.event.threshold,
              description: toolLoop.event.description,
            });
            break;
          }
        }

        // ─── 8. Execute tool calls (H4: parallel + H8: guardrails) ──────
        // The model can emit multiple tool calls per turn. Read-only tools
        // (read_file, grep, list_directory) and non-overlapping file-mutating
        // tools (write_file/edit_file on distinct paths) run in parallel.
        // Interactive/side-effecting tools (bash, plan_task) run sequentially.
        //
        // Before executing, check the H8 ToolGuardrailController for loop
        // detection (exact-failure, same-tool-failure, no-progress). If a
        // guardrail fires, we inject a synthetic tool result telling the
        // model to stop repeating the same failing action.
        const guardrailDecisions = new Map<string, { blocked: boolean; reason?: string; syntheticResult?: string }>();
        for (const tc of response.toolCalls) {
          // PEEK (read-only) at the guardrail state — do NOT record a
          // failure. The previous implementation called
          // `this.guardrails.check(tc, false)` for the pre-check,
          // which recorded `success: false` and incremented the
          // failure counter BEFORE the tool even ran. Then the post-
          // execution `check(toolCall, ok)` recorded the actual
          // result, so a tool that failed ONCE got a count of 2 —
          // already hitting the `exactFailureWarnAfter: 2` threshold
          // on the first real failure. `peek()` returns the decision
          // the upcoming `check()` would return, without mutating
          // state.
          const decision = this.guardrails.peek(tc);
          // 'halt' and 'inject_result' both prevent execution; 'inject_result'
          // also provides a synthetic message to show the model.
          if (decision.action === 'halt' || decision.action === 'inject_result') {
            guardrailDecisions.set(tc.id, {
              blocked: true,
              reason: decision.reason,
              syntheticResult: decision.syntheticResult,
            });
          }
        }

        // Separate blocked calls from executable calls.
        const executableCalls = response.toolCalls.filter((tc) => !guardrailDecisions.has(tc.id));

        // Execute the non-blocked calls in parallel.
        const toolExecResults = executableCalls.length > 0
          ? await executeToolCallsConcurrent(
              executableCalls,
              (tc) => this.executeToolCall(tc, state),
              abortController.signal,
            )
          : [];

        // Append results for both executed and blocked calls.
        for (const toolCall of response.toolCalls) {
          const guardrail = guardrailDecisions.get(toolCall.id);
          if (guardrail) {
            // Guardrail blocked this call — inject synthetic result.
            const syntheticContent = guardrail.syntheticResult
              ?? `[GUARDRAIL] ${guardrail.reason ?? 'Tool call blocked by loop guardrail. Stop repeating the same failing action and try a different approach.'}`;
            state.messages.push({
              role: 'tool',
              content: syntheticContent,
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              timestamp: new Date().toISOString(),
            });
            continue;
          }
          const execResult = toolExecResults.find((r) => r.toolCall.id === toolCall.id);
          if (execResult) {
            const { ok, result, error } = execResult;
            // The previous implementation used `(result as string)` —
            // an unsafe cast. If `result` is `undefined` (e.g., when
            // `ok` is true but the tool returned no content), the
            // cast produces `undefined` which is then pushed as the
            // tool message content, violating the
            // `Message.content: string` contract and breaking
            // downstream consumers (provider adapters, JSONL
            // stores, etc.). We now coerce to a string with a
            // fallback to a clear marker.
            const toolResult = ok
              ? (typeof result === 'string' ? result : (result !== null ? String(result) : '(tool returned no content)'))
              : `Error: ${error ?? 'tool execution failed'}`;
            // Record the result with the guardrails (for success/failure tracking).
            this.guardrails.check(toolCall, ok);
            state.messages.push({
              role: 'tool',
              content: toolResult,
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              timestamp: new Date().toISOString(),
            });
            // P2-2: Tag the tool result with provenance. The blockId
            // is the toolCallId (unique per call, passed as the first
            // arg to `tag()`). The source is the tool's trust level
            // (web tools like web_fetch/web_search are 'web'; trusted
            // read-only tools are 'trusted'; all others are 'tool').
            // This lets `canTriggerAction` defend against prompt
            // injection: if a sensitive tool (bash, write_file) is
            // called and the recent context includes web-sourced
            // content, the call is blocked.
            this.provenance.tag(toolCall.id, {
              source: this.provenance.getToolTrustLevel(toolCall.name),
              toolName: toolCall.name,
              // Tool output can trigger actions only if it came from a
              // trusted source. Web-sourced output cannot trigger
              // sensitive tools (prompt-injection defense).
              canTriggerActions: this.provenance.getToolTrustLevel(toolCall.name) !== 'web',
            });
            // P2-6: Record durable-looking tool results as session
            // memory entries for the curator to promote at turn end.
            // We use a simple heuristic: read-only tools (read_file,
            // grep, list_directory, web_search) that succeeded with
            // non-trivial output are candidates. The curator
            // classifies/deduplicates them — we just feed it.
            if (this.sessionMemory && ok && toolResult.length > 50) {
              const readOnlyTools = new Set([
                'read_file', 'grep', 'list_directory', 'web_search', 'web_fetch',
              ]);
              if (readOnlyTools.has(toolCall.name)) {
                // Truncate to avoid flooding session memory with huge
                // tool outputs — the curator only needs a snippet to
                // classify and deduplicate.
                const snippet = toolResult.slice(0, 500);
                this.sessionMemory.record(
                  `[${toolCall.name}] ${snippet}`,
                  'learning',
                );
              }
            }
          }
        }

        // NOTE: do NOT reset the stall detector on every successful
        // iteration. The detector maintains a sliding window of
        // signatures; resetting on every success means the window
        // never accumulates across iterations, which is exactly the
        // scenario the detector was built to catch (the November 2025
        // LangChain incident involved an agent making the same tool
        // call across many iterations). The window slides naturally —
        // let it. The detector's `reset()` is called once per `run()`
        // at the top of this method, which is the right granularity.
        // The previous `if (parseFailures === 0) this.stallDetector.reset()`
        // line was defeating cross-iteration stall detection.
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.error('Agent loop crashed', { error: message });
      stopReason = 'error';
      lastAssistantContent = `Error: ${message}`;
    } finally {
      // Clean up the external abort listener to prevent accumulation
      // across multiple runs sharing the same signal.
      if (input.signal && externalAbortListener) {
        input.signal.removeEventListener('abort', externalAbortListener);
      }
      this.currentAbortController = undefined;
    }

    const durationMs = Date.now() - startedAt;
    const budgetSnap = this.budget.snapshot();

    // P2-6: Run the memory curator at the end of the turn. This promotes
    // within-session learnings from ephemeral SessionMemory to persistent
    // files (MEMORY.md / USER.md / PROJECT.md). The curator classifies
    // each entry and deduplicates against existing content. Failures are
    // logged but don't fail the run — curation is an enhancement.
    if (this.memoryCurator && this.sessionMemory) {
      try {
        const entries = this.sessionMemory.getAll();
        if (entries.length > 0) {
          const summary = await this.memoryCurator.curate(entries);
          if (summary.written > 0) {
            this.log.info('Memory curation complete', {
              curated: summary.curated,
              written: summary.written,
              files: summary.files,
            });
          }
          // Clear the session memory for the next run so learnings
          // don't get re-curated (the persistent files already have them).
          this.sessionMemory = await loadSessionMemory();
        }
      } catch (err) {
        this.log.warn('Memory curation failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // P2-9 fix (re-verification report item N3): collect every tool
    // call made during this run from `state.messages` (assistant turns
    // carry `toolCalls` arrays). Surfaced on the result so consumers
    // like `CliAgentLoop` can render the tool-call trail in the
    // transcript without re-scanning the message history or casting
    // the result to `{toolCalls?: ...}`.
    //
    // We shallow-copy each ToolCall so callers can't mutate the
    // loop's internal state via the returned array.
    const collectedToolCalls: ToolCall[] = [];
    for (const msg of state.messages) {
      if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
        for (const tc of msg.toolCalls) {
          collectedToolCalls.push({ ...tc });
        }
      }
    }

    const result: AgentLoopResult = {
      ok: stopReason === 'completed',
      stopReason,
      content: lastAssistantContent,
      totalTokens: budgetSnap.totalTokens,
      totalCostUsd: budgetSnap.totalCostUsd,
      iterations: budgetSnap.iterations,
      durationMs,
      todos: this.planner.getTodos(),
      error: stopReason === 'error' ? lastAssistantContent : undefined,
      toolCalls: collectedToolCalls,
      // P1-11: surface the last compaction summary (if any) so
      // `CliAgentLoop` can emit a `kind: 'compaction'` event to the TUI.
      lastCompaction: this.lastCompactionSummary,
    };

    // P2-9 fix: cache the result so runStream() consumers can retrieve
    // it via getLastRunResult() after the stream ends (the stream
    // itself only emits loop-start/tool-call-result/content-delta/stop
    // events; token/cost totals aren't in the event payload, so the
    // CLI's CliAgentLoop.tryRunStream reads them from here).
    this.lastResult = result;

    // P0-7 fix (remediation plan Phase 7): extract a skill from the
    // trajectory if the run was successful and had 5+ tool calls.
    // Best-effort — failures are logged but don't affect the result
    // (the run already succeeded; skill extraction is an enhancement).
    if (this.skillWriter && result.ok && (result.toolCalls?.length ?? 0) >= 5) {
      try {
        const trajectory: TrajectoryEntry = {
          task: input.prompt,
          steps: (result.toolCalls ?? []).map((tc) => ({
            tool: tc.name,
            args: tc.argumentsParsed ?? {},
            result: tc.result ?? '',
            ok: tc.status === 'completed',
          })),
          ok: result.ok,
          tokensUsed: result.totalTokens,
          durationMs: result.durationMs,
        };
        const skill = this.skillWriter.createSkill(trajectory);
        if (skill) {
          this.log?.info('Skill extracted from trajectory', {
            skillName: skill.metadata.name,
            version: skill.metadata.version,
            category: skill.metadata.category,
          });
        }
      } catch (err) {
        this.log?.warn('Skill extraction failed (non-fatal)', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return result;
  }

  /**
   * P2-9 fix (re-verification report item N2/N3): return the result of
   * the most recent `run()` call.
   *
   * `runStream()` calls `run()` internally, so consumers that iterate
   * the stream can call this after the stream ends to access the full
   * result (token totals, cost, tool calls, iterations) — the stream
   * events only carry per-event payloads, not aggregate totals.
   *
   * Returns `null` if no run has completed yet, or if a run is
   * currently in progress (the result is cached only when `run()`
   * returns, not while it's executing).
   */
  getLastRunResult(): AgentLoopResult | null {
    return this.lastResult;
  }

  /**
   * P0-5 fix (remediation plan Phase 5): classify a tool as T0
   * (read-only) or T1+ (mutating / side-effecting). Used to gate
   * the mid-session integrity check — T0 tools skip the check
   * (they can't modify the filesystem, so an integrity violation
   * doesn't escalate through them).
   *
   * The classification mirrors `READ_ONLY_TOOLS` from
   * `config/mode-prompts.ts` (kept local to avoid a cross-module
   * import + to allow this method to be overridden in tests).
   */
  private isToolT0(toolName: string): boolean {
    const T0_TOOLS = new Set([
      'read_file', 'list_directory', 'grep', 'glob',
      'ls', 'web_search', 'web_fetch',
      'lsp_hover', 'lsp_goto_definition', 'lsp_references', 'lsp_diagnostics',
      'ask_user', 'plan_task',
    ]);
    return T0_TOOLS.has(toolName);
  }

  /**
   * P0-4 fix (remediation plan Phase 4): Walk the workspace for
   * source files and index them into the context engine's symbol
   * graph. Called lazily from `run()` on the first run after the
   * AgentLoop is constructed (guarded by `symbolGraphIndexed`).
   *
   * The walk skips `node_modules`, `.git`, `dist`, `build`, and
   * other common ignore patterns. It's capped at `MAX_INDEX_FILES`
   * (500) to keep indexing fast on large repos — beyond that, the
   * user should run `goli index` manually (future CLI command) for
   * a full index.
   *
   * Failures are caught by the caller (`run()`), logged, and the run
   * continues with an empty symbol graph — the retriever's lexical +
   * semantic arms still work; only the structural arm returns empty
   * results.
   */
  private async initializeSymbolGraph(): Promise<void> {
    if (!this.contextEngine) return;
    const startTime = Date.now();
    const files = collectSourceFiles(process.cwd(), MAX_INDEX_FILES);
    if (files.length === 0) {
      this.log?.debug('SymbolGraph: no source files found in workspace — skipping indexing');
      this.symbolGraphIndexed = true;
      return;
    }
    this.log?.info('SymbolGraph: indexing workspace', {
      fileCount: files.length,
      root: process.cwd(),
    });
    const inserted = await this.contextEngine.indexWorkspace(files);
    this.symbolGraphIndexed = true;
    this.log?.info('SymbolGraph: indexing complete', {
      fileCount: files.length,
      symbolsInserted: inserted,
      durationMs: Date.now() - startTime,
    });
  }

  /**
   * Execute a single tool call.
   *
   * Phase 4: `plan_task` is handled inline (it updates the planner).
   * All other tools are dispatched through the ToolRegistry, which
   * handles JSON Schema validation, execution, and truncation.
   * @param toolCall
   * @param state
   */
  private async executeToolCall(
    toolCall: ToolCall,
    state: ConversationState,
  ): Promise<string> {
    toolCall.status = 'executing';
    const startTime = Date.now();

    try {
      // Handle parse errors first
      if (toolCall.parseError) {
        toolCall.status = 'failed';
        toolCall.error = toolCall.parseError;
        return `Error: failed to parse tool arguments — ${toolCall.parseError}. Please re-emit the tool call with valid JSON.`;
      }

      const args = toolCall.argumentsParsed ?? {};

      // plan_task is handled inline (not in the registry)
      if (toolCall.name === 'plan_task') {
        const todos = args['todos'];
        if (!Array.isArray(todos)) {
          toolCall.status = 'failed';
          return 'Error: plan_task requires a "todos" array.';
        }
        try {
          this.planner.updateTodos(todos as Todo[]);
          toolCall.status = 'completed';
          return `TODO list updated. ${this.planner.summarize()}`;
        } catch (err) {
          toolCall.status = 'failed';
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      }

      // All other tools: dispatch through the registry
      const ctx: ToolContext = {
        toolCallId: toolCall.id,
        workspaceRoot: process.cwd(),
        readFiles: state.readFiles,
        godMode: this.godMode,
        autoMode: this.autoMode,
        sandboxMode: this.config.sandbox.mode,
        logger: this.log,
        // P1-3: propagate the pre-execution approval callback so T1+
        // tools (bash, write_file, edit_file, notebook_edit,
        // background_shell, spawn_subagent) can block on user
        // approval BEFORE executing. When undefined (headless mode
        // without an interactive approver), tools fail-closed.
        requestApproval: this.requestApproval,
        // P3-3: propagate the subagent spawner so the spawn_subagent
        // tool can delegate to a nested AgentLoop. The spawner handles
        // depth limiting, approval independence (subagents get their own
        // approval context — godMode is NOT inherited), and budget.
        spawnSubagent: this.spawnSubagentInternal.bind(this),
        // P3-4: propagate the LSP client so the 4 LSP tools can
        // delegate hover/goto-definition/references/diagnostics.
        lspClient: this.lspClient,
      };

      // P0-5 fix (remediation plan Phase 5): verify policy integrity
      // before executing T1+ tools (bash, write_file, edit_file,
      // notebook_edit, background_shell, spawn_subagent). These are
      // the tools that can modify the filesystem or spawn processes —
      // exactly the actions an attacker (or a compromised SICA) would
      // target after modifying the safety guard code. T0 (read-only)
      // tools skip the check for performance (the 60s cache makes the
      // overhead negligible, but skipping entirely on T0 is still
      // cheaper). God mode also skips the check (it already bypasses
      // all gates).
      const isT1Plus = !this.isToolT0(toolCall.name);
      if (isT1Plus && !this.godMode) {
        const integrity = this.integrityChecker.verify();
        if (!integrity.ok) {
          toolCall.status = 'failed';
          toolCall.error = `Policy integrity violation: ${integrity.message}`;
          this.log?.error('Policy integrity check FAILED — denying tool execution', {
            tool: toolCall.name,
            changedFiles: integrity.changedFiles,
            message: integrity.message,
          });
          return `Error: Policy integrity violation — ${integrity.message}. Tool execution denied. The session may have been tampered with; restart goli to re-establish a trusted baseline.`;
        }
      }

      const result = await this.toolRegistry.dispatch(toolCall, ctx);

      // Update the toolCall with the result
      toolCall.status = result.ok ? 'completed' : 'failed';
      toolCall.result = result.content;
      toolCall.error = result.error;
      toolCall.durationMs = Date.now() - startTime;

      // P1-9 fix (remediation plan Phase 9): attach provenance tag so
      // downstream consumers (CliAgentLoop → TUI HistoryScroll,
      // audit-log, trajectory export) can attribute the result. The
      // tag is informational — security decisions still go through
      // `ProvenanceTracker.canTriggerAction()` which uses a separate
      // trust-level taxonomy. `deriveToolSource()` maps the tool name
      // to the display category ('tool' / 'mcp' / 'subagent' / ...).
      toolCall.provenance = {
        source: deriveToolSource(toolCall.name),
        toolName: toolCall.name,
        timestamp: Date.now(),
        sessionId: state.sessionId ?? '',
        turn: state.iterations,
      };

      // Track read files (for Read-before-Edit enforcement).
      // Use path.resolve() for portable, normalized path comparison so
      // that `./foo/../bar` and `bar` hash to the same key. The previous
      // implementation used string concatenation which (a) didn't handle
      // Windows drive letters, (b) couldn't normalize `..` segments,
      // (c) left unsafe `as string` casts on `unknown` args.
      if (toolCall.name === 'read_file' && result.ok && args['file_path']) {
        const filePath = String(args['file_path']);
        const resolvedPath = resolve(process.cwd(), filePath);
        state.readFiles.add(resolvedPath);
      }

      if (result.ok) {
        return result.content;
      } else {
        // P2-18 fix (remediation plan Phase 18): record the failure in
        // the ReflexionEngine so a strategy note is injected into the
        // next system prompt. Best-effort — if the engine throws, we
        // log and continue (the tool failure itself is still surfaced
        // to the model via the returned error string; reflexion is an
        // enhancement, not a gate). The await is intentional: the
        // reflection needs to be ready before the next iteration's
        // system-prompt assembly (which happens after this method
        // returns). The heuristic-only path is synchronous; the
        // LLM-driven path may take a few hundred ms.
        try {
          const failureError = new Error(result.error ?? 'tool execution failed');
          const classification = classifyApiError(failureError);
          await this.reflexionEngine.reflect(
            failureError,
            toolCall,
            classification,
            state.messages,
          );
        } catch (reflexionErr) {
          this.log?.warn('Reflexion engine failed to record failure', {
            tool: toolCall.name,
            error: reflexionErr instanceof Error ? reflexionErr.message : String(reflexionErr),
          });
        }
        return `Error: ${result.error ?? 'tool execution failed'}`;
      }
    } finally {
      toolCall.durationMs = Date.now() - startTime;
    }
  }

  /**
   * P3-3: Spawn a subagent to work on a subtask.
   *
   * This is the implementation behind `ctx.spawnSubagent` — the callback
   * that the `spawn_subagent` tool delegates to. It constructs a nested
   * `AgentLoop` with:
   *   - Its own `ConversationState` (fresh message history)
   *   - Its own budget (subagents don't inherit the parent's token budget)
   *   - Approval INDEPENDENCE: subagents do NOT inherit godMode. A
   *     god-mode parent spawning a subagent still gets a build-mode
   *     subagent (so the subagent's T1+ tool calls go through approval).
   *     This is the audit's Finding 3.36 requirement.
   *   - Depth limiting: if `currentDepth >= maxSubagentDepth`, the spawn
   *     is refused with a clear error (prevents infinite recursion).
   *
   * The subagent runs synchronously (the parent `await`s). Parallel
   * subagent execution is handled by `executeToolCallsConcurrent` at
   * the tool-batch level — if the model emits multiple `spawn_subagent`
   * calls in one turn, they run concurrently via the parallel executor.
   *
   * Worktree isolation (git worktree per subagent) is NOT implemented
   * here — it requires git operations and is a follow-up. The subagent
   * runs in the same workspace as the parent. `useWorktree` is accepted
   * but currently ignored (logged).
   */
  private async spawnSubagentInternal(
    input: import('@goli-cli/tool-system/core/spawn-subagent.js').SubagentSpawnInput,
  ): Promise<import('@goli-cli/tool-system/core/spawn-subagent.js').SubagentResult> {
    const subagentId = input.subagentId ?? `sub-${Math.random().toString(36).slice(2, 10)}`;
    // Depth check — prevent infinite recursion.
    if (this.currentDepth >= this.maxSubagentDepth) {
      return {
        subagentId,
        worktreeCreated: false,
        worktreePath: '',
        branch: '',
        content: '',
        ok: false,
        error: `Subagent depth limit reached (${this.currentDepth} >= ${this.maxSubagentDepth}). Cannot spawn nested subagent.`,
      };
    }
    if (input.useWorktree) {
      // Worktree creation requires git operations (worktree add, branch
      // create). This is a follow-up — for now we log and run in-process.
      this.log.warn('spawn_subagent: useWorktree=true is not yet implemented — running in-process', {
        subagentId,
      });
    }
    this.log.info('Spawning subagent', {
      subagentId,
      role: input.role,
      depth: this.currentDepth + 1,
      promptLength: input.prompt.length,
    });
    const startedAt = Date.now();
    try {
      // Construct a nested AgentLoop. The subagent gets its own config
      // (same model, same tools) but:
      //   - godMode is FORCED to false (approval independence — Finding 3.36)
      //   - autoMode is inherited (the user's --auto flag applies to subagents)
      //   - requestApproval is inherited (so the subagent's T1+ tools
      //     still prompt the user — the subagent doesn't silently bypass)
      //   - The same contextEngine / memoryCurator / mcpServers (shared
      //     workspace resources — subagents don't need their own)
      const subLoop = new AgentLoop({
        config: this.config,
        logger: this.log,
        godMode: false, // P3-3: approval independence — never inherit godMode
        autoMode: this.autoMode,
        appMode: this.defaultAppMode,
        requestApproval: this.requestApproval,
        // Subagents don't get their own MCP servers / context engine /
        // memory curator — they share the parent's (the workspace is
        // the same). This avoids double-connecting MCP servers.
      });
      // Increment depth so the subagent's own spawn_subagent calls
      // are tracked.
      subLoop.currentDepth = this.currentDepth + 1;
      // Run the subagent with the subtask prompt.
      const result = await subLoop.run({
        prompt: input.prompt,
        role: input.role,
        signal: input.signal,
      });
      this.log.info('Subagent completed', {
        subagentId,
        ok: result.ok,
        iterations: result.iterations,
        tokens: result.totalTokens,
        durationMs: result.durationMs,
      });
      return {
        subagentId,
        worktreeCreated: false,
        worktreePath: '',
        branch: '',
        content: result.content,
        ok: result.ok,
        error: result.error,
        totalTokens: result.totalTokens,
        durationMs: result.durationMs,
        iterations: result.iterations,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.error('Subagent failed', { subagentId, error: message });
      return {
        subagentId,
        worktreeCreated: false,
        worktreePath: '',
        branch: '',
        content: '',
        ok: false,
        error: `Subagent crashed: ${message}`,
        durationMs: Date.now() - startedAt,
      };
    }
  }

  /**
   * Abort the running loop. If no run is in progress, this is a no-op
   * (previously it would set a shared controller to aborted, poisoning
   * all future runs).
   */
  abort(): void {
    this.currentAbortController?.abort();
    this.stopEngine?.abort();
  }

  /**
   * P1-3 fix (verification report item #5): Request that the next
   * iteration run compaction regardless of the current token count.
   *
   * This is the external entry point for the `/compact` slash command
   * (and any other caller that wants to trigger compaction
   * out-of-band). It sets the same `forceCompaction` flag the retry
   * layer uses when the error classifier reports "context too long",
   * so the next iteration's `shouldCompact` check at the top of the
   * ReAct loop will fire and invoke `AdvancedCompression.compact()`.
   *
   * If a run is currently in progress, the compaction will trigger
   * at the START of the NEXT iteration (compaction is checked
   * per-iteration, not mid-iteration — see `loop.ts:819`). If no run
   * is in progress, the flag is set and will fire on the next `run()`
   * or `runStream()` call.
   *
   * This method is idempotent: calling it multiple times before the
   * next iteration is equivalent to calling it once (the flag is
   * reset to `false` after the compaction runs).
   */
  requestCompaction(): void {
    this.forceCompaction = true;
  }

  /**
   * P1-4 fix (verification report item #4): Lazily compute and cache
   * the skills L1 metadata string for the current run.
   *
   * The cache is per-run (reset at the top of each `run()` call) so
   * the SkillLoader is only queried once per run, even though
   * `assemble()` is called per-iteration. This preserves the prefix
   * cache (the skills fragment is byte-stable across iterations
   * within a single run) and avoids redundant catalog scans.
   *
   * Returns `undefined` when no SkillLoader is configured (the
   * assembler will skip the skills fragment).
   */
  private cachedSkillsL1: string | undefined;
  private skillsL1Computed = false;
  /**
   * P1-16: cache key for the L1 skills fragment. The cache is
   * invalidated when either the AppMode or the task prompt changes
   * (because both affect mode-based filtering and trigger-based
   * ranking). Stored as `${appMode}:${promptHash}` so a no-op re-run
   * with the same inputs reuses the cached fragment.
   */
  private skillsL1CacheKey: string | undefined;
  /**
   * P1-16: get the L1 skills fragment, filtered by `appMode` and
   * ranked by trigger relevance to `taskPrompt`.
   *
   * The result is cached per (appMode, taskPrompt) pair — re-querying
   * with the same inputs returns the cached string without re-running
   * the catalog. When either input changes, the cache is busted and
   * the fragment is recomputed.
   */
  private getCachedSkillsL1(appMode: string | undefined, taskPrompt: string): string | undefined {
    const cacheKey = `${appMode ?? 'default'}:${taskPrompt.length}`;
    if (this.skillsL1Computed && this.skillsL1CacheKey === cacheKey) {
      return this.cachedSkillsL1;
    }
    this.skillsL1Computed = true;
    this.skillsL1CacheKey = cacheKey;
    if (!this.skillLoader) return undefined;
    try {
      // P1-16: pass mode + query so formatL1ForPrompt() can filter
      // by mode-allowed categories and rank by trigger relevance.
      this.cachedSkillsL1 = this.skillLoader.formatL1ForPrompt({
        mode: appMode,
        query: taskPrompt,
      });
    } catch (err) {
      // Best-effort: if the SkillLoader throws (e.g., skills directory
      // doesn't exist or is corrupted), log and continue without the
      // skills fragment. The agent loop must never crash on a skills
      // subsystem failure.
      this.log.warn('SkillLoader.formatL1ForPrompt() failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      this.cachedSkillsL1 = undefined;
    }
    return this.cachedSkillsL1;
  }

  /**
   * P0-6 fix (remediation plan Phase 6): cached L2 skill instructions.
   *
   * Like `getCachedSkillsL1`, this is computed ONCE per run (lazily,
   * on first iteration) and cached. The L2 instructions are loaded
   * on-demand: the SkillLoader finds skills whose triggers match the
   * user's query, then calls `loadL2Instructions(skillId)` for the
   * top 3 matches. The results are concatenated and capped at
   * `L2_BUDGET_TOKENS` (4000 chars ≈ 1000 tokens) to prevent L2
   * from consuming too much context.
   *
   * Returns `undefined` when no SkillLoader is configured, when no
   * skills match the query, or when the L2 loading fails (the agent
   * falls back to L1-only — no regression).
   */
  private cachedSkillsL2: string | undefined;
  private skillsL2Computed = false;
  private skillsL2CacheKey: string | undefined;
  private getCachedSkillsL2(appMode: string | undefined, taskPrompt: string): string | undefined {
    const cacheKey = `${appMode ?? 'default'}:${taskPrompt.length}`;
    if (this.skillsL2Computed && this.skillsL2CacheKey === cacheKey) {
      return this.cachedSkillsL2;
    }
    this.skillsL2Computed = true;
    this.skillsL2CacheKey = cacheKey;
    if (!this.skillLoader) return undefined;
    try {
      // P0-6: find skills whose triggers match the user's query,
      // then load their L2 instructions. We use the mode-filtered
      // list (so read-only mode doesn't load L2 for a `debugging`
      // skill, for example) and rank by trigger relevance.
      const modeSkills = this.skillLoader.listForMode(appMode);
      if (modeSkills.length === 0) return undefined;
      const ranked = this.skillLoader.rankAndTruncateL1(modeSkills, taskPrompt, 800);
      if (ranked.length === 0) return undefined;
      // P0-6: load L2 for the top 3 matches. `loadL2Instructions`
      // is synchronous (reads from disk) — no await needed.
      const topMatches = ranked.slice(0, 3);
      const l2Parts: string[] = [];
      let totalChars = 0;
      const L2_BUDGET_CHARS = 4000; // ≈ 1000 tokens
      for (const skill of topMatches) {
        const l2 = this.skillLoader.loadL2Instructions(skill.name);
        if (l2 && l2.length > 0) {
          const header = `### ${skill.name}\n`;
          const body = l2.length + totalChars > L2_BUDGET_CHARS
            ? l2.slice(0, L2_BUDGET_CHARS - totalChars) + '\n[... truncated]'
            : l2;
          l2Parts.push(`${header}\n${body}`);
          totalChars += header.length + body.length;
          if (totalChars >= L2_BUDGET_CHARS) break;
        }
      }
      this.cachedSkillsL2 = l2Parts.length > 0 ? l2Parts.join('\n\n') : undefined;
      if (this.cachedSkillsL2) {
        this.log?.debug('L2 skill instructions loaded', {
          matchCount: topMatches.length,
          totalChars,
        });
      }
    } catch (err) {
      this.log?.warn('L2 skill loading failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      this.cachedSkillsL2 = undefined;
    }
    return this.cachedSkillsL2;
  }

  /**
   * Stream events from the loop (async generator).
   *
   * The TUI consumes this to render streaming output.
   *
   * P2-9 fix (re-verification report item N2): previously this yielded
   * ONLY `loop-start` and `stop` — no tool-call or content events —
   * and the CLI's `CliAgentLoop.tryRunStream()` was reading `e.kind`
   * (which doesn't exist on `AgentEvent`; the discriminator is `type`)
   * so even those two events were silently discarded. The net effect
   * was that the streaming layer was a complete no-op: the TUI never
   * saw `phase`/`text`/`tool` events from `runStream`, and the
   * tool-call trail in the transcript was empty.
   *
   * We now yield, in order:
   *   1. `loop-start`           — run begins
   *   2. `tool-call-result` × N  — one per tool call (post-hoc, from
   *                               `state.messages`; real per-iteration
   *                               streaming requires H9 callback support)
   *   3. `content-delta`         — the final assistant content (single
   *                               chunk; per-token deltas need H9)
   *   4. `stop`                  — run ends with reason + message
   *
   * Per-iteration `thinking`, `loop-iteration`, and per-token
   * `content-delta` events still require the model client to expose a
   * streaming callback (H9 roadmap). Until then, consumers get the
   * full tool-call trail + final content + stop reason — enough to
   * render a useful transcript.
   * @param input
   */
  async *runStream(input: AgentLoopInput): AsyncGenerator<AgentEvent> {
    const startTime = Date.now();

    yield {
      type: 'loop-start',
      data: {
        type: 'loop-start',
        prompt: input.prompt,
        role: input.role ?? 'orchestrator',
      },
      timestamp: new Date().toISOString(),
      iteration: 0,
    };

    const result = await this.run(input);

    // P2-9 fix: yield a `tool-call-result` event for each tool call
    // collected during the run. The TUI's `CliAgentLoop.tryRunStream`
    // maps these to `kind: 'tool'` events so the transcript shows the
    // full tool-call trail. (Per-iteration `tool-call-start` events
    // would let the TUI show a tool as "running" before it completes,
    // but that requires H9 callback streaming; for now we emit the
    // completed result.)
    if (result.toolCalls && result.toolCalls.length > 0) {
      for (const tc of result.toolCalls) {
        yield {
          type: 'tool-call-result',
          data: {
            type: 'tool-call-result',
            toolCall: tc,
          },
          timestamp: new Date().toISOString(),
          iteration: result.iterations,
        };
      }
    }

    // P2-9 fix: yield the final assistant content as a single
    // `content-delta` chunk. The TUI maps this to `kind: 'text'`.
    // (Per-token deltas need H9 callback streaming; until then this
    // is a single post-hoc chunk, but it preserves the streaming
    // contract so consumers don't need a separate code path.)
    if (result.content && result.content.length > 0) {
      yield {
        type: 'content-delta',
        data: {
          type: 'content-delta',
          delta: result.content,
        },
        timestamp: new Date().toISOString(),
        iteration: result.iterations,
      };
    }

    yield {
      type: 'stop',
      data: {
        type: 'stop',
        reason: result.stopReason ?? 'completed',
        message: result.error ?? 'Done',
      },
      timestamp: new Date().toISOString(),
      iteration: result.iterations,
    };

    // startTime is captured for future per-iteration timing events
    // (H9 callback streaming will emit 'loop-iteration' events with
    // elapsed-ms fields derived from this baseline).
    void startTime;
  }
}

/**
 * Best-effort secret redaction for user-prompt previews in logs.
 * Same patterns as the audit-log redaction in `sandbox/executor.ts`.
 * Defends against the case where a user pastes an API key,
 * password, or PII into the prompt (common when asking the agent
 * to debug auth issues) — the preview would otherwise end up in
 * the log file verbatim.
 */
function redactPromptSecrets(input: string): string {
  let redacted = input;
  // Authorization: Bearer / Basic.
  redacted = redacted.replace(/(Authorization:\s*(?:Bearer|Basic)\s+)([A-Za-z0-9._-]+)/gi, '$1[REDACTED]');
  // Generic key=value.
  redacted = redacted.replace(/(?:api[_-]?key|secret|password|passwd|token|auth|credential)["'\s:=]+([A-Za-z0-9_-]{20,})/gi, '[REDACTED]');
  // GitHub tokens.
  redacted = redacted.replace(/\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, '[REDACTED]');
  // Slack tokens.
  redacted = redacted.replace(/\bxox[bpoa]-[A-Za-z0-9-]+\b/g, '[REDACTED]');
  // OpenAI keys.
  redacted = redacted.replace(/\bsk-[A-Za-z0-9]{20,}\b/g, '[REDACTED]');
  // JWTs.
  redacted = redacted.replace(/\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED]');
  // PEM blocks.
  redacted = redacted.replace(/-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g, '[REDACTED:private_key]');
  return redacted;
}

// ─── P0-4: SymbolGraph workspace walker ─────────────────────────────────

/**
 * P0-4 fix (remediation plan Phase 4): Max number of source files to
 * index automatically. Beyond this, the user should run `goli index`
 * manually (future CLI command) for a full index. The cap keeps
 * startup fast on large repos — the first 500 files cover the
 * workspace's most-important entry points in practice.
 */
const MAX_INDEX_FILES = 500;

/**
 * P0-4: Directories to skip when walking the workspace for source
 * files. Mirrors the `DEFAULT_SKIP_DIRS` list in
 * `context/project-map.ts` (kept local to avoid a cross-module import).
 */
const INDEX_SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.cache',
  'coverage', '.nyc_output', '.turbo', '.parcel-cache',
  '.venv', '__pycache__', '.mypy_cache', '.pytest_cache',
  'target', 'debug', 'release',
]);

/**
 * P0-4: File extensions to index. Covers the languages the tree-sitter
 * indexer supports (TypeScript, JavaScript, Python, Go, Rust).
 */
const INDEX_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py',
  '.go',
  '.rs',
]);

/**
 * P0-4: Walk the workspace root for source files matching
 * `INDEX_EXTENSIONS`, skipping `INDEX_SKIP_DIRS`. Returns up to
 * `maxFiles` absolute paths. Synchronous (called once per AgentLoop
 * instance — the cost is acceptable).
 *
 * @param rootDir - The workspace root to walk.
 * @param maxFiles - Max files to return. Default `MAX_INDEX_FILES`.
 * @returns Array of absolute file paths.
 */
function collectSourceFiles(rootDir: string, maxFiles: number = MAX_INDEX_FILES): string[] {
  const results: string[] = [];
  const stack: string[] = [rootDir];
  while (stack.length > 0 && results.length < maxFiles) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue; // permission denied or disappeared
    }
    for (const entry of entries) {
      if (results.length >= maxFiles) break;
      const fullPath = join(dir, entry);
      let st;
      try {
        st = statSync(fullPath);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (!INDEX_SKIP_DIRS.has(entry) && !entry.startsWith('.')) {
          stack.push(fullPath);
        }
      } else if (st.isFile()) {
        const ext = entry.slice(entry.lastIndexOf('.')).toLowerCase();
        if (INDEX_EXTENSIONS.has(ext)) {
          results.push(fullPath);
        }
      }
    }
  }
  return results;
}
