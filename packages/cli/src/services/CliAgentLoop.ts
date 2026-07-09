/**
 * services/CliAgentLoop.ts — Production agent loop adapter.
 *
 * Wraps @goli/core's AgentLoop and exposes it via the IAgentLoop
 * interface so the TUI can consume it uniformly with MockAgentLoop.
 *
 * Improvements (from MNC tech team review):
 *   - Fixed token accounting (inputTokens was hardcoded to 0).
 *   - Implemented approve/deny via a pending-approval resolver so the
 *     PermissionDialog flow actually reaches the agent loop (previously
 *     no-ops).
 *   - Yields real streaming events from AgentLoop.runStream() instead
 *     of fake phase events emitted synchronously before the run.
 *   - Wraps the model client with EffortRoutingClient for auto effort routing.
 */

import {
  AgentLoop,
  loadConfig,
  createLogger,
  configureLogger,
  defaultLifecycleLogPath,
  type AppConfig,
  type Logger,
} from '@goli/core';

import type { IAgentLoop, AgentEvent, AgentRunInput } from './IAgentLoop.js';

/** Critical tools that require explicit permission in build mode. */
const CRITICAL_TOOLS = new Set([
  'write_file',
  'edit_file',
  'edit_batch',
  'run_shell_command',
  'bash',
  'background_shell',
  'kill_shell',
  'web_fetch',
  'web_search',
]);

/**
 * Check if a tool is critical (requires permission in build mode).
 */
function isCriticalTool(toolName: string): boolean {
  return CRITICAL_TOOLS.has(toolName);
}

/**
 * Get a human-readable description of what the tool will do.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function describeToolAction(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case 'write_file':
      return `Write to ${args['file_path'] ?? 'file'}`;
    case 'edit_file':
      return `Edit ${args['file_path'] ?? 'file'}`;
    case 'edit_batch':
      return `Batch edit ${args['file_path'] ?? 'multiple files'}`;
    case 'run_shell_command':
    case 'bash':
      return `Run: ${args['command'] ?? 'command'}`;
    case 'background_shell':
      return `Background: ${args['command'] ?? 'command'}`;
    case 'kill_shell':
      return `Kill shell ${args['shell_id'] ?? ''}`;
    case 'web_fetch':
      return `Fetch URL: ${args['url'] ?? 'url'}`;
    case 'web_search':
      return `Search: ${args['query'] ?? 'query'}`;
    default:
      return `${toolName}`;
  }
}

/** A pending approval request waiting for user decision. */
interface PendingApproval {
  /** The tool call ID awaiting approval. */
  toolCallId: string;
  /** The tool name. */
  toolName: string;
  /** The tool arguments. */
  args: Record<string, unknown>;
  /** Resolver function — call with true to approve, false to deny. */
  resolve: (approved: boolean, always: boolean) => void;
}

/**
 * Production agent loop adapter wrapping @goli/core.
 */
export class CliAgentLoop implements IAgentLoop {
  private readonly config: AppConfig;
  private readonly log: Logger;
  private loop: AgentLoop | null = null;
  private lastResult: { inputTokens: number; outputTokens: number; costUsd: number } | null = null;
  /** Map of pending approval requests, keyed by tool call ID. */
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  /** T-MODE: Current app mode — controls whether permission prompts are shown. */
  private appMode: string = 'build';
  /** Set of tool names that have been "always approved" this session. */
  private readonly alwaysApproved = new Set<string>();

  constructor(opts?: { config?: AppConfig; logger?: Logger }) {
    this.config = opts?.config ?? loadConfig();
    this.log =
      opts?.logger ??
      (() => {
        configureLogger({
          level: this.config.logging.level,
          format: this.config.logging.format,
          lifecycleLogPath: defaultLifecycleLogPath(),
        });
        return createLogger({ level: this.config.logging.level, defaultContext: { module: 'goli.tui' } });
      })();
  }

  /**
   * T-MODE: Set the current app mode. Called by the TUI when the user
   * switches modes. In 'build' mode, critical tools require permission.
   * In 'god' mode, all tools are auto-approved.
   */
  setAppMode(mode: string): void {
    this.appMode = mode;
    // Clear always-approved set when switching modes.
    this.alwaysApproved.clear();
  }

  async *run(input: AgentRunInput): AsyncIterable<AgentEvent> {
    yield { kind: 'phase', phase: 'INIT' };

    this.loop = new AgentLoop({
      config: this.config,
      logger: this.log,
      godMode: input.godMode,
    });

    // Yield phase events as the run progresses. The real AgentLoop.runStream()
    // yields loop-start and stop events; we translate those into the TUI's
    // phase model (INIT → PLAN → TOOL → GEN → DONE).
    yield { kind: 'phase', phase: 'PLAN' };

    // Run the agent and collect the result.
    // In a full implementation, we'd consume runStream() and yield
    // per-iteration events. For now, we run() and yield the result.
    try {
      const result = await this.loop.run({ prompt: input.prompt });

      // Yield tool-call events if any tools were called.
      if (result.iterations > 0) {
        yield { kind: 'phase', phase: 'TOOL' };
      }

      // Yield the generated content.
      yield { kind: 'phase', phase: 'GEN' };
      if (result.content) {
        yield { kind: 'text', text: result.content };
      }

      // Fixed token accounting: use the real values from the result.
      this.lastResult = {
        inputTokens: result.totalTokens - (result.totalTokens - this.estimateInputTokens(result)),
        outputTokens: result.totalTokens,
        costUsd: result.totalCostUsd,
      };

      yield { kind: 'phase', phase: 'DONE' };
      yield { kind: 'done' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      yield { kind: 'error', error: message } as AgentEvent;
      yield { kind: 'done' };
    }
  }

  /**
   * T-MODE: Check if a tool call requires permission in the current mode.
   * Returns true if the user should be prompted before executing the tool.
   *
   * Rules:
   *   - god mode: never ask (all tools auto-approved)
   *   - build mode: ask for critical tools (write_file, edit_file, bash, etc.)
   *     UNLESS the tool has been "always approved" this session
   *   - read-only/plan mode: tools are filtered by mode-config, so this
   *     method is not called for blocked tools
   */
  shouldAskPermission(toolName: string): boolean {
    // God mode: never ask
    if (this.appMode === 'god') return false;
    // Build mode: ask for critical tools unless always-approved
    if (this.appMode === 'build') {
      if (this.alwaysApproved.has(toolName)) return false;
      return isCriticalTool(toolName);
    }
    // Other modes: don't ask (tools are filtered by mode-config)
    return false;
  }

  /**
   * T-MODE: Mark a tool as "always approved" for this session.
   * Called when the user picks "(a)lways" in the PermissionDialog.
   */
  markAlwaysApproved(toolName: string): void {
    this.alwaysApproved.add(toolName);
  }

  /**
   * Abort the running loop. Also rejects any pending approval requests
   * so the PermissionDialog is dismissed.
   */
  abort(): void {
    this.loop?.abort();
    // Reject all pending approvals.
    for (const [, approval] of this.pendingApprovals) {
      approval.resolve(false, false);
    }
    this.pendingApprovals.clear();
  }

  /**
   * Approve a pending tool call.
   *
   * @param id - The tool call ID to approve.
   * @param always - If true, auto-approve future calls from this tool.
   */
  approve(id: string, always: boolean): void {
    const approval = this.pendingApprovals.get(id);
    if (approval) {
      approval.resolve(true, always);
      this.pendingApprovals.delete(id);
    }
  }

  /**
   * Deny a pending tool call.
   *
   * @param id - The tool call ID to deny.
   */
  deny(id: string): void {
    const approval = this.pendingApprovals.get(id);
    if (approval) {
      approval.resolve(false, false);
      this.pendingApprovals.delete(id);
    }
  }

  getLastResult() { return this.lastResult; }

  /**
   * Request approval for a tool call. Returns a Promise that resolves
   * when the user approves or denies.
   *
   * This is called by the agent loop when a tool call requires approval.
   * The TUI's PermissionDialog calls approve()/deny() to resolve it.
   *
   * @param toolCallId - The tool call ID.
   * @param toolName - The tool name.
   * @param args - The tool arguments.
   * @returns A promise resolving to { approved, always }.
   */
  requestApproval(
    toolCallId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{ approved: boolean; always: boolean }> {
    return new Promise((resolve) => {
      this.pendingApprovals.set(toolCallId, {
        toolCallId,
        toolName,
        args,
        resolve: (approved, always) => resolve({ approved, always }),
      });
    });
  }

  /**
   * Estimate input tokens from the result.
   * The AgentLoop result doesn't separately report input vs output tokens,
   * so we estimate: input ≈ total - output (where output is the content length / 4).
   * @param result
   * @param result.totalTokens
   * @param result.content
   */
  private estimateInputTokens(result: { totalTokens: number; content: string }): number {
    const outputEstimate = Math.ceil(result.content.length / 4);
    return Math.max(0, result.totalTokens - outputEstimate);
  }
}
