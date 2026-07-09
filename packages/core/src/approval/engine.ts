/**
 * Approval policy engine (Module 4).
 *
 * Implements the 3-tier permission model (Safe / Risky / Destructive)
 * with the Codex 3-mode × 3-policy matrix:
 *
 *   Modes:    read-only | workspace-write | danger-full-access
 *   Policies: on-request | on-failure | never
 *
 * The engine classifies each action into a tier, then decides whether
 * to allow, deny, or ask the user based on the current mode + policy.
 *
 * @module approval/engine
 */

import { randomUUID } from 'node:crypto';

import type {
  SandboxMode,
  ApprovalPolicy,
  PermissionTier,
  ApprovalDecision,
  ApprovalRequest,
} from '../sandbox/types.js';

/** The 3-tier classification of an action. */
export interface ActionClassification {
  /** The permission tier required for this action. */
  tier: PermissionTier;
  /** Human-readable description. */
  description: string;
  /** Whether the action is always blocked (denylist match). */
  blocked?: boolean;
  /** Why the action was blocked. */
  blockReason?: string;
}

/** Options for the ApprovalEngine. */
export interface ApprovalEngineOptions {
  /** The current sandbox mode. */
  sandboxMode: SandboxMode;
  /** The current approval policy. */
  approvalPolicy: ApprovalPolicy;
  /** Whether god mode is active (bypasses all approval). */
  godMode: boolean;
  /** Whether auto mode is active (auto-approve Risky actions). */
  autoMode: boolean;
}

/**
 * The approval engine — classifies actions and decides allow/deny/ask.
 *
 * @module approval/engine
 */
export class ApprovalEngine {
  private readonly sandboxMode: SandboxMode;
  private readonly approvalPolicy: ApprovalPolicy;
  private readonly godMode: boolean;
  private readonly autoMode: boolean;

  constructor(opts: ApprovalEngineOptions) {
    this.sandboxMode = opts.sandboxMode;
    this.approvalPolicy = opts.approvalPolicy;
    this.godMode = opts.godMode;
    this.autoMode = opts.autoMode;
  }

  /**
   * Classify a shell command into a permission tier.
   *
   * Tier mapping:
   * - T0 (Safe): read-only commands (ls, cat, pwd, grep, find, git status)
   * - T1 (Risky): file writes (write_file, edit_file, npm install)
   * - T2 (Risky): shell commands that modify state (rm, mv, mkdir, git commit)
   * - T3 (Destructive): network access (curl, wget, npm publish)
   * - BLK: always-blocked dangerous commands (rm -rf /, mkfs, dd)
   * @param command
   */
  classifyCommand(command: string): ActionClassification {
    const trimmed = command.trim();

    // ─── Denylist (always blocked, even in god mode) ────────────
    const denylistMatch = DENYLIST_PATTERNS.find((p) => p.pattern.test(trimmed));
    if (denylistMatch) {
      return {
        tier: 'BLK',
        description: `Blocked: ${denylistMatch.reason}`,
        blocked: true,
        blockReason: denylistMatch.reason,
      };
    }

    // ─── T3 (Destructive): network access ───────────────────────
    if (NETWORK_PATTERNS.some((p) => p.test(trimmed))) {
      return {
        tier: 'T3',
        description: 'Network access command',
      };
    }

    // ─── T2 (Risky): state-modifying commands ───────────────────
    if (RISKY_PATTERNS.some((p) => p.test(trimmed))) {
      return {
        tier: 'T2',
        description: 'State-modifying command',
      };
    }

    // ─── T1 (Risky): file write commands ────────────────────────
    if (FILE_WRITE_PATTERNS.some((p) => p.test(trimmed))) {
      return {
        tier: 'T1',
        description: 'File write command',
      };
    }

    // ─── T0 (Safe): read-only commands ──────────────────────────
    return {
      tier: 'T0',
      description: 'Read-only command',
    };
  }

  /**
   * Classify a file operation (read_file, write_file, edit_file).
   * @param tool
   * @param filePath
   * @param isWrite
   */
  classifyFileOperation(
    tool: string,
    filePath: string,
    isWrite: boolean,
  ): ActionClassification {
    if (isWrite || tool === 'write_file' || tool === 'edit_file') {
      return {
        tier: 'T1',
        description: `File write: ${tool} on ${filePath}`,
      };
    }
    return {
      tier: 'T0',
      description: `File read: ${tool} on ${filePath}`,
    };
  }

  /**
   * Decide whether to allow, deny, or ask for an action.
   *
   * @param classification - The action classification.
   * @returns The approval decision.
   */
  decide(classification: ActionClassification): ApprovalDecision {
    // Always blocked
    if (classification.blocked) {
      return 'deny';
    }

    // God mode: allow everything (except blocked)
    if (this.godMode) {
      return 'allow';
    }

    // Check sandbox mode against tier
    const tierAllowed = this.isTierAllowed(classification.tier);
    if (!tierAllowed) {
      return 'deny';
    }

    // Auto mode: auto-approve T1 and T2 (Risky)
    if (this.autoMode && (classification.tier === 'T1' || classification.tier === 'T2')) {
      return 'allow';
    }

    // T3 (Destructive) always requires approval (unless god mode)
    if (classification.tier === 'T3') {
      if (this.approvalPolicy === 'never') {
        return 'deny';
      }
      return 'ask';
    }

    // Apply approval policy
    switch (this.approvalPolicy) {
      case 'never':
        // Never ask — allow if tier is allowed
        return 'allow';
      case 'on-failure':
        // Allow first, ask only on failure (handled by caller)
        return 'allow';
      case 'on-request':
        // T0 always allowed; T1+ requires asking
        if (classification.tier === 'T0') {
          return 'allow';
        }
        return 'ask';
      default:
        return 'ask';
    }
  }

  /**
   * Check if a permission tier is allowed by the current sandbox mode.
   * @param tier
   */
  private isTierAllowed(tier: PermissionTier): boolean {
    switch (this.sandboxMode) {
      case 'read-only':
        return tier === 'T0';
      case 'workspace-write':
        return tier === 'T0' || tier === 'T1' || tier === 'T2';
      case 'danger-full-access':
        return tier !== 'BLK';
      default:
        return false;
    }
  }

  /**
   * Create an approval request for the TUI's PermissionDialog.
   * @param classification
   * @param tool
   * @param action
   */
  createApprovalRequest(
    classification: ActionClassification,
    tool: string,
    action: string,
  ): ApprovalRequest {
    return {
      id: randomUUID(),
      action,
      tier: classification.tier,
      sandboxMode: this.sandboxMode,
      description: classification.description,
      tool,
      timestamp: new Date().toISOString(),
    };
  }
}

// ─── Pattern definitions ─────────────────────────────────────────────

/** Always-blocked dangerous patterns (BLK tier). */
const DENYLIST_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /rm\s+-rf\s+\//, reason: 'rm -rf / — would delete entire filesystem' },
  { pattern: /rm\s+-rf\s+\*/, reason: 'rm -rf * — would delete workspace' },
  { pattern: /mkfs/, reason: 'mkfs — would format a filesystem' },
  { pattern: /dd\s+if=\/dev\/zero/, reason: 'dd if=/dev/zero — would overwrite disk' },
  { pattern: /:\(\)\s*\{.*\};:/, reason: 'fork bomb' },
  { pattern: />\s*\/dev\/sd[a-z]/, reason: 'write to raw disk device' },
  { pattern: /curl\s+.*\|\s*(bash|sh|zsh)/, reason: 'curl | bash — remote code execution' },
  { pattern: /wget\s+.*\|\s*(bash|sh|zsh)/, reason: 'wget | bash — remote code execution' },
  { pattern: /DROP\s+TABLE/i, reason: 'SQL DROP TABLE' },
  { pattern: /DELETE\s+FROM/i, reason: 'SQL DELETE FROM' },
  { pattern: /TRUNCATE\s+TABLE/i, reason: 'SQL TRUNCATE TABLE' },
  { pattern: /chmod\s+-R\s+777\s+\//, reason: 'chmod -R 777 / — security hole' },
  { pattern: /shutdown|reboot|halt/, reason: 'system shutdown/reboot' },
];

/** T3 (Destructive): network access patterns. */
const NETWORK_PATTERNS: RegExp[] = [
  /^curl\s/,
  /^wget\s/,
  /^npm\s+publish/,
  /^npm\s+install\s+(-g|--global)/,
  /^git\s+push/,
  /^git\s+clone/,
  /^scp\s/,
  /^rsync\s.*@/,
  /^ssh\s/,
  /^nc\s/,
  /^python.*requests\./,
];

/** T2 (Risky): state-modifying patterns. */
const RISKY_PATTERNS: RegExp[] = [
  /^rm\s/,
  /^mv\s/,
  /^mkdir\s/,
  /^rmdir\s/,
  /^chmod\s/,
  /^chown\s/,
  /^git\s+commit/,
  /^git\s+checkout/,
  /^git\s+merge/,
  /^git\s+rebase/,
  /^git\s+reset/,
  /^git\s+clean/,
  /^npm\s+install/,
  /^npm\s+uninstall/,
  /^npm\s+run\s+build/,
  /^npx\s+(?!vitest)/,
  /^pip\s+install/,
  /^cargo\s+build/,
  /^make\s/,
  /^tsc\s/,
];

/** T1 (Risky): file-write patterns (rarely used for shell — mostly for tool classification). */
const FILE_WRITE_PATTERNS: RegExp[] = [
  /^tee\s/,
  /^>\s/,
  /^>>\s/,
];
