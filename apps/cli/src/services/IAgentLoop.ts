/**
 * services/IAgentLoop.ts — Interface for agent loop backends.
 *
 * The TUI talks to agent backends through this interface. Two
 * implementations:
 * - MockAgentLoop: canned responses for offline UI development
 * - CliAgentLoop: wraps @goli/core's AgentLoop for production
 */

/** The agent phase (drives PipelineTrace). */
export type AgentPhase = 'IDLE' | 'INIT' | 'PLAN' | 'TOOL' | 'GEN' | 'ERROR' | 'DONE';

/** A tool call event from the agent. */
export interface ToolCallEvent {
  id: string;
  name: string;
  tier: string;
  arg: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'denied';
  cost?: number;
  durationMs?: number;
  meta?: string;
  /**
   * P1-9 fix (remediation plan Phase 9): provenance fields bridged from
   * core's `ProvenanceTracker`. Populated by `CliAgentLoop` when it
   * translates `AgentLoop.runStream()` tool events into the TUI's
   * `kind: 'tool'` event union member.
   *
   * When undefined (older @goli/core, MockAgentLoop, or untagged tool
   * results), the TUI silently omits the provenance footer — no
   * regression for callers that don't bridge these fields.
   */
  source?: 'tool' | 'mcp' | 'subagent' | 'hook' | 'user' | 'system';
  timestamp?: number;
  sessionId?: string;
  turn?: number;
}

/**
 * A diff entry carried alongside a permission request when the tool
 * proposes file mutations (edit_file / write_file / edit_batch).
 * Lets the TUI render a DiffReviewDialog before the user approves.
 */
export interface PermissionDiffEntry {
  /** The absolute or workspace-relative file path. */
  filePath: string;
  /** The tool that produced the diff (edit_file / write_file). */
  tool: string;
  /** The old content (empty string for new files via write_file). */
  oldContent: string;
  /** The proposed new content. */
  newContent: string;
}

/** A permission request event. */
export interface PermissionRequest {
  tool: string;
  tier: string;
  arg: string;
  /**
   * Optional diff payload. Populated for mutating tools (edit_file,
   * write_file, edit_batch) so the TUI can show a diff preview before
   * the user approves. Omitted for read-only tools (read_file, grep, etc.).
   */
  diffEntry?: PermissionDiffEntry;
}

/** An event streamed from the agent loop to the TUI. */
export type AgentEvent =
  | { kind: 'phase'; phase: AgentPhase }
  | { kind: 'text'; text: string }
  | { kind: 'tool'; tool: ToolCallEvent }
  | { kind: 'permission'; request: PermissionRequest }
  | { kind: 'error'; error: string }
  | { kind: 'compaction'; info: CompactionInfo }
  | { kind: 'done' };

/**
 * P1-11 fix (remediation plan Phase 11): compaction info emitted by
 * `CliAgentLoop` after `AdvancedCompressor.compress()` runs.
 *
 * The TUI consumes this via `useAgentLoop` and renders a transient
 * `CompactionBanner` showing the token delta and the layers applied.
 * When no compaction has occurred, no event is emitted — the banner
 * stays hidden.
 */
export interface CompactionInfo {
  /** What triggered the compaction. */
  triggeredBy: 'auto' | 'manual' | 'overflow';
  /** The 7-phase layers that ran (dedupe/boundaries/evict/prune/summarize/freeze/assemble). */
  layersApplied: string[];
  /** Token count before compaction. */
  tokensBefore: number;
  /** Token count after compaction. */
  tokensAfter: number;
  /** Tokens reclaimed (`tokensBefore - tokensAfter`). */
  tokensReclaimed: number;
  /** Wall-clock duration in ms. */
  durationMs: number;
  /** Number of messages evicted by the Evict layer. */
  evictedTurns: number;
  /** Number of tool results pruned by the Prune layer. */
  summarizedTurns: number;
}

/** Input to IAgentLoop.run(). */
export interface AgentRunInput {
  prompt: string;
  messageId: string;
  godMode: boolean;
}

/** The interface every agent loop backend must implement. */
export interface IAgentLoop {
  run(input: AgentRunInput): AsyncIterable<AgentEvent>;
  abort(): void;
  approve(permissionId: string, always: boolean): void;
  deny(permissionId: string): void;
  getLastResult?(): { inputTokens: number; outputTokens: number; costUsd: number } | null;
}

/**
 * Extended contract for the real CLI agent loop (P2-4 fix).
 *
 * `IAgentLoop` is the minimal contract that BOTH `CliAgentLoop` and
 * `MockAgentLoop` implement — it lets the TUI run in `--demo` mode
 * without the production dependencies. As `CliAgentLoop` grew, five
 * methods (`setAppMode`, `shouldAskPermission`, `markAlwaysApproved`,
 * `requestCompaction`, `requestApproval`) were added to it without
 * being promoted onto the shared interface. The TUI accessed them via
 * `as any` casts in `useAgentLoop.ts`, which (a) hid typos and
 * signature drift from TypeScript, (b) meant `MockAgentLoop` could
 * silently miss features, and (c) meant refactors could break the TUI
 * at runtime with no compile-time signal.
 *
 * `ICliAgentLoop` promotes those 5 methods onto a typed sub-interface.
 * `CliAgentLoop` implements `ICliAgentLoop`; `MockAgentLoop` implements
 * only `IAgentLoop`. The TUI uses the `isCliAgentLoop` type guard to
 * narrow before calling any of the 5 extended methods, so `--demo`
 * mode is unaffected (the guard returns false for `MockAgentLoop` and
 * the call site skips gracefully).
 *
 * Signatures match the existing `CliAgentLoop` implementation exactly
 * — the implementation is the source of truth, not this interface.
 */
export interface ICliAgentLoop extends IAgentLoop {
  /**
   * Switch the active AppMode mid-session (e.g. `/mode build`).
   * Updates `this.appMode`, clears the always-approved set, and
   * propagates the mode→sandbox policy mapping to the live config
   * so `bash.ts` sees the correct `sandboxMode`.
   */
  setAppMode(mode: string): void;

  /**
   * Check whether a tool call would require user approval in the
   * current mode. Returns true for critical tools (write_file,
   * edit_file, bash, ...) in build/local-llms mode unless the tool
   * has been "always approved" this session. Returns false in god
   * mode and for non-critical tools.
   */
  shouldAskPermission(toolName: string): boolean;

  /**
   * Mark a tool as "always approved" for this session (user picked
   * [a]lways in the PermissionDialog). Subsequent `shouldAskPermission`
   * calls for this tool return false.
   */
  markAlwaysApproved(toolName: string): void;

  /**
   * Force-trigger context compaction (`/compact` command). Sets the
   * same `forceCompaction` flag the retry layer uses; the next
   * iteration runs `AdvancedCompressor.compact()` before processing
   * the next tool call or LLM turn.
   */
  requestCompaction(): void;

  /**
   * Request user approval for a tool call (pre-execution bridge).
   * Returns a Promise that resolves when the user approves or denies
   * via the TUI's PermissionDialog. The TUI's `useAgentLoop` resolves
   * the promise by calling `approve()` or `deny()` on this same loop.
   */
  requestApproval(
    toolCallId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{ approved: boolean; always: boolean }>;
}

/**
 * Type guard: narrows `IAgentLoop` to `ICliAgentLoop`.
 *
 * Uses the `'method' in obj` pattern rather than `instanceof` because
 * `MockAgentLoop` and `CliAgentLoop` don't share a class hierarchy —
 * they only share the `IAgentLoop` interface. The check tests for the
 * two most-distinctive extended methods (`setAppMode` and
 * `requestCompaction`) which `MockAgentLoop` definitively does not
 * implement.
 *
 * Usage in the TUI:
 * ```ts
 * if (isCliAgentLoop(loop)) {
 *   loop.setAppMode(mode);
 * }
 * ```
 * When `loop` is a `MockAgentLoop`, the guard returns false and the
 * call site can either skip silently or emit a demo-mode warning.
 */
export function isCliAgentLoop(loop: IAgentLoop): loop is ICliAgentLoop {
  return (
    'setAppMode' in loop &&
    typeof (loop as { setAppMode?: unknown }).setAppMode === 'function' &&
    'requestCompaction' in loop &&
    typeof (loop as { requestCompaction?: unknown }).requestCompaction === 'function'
  );
}
