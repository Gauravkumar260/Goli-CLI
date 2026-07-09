/**
 * state/types.ts — Message, ToolCall and shared types for the Ink TUI.
 *
 * Mirrors the IAgentLoop AgentEvent protocol but in the shape the
 * React components actually consume.
 */
import type { TierId, AppMode } from '../theme/agents.js';

/**
 *
 */
export type PermissionMode = 'plan' | 'default' | 'auto' | 'bypass';
/**
 *
 */
export type AgentPhase = 'IDLE' | 'INIT' | 'PLAN' | 'TOOL' | 'GEN' | 'DONE' | 'ERROR';
/**
 *
 */
export type RunMode = 'SAFE' | 'GOD';

/** §4.7 Session lifecycle state. */
export type SessionPhase = 'NEW' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED';

/** §4.4 Busy-input mode — what happens when you type while agent is running. */
export type BusyInputMode = 'interrupt' | 'queue' | 'steer';

/**
 *
 */
export type ToolTier = 'T0' | 'T1' | 'T2' | 'T3' | 'AUTO' | 'BLK';
/**
 *
 */
export type ToolState = 'pending' | 'running' | 'success' | 'failed' | 'denied';

/**
 *
 */
export interface ToolCall {
  id: string;
  name: string;
  tier: ToolTier;
  arg: string;
  state: ToolState;
  cost?: number;
  durationMs?: number;
  meta?: string;
  error?: string;
  output?: string;
}

/**
 *
 */
export type Message =
  | { id: string; type: 'user'; content: string; timestamp: number }
  | { id: string; type: 'agent'; content: string; timestamp: number; streaming: boolean; toolCalls: ToolCall[]; agentId?: string; tok?: number }
  | { id: string; type: 'system'; content: string; variant: 'info' | 'warning' | 'error'; timestamp: number }
  | { id: string; type: 'btw'; content: string; timestamp: number }
  // T-045 (loop run 5): 4 new specialized message types
  | { id: string; type: 'thinking'; content: string; timestamp: number; agentId?: string }
  | { id: string; type: 'error'; content: string; timestamp: number; code?: string }
  | { id: string; type: 'warning'; content: string; timestamp: number }
  | { id: string; type: 'hint'; content: string; timestamp: number };

/**
 * Diff payload carried alongside a pending permission for mutating tools
 * (edit_file / write_file). When present, the PermissionDialog shows a
 * "(v)iew diff" hint and pressing `v` opens the DiffReviewDialog.
 */
export interface PendingDiffEntry {
  /** The absolute or workspace-relative file path. */
  filePath: string;
  /** The tool that produced the diff (edit_file / write_file). */
  tool: string;
  /** The old content (empty string for new files via write_file). */
  oldContent: string;
  /** The proposed new content. */
  newContent: string;
}

/**
 *
 */
export interface PendingPermission {
  permissionId: string;
  tool: string;
  tier: ToolTier;
  arg: string;
  /**
   * T-062: Position in the confirmation queue (1-indexed).
   * Populated by `enqueuePermission`. UI renders "Approve {index} of {total}".
   */
  index?: number;
  /**
   * T-062: Total permissions in the queue at the time this one was enqueued.
   * Populated by `enqueuePermission`. UI renders "Approve {index} of {total}".
   */
  total?: number;
  /**
   * T-068: Diff payload for mutating tools. When present, the user can
   * press `v` in the PermissionDialog to open the DiffReviewDialog and
   * inspect the proposed change before approving.
   */
  diffEntry?: PendingDiffEntry;
}

/** Container for a queued follow-up message (§4.4 queue mode). */
export interface QueuedMessage {
  text: string;
  timestamp: number;
}

/**
 * T-062: Session allowlist entry. When the user picks "always" on a
 * `run_shell_command` permission, the command prefix is added here so
 * future invocations skip the dialog entirely.
 */
export interface AllowlistEntry {
  /** The tool name (e.g. `run_shell_command`, `write_file`). */
  tool: string;
  /** The arg prefix that's allowlisted (e.g. `npm test`, `src/`). */
  argPrefix: string;
  /** When the entry was added (ms since epoch). */
  addedAt: number;
}

/**
 *
 */
export interface AppStateSnapshot {
  sessionId: string;
  model: string;
  workspace: string;
  branch: string;
  permissionMode: PermissionMode;
  godMode: boolean;
  mode: RunMode;
  tier: TierId;
  /** T-MODE: User-facing permission mode (read-only/plan/build/god). */
  appMode?: AppMode;
  activeAgents: string[];
  pipelineStep: number;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  tokens: number;
  tokenLimit: number;
  turn: number;
  startedAt: number;
  /** Non-null when a permission gate is awaiting user decision. */
  pendingPermission: PendingPermission | null;
  /** §4.7 Session lifecycle state. */
  sessionPhase: SessionPhase;
  /** §4.4 How busy-input behaves. */
  busyInputMode: BusyInputMode;
  /** §4.4 / §5.3 Queue of follow-up messages (Tab or queue-mode). */
  queuedMessages: QueuedMessage[];
  /** §5.5 Compact paste placeholder text (when paste > threshold). */
  pastePlaceholder: string | null;
  /** §6.4 Context compact hint — set when tokens > 95%. */
  compactHint: boolean;
}
