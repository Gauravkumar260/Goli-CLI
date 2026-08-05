/**
 * Sandbox types (Module 4).
 *
 * Defines the core data structures for the OS-native sandbox: sandbox
 * modes, approval policies, sandbox results, and the 3-tier permission
 * model (Safe / Risky / Destructive).
 *
 * @module sandbox/types
 */

/** The three sandbox modes (Codex standard). */
export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

/** When to ask for approval before crossing the sandbox boundary. */
export type ApprovalPolicy = 'on-request' | 'on-failure' | 'never';

/** The 3-tier permission model (user's spec). */
export type PermissionTier = 'T0' | 'T1' | 'T2' | 'T3' | 'BLK';

/** Result of executing a command in the sandbox. */
export interface SandboxResult {
  /** Whether the command exited with code 0. */
  ok: boolean;
  /** The exit code (0 = success, non-zero = failure). */
  exitCode: number;
  /** stdout output. */
  stdout: string;
  /** stderr output. */
  stderr: string;
  /** Wall-clock duration in ms. */
  durationMs: number;
  /** Whether the command was killed by a signal (e.g. OOM, timeout). */
  killed: boolean;
  /** The signal that killed the process (if killed). */
  signal?: string;
  /** The sandbox mode used for this execution. */
  sandboxMode: SandboxMode;
  /** The approval decision that was made. */
  approvalDecision?: ApprovalDecision;
}

/** The result of a path validation check. */
export interface PathValidationResult {
  /** Whether the path is safe to access. */
  ok: boolean;
  /** The canonical (realpath) form of the path. */
  canonicalPath: string;
  /** Why the path was rejected (if `ok` is false). */
  reason?: string;
}

/** A network destination (host + port). */
export interface NetworkDestination {
  host: string;
  port: number;
}

/** The result of a network egress check. */
export interface NetworkEgressResult {
  /** Whether the destination is allowed. */
  allowed: boolean;
  /** The destination that was checked. */
  destination: NetworkDestination;
  /** Why the destination was blocked (if `allowed` is false). */
  reason?: string;
}

/** The decision made by the approval engine. */
export type ApprovalDecision = 'allow' | 'deny' | 'ask';

/** A request for approval (sent to the TUI's PermissionDialog). */
export interface ApprovalRequest {
  /** Unique ID for this request. */
  id: string;
  /** The command or action being approved. */
  action: string;
  /** The permission tier required. */
  tier: PermissionTier;
  /** The sandbox mode. */
  sandboxMode: SandboxMode;
  /** A human-readable description of what the action does. */
  description: string;
  /** The tool that initiated the request. */
  tool: string;
  /** Timestamp (ISO 8601). */
  timestamp: string;
}

/** An entry in the immutable audit log. */
export interface AuditLogEntry {
  /** Timestamp (ISO 8601). */
  timestamp: string;
  /** The tool that made the call. */
  tool: string;
  /** The command or action. */
  action: string;
  /** The sandbox mode. */
  sandboxMode: SandboxMode;
  /** The approval decision. */
  approval: ApprovalDecision;
  /** The permission tier. */
  tier: PermissionTier;
  /** Whether the execution succeeded. */
  ok: boolean;
  /** Exit code (for bash commands). */
  exitCode?: number;
  /** Duration in ms. */
  durationMs: number;
  /** The session ID. */
  sessionId: string;
  /** The workspace root. */
  workspaceRoot: string;
  /**
   * SHA-256 hash of the previous entry's `hash` field concatenated
   * with the canonical JSON of this entry (excluding the `hash` and
   * `prevHash` fields themselves). Forms a tamper-evident chain:
   * modifying, deleting, reordering, or inserting any entry breaks
   * the chain at that point and is detectable by `verifyAuditLog`.
   *
   * For the FIRST entry in the log, `prevHash` is the literal string
   * `"GENESIS"` (a well-known sentinel).
   *
   * P1-5 fix (audit Finding 6.26): the previous schema had no
   * `prevHash`/`hash` fields at all — the log was append-only JSONL
   * with no cryptographic integrity. An attacker with write access
   * could delete, modify, reorder, or insert entries undetected.
   *
   * Backward compat: entries written by older clients (no `hash`
   * field) are still readable; `verifyAuditLog` reports them as
   * "unhashed" rather than failing the entire chain.
   */
  prevHash?: string;
  /** This entry's hash (see `prevHash` for the chain formula). */
  hash?: string;
}

/** Resource limits (cgroups v2). */
export interface ResourceLimits {
  /** Hard memory limit in MB (OOM kill). */
  memoryMaxMb: number;
  /** Soft memory limit in MB (throttle). */
  memoryHighMb: number;
  /** CPU quota in percent (200 = 2 cores). */
  cpuQuotaPercent: number;
  /** Max process count (fork bomb defense). */
  pidMax: number;
  /** Max disk usage in MB. */
  diskMaxMb: number;
  /** Wall-clock timeout in seconds. */
  wallclockTimeoutS: number;
}
