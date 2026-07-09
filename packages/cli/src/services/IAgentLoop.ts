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
  | { kind: 'done' };

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
