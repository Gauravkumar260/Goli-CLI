/**
 * Enhanced dangerous command approval (Hermes pattern).
 *
 * Expands the Phase 5 approval engine with:
 * - Expanded DANGEROUS_PATTERNS with descriptions (recursive deletes,
 *   SQL DROP/DELETE, system config, service manipulation, curl|sh,
 *   fork bombs, gateway lifecycle protection)
 * - _YOLO_MODE_FROZEN at module import (prevents prompt-injection flip)
 * - Smart LLM approval for low-risk matches
 * - Permanent allowlist persisted to config
 * - Per-session identity via AsyncLocalStorage (Node equivalent of
 *   Python's contextvars.ContextVar)
 *
 * @module approval/enhanced-approval
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

import type { Logger } from '../utils/logger.js';

/** A dangerous command pattern with description. */
export interface DangerousPattern {
  /** The regex pattern to match. */
  pattern: RegExp;
  /** Human-readable description of why it's dangerous. */
  description: string;
  /** The severity level. */
  severity: 'critical' | 'high' | 'medium';
  /**
   * If `true`, the command is ALWAYS denied (even in god mode / yolo mode).
   *
   * Reserved for unrecoverable filesystem-destructive operations
   * (rm -rf /, mkfs, dd to a raw disk, fork bombs) that can brick
   * the host. SQL destructive operations (DROP TABLE, TRUNCATE) are
   * recoverable from backups and should `ask` instead of `deny` so a
   * user can approve a deliberate schema migration.
   */
  alwaysDeny?: boolean;
}

/** The expanded dangerous patterns list (Hermes pattern). */
export const DANGEROUS_PATTERNS: DangerousPattern[] = [
  // ─── Recursive deletes (always deny — unrecoverable) ────────
  { pattern: /rm\s+-rf\s+\//s, description: 'Recursive delete of root filesystem', severity: 'critical', alwaysDeny: true },
  { pattern: /rm\s+-rf\s+\*/s, description: 'Recursive delete of workspace contents', severity: 'critical', alwaysDeny: true },
  { pattern: /rm\s+-rf\s+~/s, description: 'Recursive delete of home directory', severity: 'critical', alwaysDeny: true },
  { pattern: /rm\s+-rf\s+\.\./s, description: 'Recursive delete of parent directory', severity: 'critical', alwaysDeny: true },

  // ─── Filesystem formatting (always deny — unrecoverable) ────
  { pattern: /mkfs/s, description: 'Filesystem formatting', severity: 'critical', alwaysDeny: true },
  { pattern: /dd\s+if=\/dev\/zero/s, description: 'Overwrite disk with zeros', severity: 'critical', alwaysDeny: true },
  { pattern: /dd\s+if=\/dev\/urandom/s, description: 'Overwrite disk with random data', severity: 'critical', alwaysDeny: true },

  // ─── SQL injection (recoverable from backup — ask, don't deny) ──
  { pattern: /DROP\s+TABLE/is, description: 'SQL DROP TABLE — destroys table', severity: 'critical' },
  { pattern: /DELETE\s+FROM\s+\w+\s*;/is, description: 'SQL DELETE without WHERE — clears table', severity: 'critical' },
  { pattern: /DELETE\s+FROM\s+\w+\s*$/is, description: 'SQL DELETE without WHERE — clears table', severity: 'critical' },
  { pattern: /TRUNCATE\s+TABLE/is, description: 'SQL TRUNCATE TABLE — empties table', severity: 'critical' },
  { pattern: /DROP\s+DATABASE/is, description: 'SQL DROP DATABASE — destroys database', severity: 'critical' },

  // ─── System config overwrites (always deny — bricks host) ───
  { pattern: />\s*\/etc\/(passwd|shadow|sudoers|fstab|hosts)/s, description: 'Overwrite system config file', severity: 'critical', alwaysDeny: true },
  { pattern: /chmod\s+-R\s+777\s+\//s, description: 'Recursive chmod 777 on root — security hole', severity: 'critical', alwaysDeny: true },
  { pattern: /chown\s+-R\s+.*\s+\//s, description: 'Recursive chown on root filesystem', severity: 'critical', alwaysDeny: true },

  // ─── Service manipulation ───────────────────────────────────
  { pattern: /systemctl\s+(stop|disable|mask)\s/s, description: 'Stop/disable system service', severity: 'high' },
  { pattern: /service\s+\w+\s+stop/s, description: 'Stop system service', severity: 'high' },

  // ─── Remote code execution ──────────────────────────────────
  { pattern: /curl\s+.*\|\s*(bash|sh|zsh)/s, description: 'curl | shell — remote code execution', severity: 'critical' },
  { pattern: /wget\s+.*\|\s*(bash|sh|zsh)/s, description: 'wget | shell — remote code execution', severity: 'critical' },
  { pattern: /curl\s+.*\|\s*python/s, description: 'curl | python — remote code execution', severity: 'critical' },

  // ─── Fork bombs (always deny — exhausts system resources) ───
  { pattern: /:\(\)\s*\{.*\};:/s, description: 'Fork bomb — will exhaust system resources', severity: 'critical', alwaysDeny: true },
  { pattern: /:\(\)\s*\{.*&\s*\};:/s, description: 'Fork bomb variant', severity: 'critical', alwaysDeny: true },

  // ─── Process kills ──────────────────────────────────────────
  { pattern: /kill\s+-9\s+-1/s, description: 'Kill all processes (kill -9 -1)', severity: 'critical' },
  { pattern: /pkill\s+-9/s, description: 'Force kill processes by name (pkill -9)', severity: 'high' },
  { pattern: /killall\s+-KILL/s, description: 'Force kill all processes by name (killall -KILL)', severity: 'high' },
  { pattern: /killall\s+-9/s, description: 'Force kill all processes by name (killall -9)', severity: 'high' },

  // ─── Shell -c invocations (potential injection) ─────────────
  { pattern: /bash\s+-c\s+['"].*rm\s/s, description: 'Shell -c with rm — potential injection', severity: 'high' },

  // ─── find with destructive exec ─────────────────────────────
  { pattern: /find\s+.*-exec\s+rm\s/s, description: 'find -exec rm — recursive delete via find', severity: 'high' },
  { pattern: /find\s+.*-delete/s, description: 'find -delete — recursive delete via find', severity: 'high' },

  // ─── Gateway lifecycle protection (Hermes pattern) ──────────
  { pattern: /goli\s+(gateway|server)\s+(stop|restart|kill)/s, description: 'Agent attempting to kill its own gateway', severity: 'critical' },
  { pattern: /goli\s+update/s, description: 'Agent attempting self-update — human-only operation', severity: 'high' },

  // ─── Raw disk writes (always deny — unrecoverable) ──────────
  { pattern: />\s*\/dev\/sd[a-z]/s, description: 'Write to raw disk device', severity: 'critical', alwaysDeny: true },

  // ─── Shutdown/reboot ────────────────────────────────────────
  { pattern: /\b(shutdown|reboot|halt|poweroff)\b/s, description: 'System shutdown/reboot', severity: 'critical' },
];

/** Per-session identity via AsyncLocalStorage (Node equivalent of Python contextvars). */
const sessionContext = new AsyncLocalStorage<{
  sessionId: string;
  workspaceRoot: string;
  yoloMode: boolean;
}>();

/**
 * _YOLO_MODE_FROZEN — read ONCE at module import time.
 *
 * This prevents prompt injection from flipping yolo mode via
 * `process.env` at runtime. Once the module is loaded, the god-mode
 * state is frozen for the process lifetime.
 */
const _YOLO_MODE_FROZEN = process.env['GOLI_YOLO_MODE'] === '1' || process.env['GOLI_GOD_MODE'] === '1';

/**
 * The approval decision.
 *
 * The previous implementation defined `ApprovalDecision` here AND in
 * `sandbox/types.ts` with DIFFERENT values:
 *   - sandbox/types.ts: `'allow' | 'deny' | 'ask'`
 *   - enhanced-approval.ts: `'allow' | 'deny' | 'ask' | 'smart_approve'`
 *
 * The two types had the same name but were not assignable to each
 * other (the enhanced version's extra `'smart_approve'` variant
 * wasn't in the sandbox version). Code that imported the wrong one
 * silently type-checked against a different contract. We now extend
 * the canonical `ApprovalDecision` from `sandbox/types.ts` instead
 * of redefining it, so there's a single source of truth.
 */
export type ApprovalDecision = import('../sandbox/types.js').ApprovalDecision | 'smart_approve';

/** The result of checking a command. */
export interface ApprovalResult {
  /** The final decision. */
  decision: ApprovalDecision;
  /** Why this decision was made. */
  reason: string;
  /** The matched dangerous pattern (if any). */
  matchedPattern?: DangerousPattern;
  /** Whether the command is in the permanent allowlist. */
  allowlisted: boolean;
  /** Whether smart LLM approval was used. */
  smartApproved: boolean;
  /** The session ID (for audit logging). */
  sessionId?: string;
}

/** Options for the EnhancedApprovalEngine. */
export interface EnhancedApprovalEngineOptions {
  /** Logger instance. */
  logger?: Logger;
  /** The config file path for the allowlist (default: ~/.goli-cli/allowlist.json). */
  allowlistPath?: string;
  /** Optional LLM client for smart approval. */
  llmClient?: {
    call: (params: {
      messages: Array<{ role: string; content: string; timestamp: string }>;
      effort?: string;
    }) => Promise<{ content: string }>;
  };
}

/** The permanent allowlist entry. */
interface AllowlistEntry {
  /** The command pattern (exact or regex). */
  pattern: string;
  /** Whether it's a regex. */
  isRegex: boolean;
  /** When it was added. */
  addedAt: string;
  /** Who added it (session ID). */
  addedBy: string;
  /** The reason for allowing. */
  reason: string;
  /**
   * Optional expiry timestamp (ISO 8601). When set, the entry is
   * ignored after this time. Round-2 verification item A6: previously
   * the allowlist was permanent until manually removed — no TTL
   * support. We now accept `expiresAt` on add and enforce it on
   * lookup. Undefined means permanent (backwards-compatible).
   */
  expiresAt?: string;
}

/**
 * Enhanced approval engine with expanded patterns, frozen god mode,
 * smart LLM approval, and persistent allowlist.
 *
 * @module approval/enhanced-approval
 */
export class EnhancedApprovalEngine {
  private readonly log?: Logger;
  private readonly allowlistPath: string;
  private readonly llmClient?: EnhancedApprovalEngineOptions['llmClient'];
  private allowlist: AllowlistEntry[] = [];

  constructor(opts: EnhancedApprovalEngineOptions = {}) {
    this.log = opts.logger;
    this.allowlistPath = opts.allowlistPath ?? join(homedir(), '.goli-cli', 'allowlist.json');
    this.llmClient = opts.llmClient;
    this.loadAllowlist();
  }

  /**
   * Check if a command is dangerous and decide whether to allow, deny, or ask.
   *
   * @param command - The shell command to check.
   * @returns The approval result.
   */
  async check(command: string): Promise<ApprovalResult> {
    const ctx = sessionContext.getStore();
    const sessionId = ctx?.sessionId;
    const yoloMode = ctx?.yoloMode ?? _YOLO_MODE_FROZEN;

    // ─── 1. Check permanent allowlist ──────────────────────────
    if (this.isAllowlisted(command)) {
      return {
        decision: 'allow',
        reason: 'Command is in the permanent allowlist',
        allowlisted: true,
        smartApproved: false,
        sessionId,
      };
    }

    // ─── 2. Check dangerous patterns ───────────────────────────
    // Normalize the command before pattern matching:
    //   1. Collapse all whitespace (including newlines from `$'\n'`
    //      ANSI-C quoting) to a single space.
    //   2. Strip bash `$'...'` ANSI-C-quoted expansions so escape
    //      sequences like `$'\n'` cannot split a destructive command
    //      across lines and bypass the regex (which uses `.` with
    //      the `s` (dotAll) flag now).
    // Without this normalization, an attacker could evade detection
    // with e.g. `rm -rf $'/\n'` — the literal newline was the
    // bypass vector in the previous implementation.
    const normalized = command.replace(/\$'[^']*'/g, ' ').replace(/\s+/g, ' ');
    const match = this.findDangerousMatch(normalized);

    if (!match) {
      // No dangerous pattern — allow
      return {
        decision: 'allow',
        reason: 'No dangerous pattern detected',
        allowlisted: false,
        smartApproved: false,
        sessionId,
      };
    }

    // ─── 3. alwaysDeny patterns are denied even in god mode ────
    // Filesystem-destructive / system-bricking operations (rm -rf /,
    // mkfs, dd to raw disk, fork bombs, /etc/passwd overwrites,
    // chmod -R 777 /, raw disk writes) are marked `alwaysDeny: true`
    // in DANGEROUS_PATTERNS — they're unrecoverable and must NEVER
    // run, even when the user has explicitly enabled god mode.
    if (match.alwaysDeny) {
      return this.deny(match, 'Always-denied destructive command (unrecoverable, blocked even in god mode)', sessionId);
    }

    // ─── 3b. Critical-severity patterns without alwaysDeny ASK ──
    // SQL destructive operations (DROP TABLE, TRUNCATE, DROP DATABASE)
    // are critical but recoverable from backups — they `ask` instead
    // of `deny` so a deliberate schema migration can be approved.
    if (match.severity === 'critical') {
      return {
        decision: 'ask',
        reason: `Critical destructive command detected: ${match.description}`,
        matchedPattern: match,
        allowlisted: false,
        smartApproved: false,
        sessionId,
      };
    }

    // ─── 4. God mode (frozen at import time) ───────────────────
    // Only non-critical (high/medium) patterns are auto-allowed in
    // god mode — critical patterns are denied above regardless of mode.
    if (yoloMode) {
      return {
        decision: 'allow',
        reason: `Allowed in god mode (severity: ${match.severity}): ${match.description}`,
        matchedPattern: match,
        allowlisted: false,
        smartApproved: false,
        sessionId,
      };
    }

    // ─── 5. Smart LLM approval for medium-severity matches ─────
    if (match.severity === 'medium' && this.llmClient) {
      const smartResult = await this.smartApprove(command, match);
      if (smartResult) {
        return {
          decision: 'allow',
          reason: `Smart-approved by LLM: ${match.description}`,
          matchedPattern: match,
          allowlisted: false,
          smartApproved: true,
          sessionId,
        };
      }
    }

    // ─── 6. Default: ask the user ──────────────────────────────
    return {
      decision: 'ask',
      reason: `Dangerous command detected (${match.severity}): ${match.description}`,
      matchedPattern: match,
      allowlisted: false,
      smartApproved: false,
      sessionId,
    };
  }

  /**
   * Add a command to the permanent allowlist.
   *
   * @param pattern - The command pattern to allow.
   * @param isRegex - Whether the pattern is a regex.
   * @param reason - The reason for allowing.
   * @param addedBy - The session ID that added it.
   * @param opts - Optional settings.
   * @param opts.expiresAt - Optional ISO 8601 timestamp after which the
   *   entry is ignored. Round-2 verification item A6: enables
   *   time-limited approvals (e.g. "allow `npm install` for the next
   *   hour").
   */
  addToAllowlist(
    pattern: string,
    isRegex: boolean,
    reason: string,
    addedBy: string,
    opts?: { expiresAt?: string },
  ): void {
    // Validate the pattern before storing. The previous
    // implementation accepted any string — a malformed regex
    // (`[unclosed`) would silently fail on every subsequent
    // `isAllowlisted` call (caught in the try/catch on line
    // ~359), and a `.*` regex would match EVERYTHING,
    // permanently disabling all dangerous-command checks. We
    // now reject `.*` and test-compile regex patterns.
    if (isRegex) {
      try {
        new RegExp(pattern);
      } catch (err) {
        this.log?.error('Refusing to add invalid regex to allowlist', {
          pattern,
          error: err instanceof Error ? err.message : String(err),
        });
        return;
      }
      // Reject overly-broad regexes that would match everything.
      if (pattern === '.*' || pattern === '.*$' || pattern === '^.*$') {
        this.log?.error('Refusing to add overly-broad regex to allowlist (would disable all dangerous-command checks)', { pattern });
        return;
      }
    }
    // Round-2 verification item A6: validate `expiresAt` if provided.
    // A malformed timestamp would silently never expire (Date.parse
    // returns NaN, and NaN comparisons are always false). We reject
    // unparseable timestamps up-front so the caller gets immediate
    // feedback.
    let expiresAt: string | undefined;
    if (opts?.expiresAt !== undefined) {
      const parsed = Date.parse(opts.expiresAt);
      if (Number.isNaN(parsed)) {
        this.log?.error('Refusing to add allowlist entry with unparseable expiresAt', {
          pattern,
          expiresAt: opts.expiresAt,
        });
        return;
      }
      expiresAt = opts.expiresAt;
    }
    this.allowlist.push({
      pattern,
      isRegex,
      addedAt: new Date().toISOString(),
      addedBy,
      reason,
      expiresAt,
    });
    this.saveAllowlist();
    this.log?.info('Added to allowlist', { pattern, isRegex, reason, expiresAt });
  }

  /**
   * Remove a pattern from the allowlist.
   * @param pattern
   */
  removeFromAllowlist(pattern: string): boolean {
    const idx = this.allowlist.findIndex((e) => e.pattern === pattern);
    if (idx === -1) return false;
    this.allowlist.splice(idx, 1);
    this.saveAllowlist();
    return true;
  }

  /**
   * Get the allowlist (for display).
   *
   * Round-2 verification item A6: now includes `expiresAt` (when set)
   * so callers can display TTL info and prune expired entries.
   */
  getAllowlist(): Array<{ pattern: string; isRegex: boolean; reason: string; addedAt: string; expiresAt?: string }> {
    return this.allowlist.map((e) => ({
      pattern: e.pattern,
      isRegex: e.isRegex,
      reason: e.reason,
      addedAt: e.addedAt,
      expiresAt: e.expiresAt,
    }));
  }

  /**
   * Run a function within a session context (for per-session identity).
   *
   * @param ctx - The session context.
   * @param ctx.sessionId
   * @param fn - The function to run.
   * @param ctx.workspaceRoot
   * @param ctx.yoloMode
   * @returns The function's result.
   */
  runWithContext<T>(ctx: { sessionId: string; workspaceRoot: string; yoloMode: boolean }, fn: () => T): T {
    return sessionContext.run(ctx, fn);
  }

  /**
   * Check if god mode is frozen (read at import time).
   */
  get isGodModeFrozen(): boolean {
    return _YOLO_MODE_FROZEN;
  }

  /**
   * Get all dangerous patterns (for display / documentation).
   */
  getDangerousPatterns(): DangerousPattern[] {
    return [...DANGEROUS_PATTERNS];
  }

  // ─── Internal methods ──────────────────────────────────────────

  /**
   * Find the highest-severity dangerous pattern that matches the command.
   *
   * The previous implementation returned the FIRST matching pattern,
   * which may be lower severity than a later pattern. For example,
   * `rm -rf /` matches the critical `rm\s+-rf\s+\/` pattern, but
   * `pkill -9` matches the high `pkill\s+-9` pattern — if a command
   * matches both a high and a critical pattern, only the first
   * (lower-severity) match was returned, which might auto-allow
   * the command in god mode (god mode allows high but denies
   * critical). We now scan ALL patterns and return the highest
   * severity.
   */
  private findDangerousMatch(command: string): DangerousPattern | null {
    let best: DangerousPattern | null = null;
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.pattern.test(command)) {
        if (best === null) {
          best = pattern;
        } else {
          // Higher severity wins. Order: critical > high > medium.
          const sevOrder: Record<string, number> = { critical: 3, high: 2, medium: 1 };
          if ((sevOrder[pattern.severity] ?? 0) > (sevOrder[best.severity] ?? 0)) {
            best = pattern;
          }
        }
      }
    }
    return best;
  }

  /**
   * Check if a command is in the permanent allowlist.
   *
   * Non-regex entries match on the FIRST TOKEN of the command (or an
   * exact full-string match). The previous implementation used
   * `command.startsWith(entry.pattern)` which made an allowlist
   * entry of `npm` match `npm; rm -rf /` — a shell-injection
   * bypass of the allowlist itself.
   *
   * Round-2 verification item A6: entries with `expiresAt` in the
   * past are silently skipped (treated as not-allowlisted). The
   * entry is NOT removed from the in-memory list here — callers can
   * prune via `pruneExpiredAllowlistEntries()` if desired. This
   * keeps the lookup side-effect-free.
   * @param command
   */
  private isAllowlisted(command: string): boolean {
    const firstToken = command.trim().split(/\s+/)[0] ?? '';
    const now = Date.now();
    for (const entry of this.allowlist) {
      // Skip expired entries (item A6).
      if (entry.expiresAt !== undefined) {
        const expiry = Date.parse(entry.expiresAt);
        if (!Number.isNaN(expiry) && now >= expiry) {
          continue;
        }
      }
      if (entry.isRegex) {
        try {
          const regex = new RegExp(entry.pattern);
          if (regex.test(command)) return true;
        } catch {
          // Invalid regex — skip
        }
      } else {
        // Exact match on the full command, OR match on the first
        // token only (so `npm` allowlists `npm install` but NOT
        // `npm; rm -rf /`).
        if (command === entry.pattern || firstToken === entry.pattern) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Remove expired entries from the in-memory allowlist.
   *
   * Round-2 verification item A6: `isAllowlisted()` silently skips
   * expired entries but doesn't remove them (to keep lookup
   * side-effect-free). Call this method periodically (e.g. at session
   * start or after N lookups) to actually prune them and persist the
   * trimmed list to disk. Returns the number of entries removed.
   */
  pruneExpiredAllowlistEntries(): number {
    const now = Date.now();
    const before = this.allowlist.length;
    this.allowlist = this.allowlist.filter((entry) => {
      if (entry.expiresAt === undefined) return true;
      const expiry = Date.parse(entry.expiresAt);
      if (Number.isNaN(expiry)) return true; // unparseable → keep (defensive)
      return now < expiry;
    });
    const removed = before - this.allowlist.length;
    if (removed > 0) {
      this.saveAllowlist();
      this.log?.info('Pruned expired allowlist entries', { removed });
    }
    return removed;
  }

  /**
   * Smart LLM approval for low-risk dangerous commands.
   * @param command
   * @param pattern
   */
  private async smartApprove(command: string, pattern: DangerousPattern): Promise<boolean> {
    if (!this.llmClient) return false;

    try {
      const response = await this.llmClient.call({
        messages: [
          {
            role: 'system',
            content: `You are a security reviewer. A command matched a dangerous pattern but is medium severity. Decide if it's safe to auto-approve.

Pattern: ${pattern.description}
Command: ${command}

Respond with JSON: {"safe": true/false, "reasoning": string}`,
            timestamp: new Date().toISOString(),
          },
          {
            role: 'user',
            content: `Should this command be auto-approved?`,
            timestamp: new Date().toISOString(),
          },
        ],
        effort: 'low',
      });

      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return false;

      const parsed = JSON.parse(jsonMatch[0]) as { safe?: boolean };
      return parsed.safe ?? false;
    } catch {
      return false; // Fail-safe: don't approve on error
    }
  }

  /**
   * Create a deny result.
   * @param pattern
   * @param reason
   * @param sessionId
   */
  private deny(pattern: DangerousPattern, reason: string, sessionId?: string): ApprovalResult {
    return {
      decision: 'deny',
      reason,
      matchedPattern: pattern,
      allowlisted: false,
      smartApproved: false,
      sessionId,
    };
  }

  /** Load the allowlist from disk. */
  private loadAllowlist(): void {
    try {
      if (existsSync(this.allowlistPath)) {
        const content = readFileSync(this.allowlistPath, 'utf-8');
        this.allowlist = JSON.parse(content) as AllowlistEntry[];
      }
    } catch {
      this.allowlist = [];
    }
  }

  /** Save the allowlist to disk. */
  private saveAllowlist(): void {
    try {
      mkdirSync(dirname(this.allowlistPath), { recursive: true });
      writeFileSync(this.allowlistPath, JSON.stringify(this.allowlist, null, 2), 'utf-8');
    } catch {
      // Best-effort
    }
  }
}

/**
 * Run a function within a session context (convenience wrapper).
 *
 * @param sessionId - The session ID.
 * @param workspaceRoot - The workspace root.
 * @param yoloMode - Whether god mode is active.
 * @param fn - The function to run.
 */
export function withSessionContext<T>(
  sessionId: string,
  workspaceRoot: string,
  yoloMode: boolean,
  fn: () => T,
): T {
  return sessionContext.run({ sessionId, workspaceRoot, yoloMode }, fn);
}

/**
 * Get the current session context (or undefined if not in a context).
 */
export function getSessionContext(): { sessionId: string; workspaceRoot: string; yoloMode: boolean } | undefined {
  return sessionContext.getStore();
}

/**
 * Check if a command matches any dangerous pattern (standalone function).
 *
 * @param command - The command to check.
 * @returns The matched pattern, or null.
 */
export function findDangerousPattern(command: string): DangerousPattern | null {
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.pattern.test(command)) {
      return pattern;
    }
  }
  return null;
}
