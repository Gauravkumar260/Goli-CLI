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
}

/** The expanded dangerous patterns list (Hermes pattern). */
export const DANGEROUS_PATTERNS: DangerousPattern[] = [
  // ─── Recursive deletes ──────────────────────────────────────
  { pattern: /rm\s+-rf\s+\//, description: 'Recursive delete of root filesystem', severity: 'critical' },
  { pattern: /rm\s+-rf\s+\*/, description: 'Recursive delete of workspace contents', severity: 'critical' },
  { pattern: /rm\s+-rf\s+~/, description: 'Recursive delete of home directory', severity: 'critical' },
  { pattern: /rm\s+-rf\s+\.\./, description: 'Recursive delete of parent directory', severity: 'critical' },

  // ─── Filesystem formatting ──────────────────────────────────
  { pattern: /mkfs/, description: 'Filesystem formatting', severity: 'critical' },
  { pattern: /dd\s+if=\/dev\/zero/, description: 'Overwrite disk with zeros', severity: 'critical' },
  { pattern: /dd\s+if=\/dev\/urandom/, description: 'Overwrite disk with random data', severity: 'critical' },

  // ─── SQL injection ──────────────────────────────────────────
  { pattern: /DROP\s+TABLE/i, description: 'SQL DROP TABLE — destroys table', severity: 'critical' },
  { pattern: /DELETE\s+FROM\s+\w+\s*;/i, description: 'SQL DELETE without WHERE — clears table', severity: 'critical' },
  { pattern: /DELETE\s+FROM\s+\w+\s*$/i, description: 'SQL DELETE without WHERE — clears table', severity: 'critical' },
  { pattern: /TRUNCATE\s+TABLE/i, description: 'SQL TRUNCATE TABLE — empties table', severity: 'critical' },
  { pattern: /DROP\s+DATABASE/i, description: 'SQL DROP DATABASE — destroys database', severity: 'critical' },

  // ─── System config overwrites ───────────────────────────────
  { pattern: />\s*\/etc\/(passwd|shadow|sudoers|fstab|hosts)/, description: 'Overwrite system config file', severity: 'critical' },
  { pattern: /chmod\s+-R\s+777\s+\//, description: 'Recursive chmod 777 on root — security hole', severity: 'critical' },
  { pattern: /chown\s+-R\s+.*\s+\//, description: 'Recursive chown on root filesystem', severity: 'critical' },

  // ─── Service manipulation ───────────────────────────────────
  { pattern: /systemctl\s+(stop|disable|mask)\s/, description: 'Stop/disable system service', severity: 'high' },
  { pattern: /service\s+\w+\s+stop/, description: 'Stop system service', severity: 'high' },

  // ─── Remote code execution ──────────────────────────────────
  { pattern: /curl\s+.*\|\s*(bash|sh|zsh)/, description: 'curl | shell — remote code execution', severity: 'critical' },
  { pattern: /wget\s+.*\|\s*(bash|sh|zsh)/, description: 'wget | shell — remote code execution', severity: 'critical' },
  { pattern: /curl\s+.*\|\s*python/, description: 'curl | python — remote code execution', severity: 'critical' },

  // ─── Fork bombs ─────────────────────────────────────────────
  { pattern: /:\(\)\s*\{.*\};:/, description: 'Fork bomb — will exhaust system resources', severity: 'critical' },
  { pattern: /:\(\)\s*\{.*&\s*\};:/, description: 'Fork bomb variant', severity: 'critical' },

  // ─── Process kills ──────────────────────────────────────────
  { pattern: /kill\s+-9\s+-1/, description: 'Kill all processes (kill -9 -1)', severity: 'critical' },
  { pattern: /pkill\s+-9/, description: 'Force kill processes by name (pkill -9)', severity: 'high' },
  { pattern: /killall\s+-KILL/, description: 'Force kill all processes by name (killall -KILL)', severity: 'high' },
  { pattern: /killall\s+-9/, description: 'Force kill all processes by name (killall -9)', severity: 'high' },

  // ─── Shell -c invocations (potential injection) ─────────────
  { pattern: /bash\s+-c\s+['"].*rm\s/, description: 'Shell -c with rm — potential injection', severity: 'high' },

  // ─── find with destructive exec ─────────────────────────────
  { pattern: /find\s+.*-exec\s+rm\s/, description: 'find -exec rm — recursive delete via find', severity: 'high' },
  { pattern: /find\s+.*-delete/, description: 'find -delete — recursive delete via find', severity: 'high' },

  // ─── Gateway lifecycle protection (Hermes pattern) ──────────
  { pattern: /goli\s+(gateway|server)\s+(stop|restart|kill)/, description: 'Agent attempting to kill its own gateway', severity: 'critical' },
  { pattern: /goli\s+update/, description: 'Agent attempting self-update — human-only operation', severity: 'high' },

  // ─── Raw disk writes ────────────────────────────────────────
  { pattern: />\s*\/dev\/sd[a-z]/, description: 'Write to raw disk device', severity: 'critical' },

  // ─── Shutdown/reboot ────────────────────────────────────────
  { pattern: /\b(shutdown|reboot|halt|poweroff)\b/, description: 'System shutdown/reboot', severity: 'critical' },
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

/** The approval decision. */
export type ApprovalDecision = 'allow' | 'deny' | 'ask' | 'smart_approve';

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
  glmClient?: {
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
  private readonly glmClient?: EnhancedApprovalEngineOptions['glmClient'];
  private allowlist: AllowlistEntry[] = [];

  constructor(opts: EnhancedApprovalEngineOptions = {}) {
    this.log = opts.logger;
    this.allowlistPath = opts.allowlistPath ?? join(homedir(), '.goli-cli', 'allowlist.json');
    this.glmClient = opts.glmClient;
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
    const match = this.findDangerousMatch(command);

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

    // ─── 3. Critical patterns are always denied (even in god mode) ───
    if (match.severity === 'critical' && match.pattern.source.includes('rm\\s+-rf\\s+\\/' )) {
      // rm -rf / is ALWAYS denied
      return this.deny(match, 'Critical destructive command — always denied', sessionId);
    }

    // ─── 4. God mode (frozen at import time) ───────────────────
    if (yoloMode) {
      // In god mode, allow high/medium patterns but still deny critical
      if (match.severity !== 'critical') {
        return {
          decision: 'allow',
          reason: `Allowed in god mode (severity: ${match.severity}): ${match.description}`,
          matchedPattern: match,
          allowlisted: false,
          smartApproved: false,
          sessionId,
        };
      }
    }

    // ─── 5. Smart LLM approval for medium-severity matches ─────
    if (match.severity === 'medium' && this.glmClient) {
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
   */
  addToAllowlist(pattern: string, isRegex: boolean, reason: string, addedBy: string): void {
    this.allowlist.push({
      pattern,
      isRegex,
      addedAt: new Date().toISOString(),
      addedBy,
      reason,
    });
    this.saveAllowlist();
    this.log?.info('Added to allowlist', { pattern, isRegex, reason });
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
   */
  getAllowlist(): Array<{ pattern: string; isRegex: boolean; reason: string; addedAt: string }> {
    return this.allowlist.map((e) => ({
      pattern: e.pattern,
      isRegex: e.isRegex,
      reason: e.reason,
      addedAt: e.addedAt,
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
   * Find the first dangerous pattern that matches the command.
   * @param command
   */
  private findDangerousMatch(command: string): DangerousPattern | null {
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.pattern.test(command)) {
        return pattern;
      }
    }
    return null;
  }

  /**
   * Check if a command is in the permanent allowlist.
   * @param command
   */
  private isAllowlisted(command: string): boolean {
    for (const entry of this.allowlist) {
      if (entry.isRegex) {
        try {
          const regex = new RegExp(entry.pattern);
          if (regex.test(command)) return true;
        } catch {
          // Invalid regex — skip
        }
      } else {
        if (command === entry.pattern || command.startsWith(entry.pattern)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Smart LLM approval for low-risk dangerous commands.
   * @param command
   * @param pattern
   */
  private async smartApprove(command: string, pattern: DangerousPattern): Promise<boolean> {
    if (!this.glmClient) return false;

    try {
      const response = await this.glmClient.call({
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
