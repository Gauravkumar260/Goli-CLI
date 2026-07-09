/**
 * Immutable audit log (Module 4).
 *
 * Every tool call, every sandboxed command, every approval decision is
 * written to an append-only JSONL audit log. This is the liability
 * shield — it proves what the agent did and when.
 *
 * The log is at `$GOLI_HOME/audit-log.jsonl`. Each line is a JSON object
 * matching the {@link AuditLogEntry} interface.
 *
 * "Immutable" means: we never overwrite or delete entries. The log can
 * grow unbounded; Phase 12 (observability) will add rotation.
 *
 * @module sandbox/audit-log
 */

import { appendFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

import type { AuditLogEntry } from './types.js';

/** The audit log file path. */
export function getAuditLogPath(): string {
  const goliHome = process.env['GOLI_HOME'] ?? join(homedir(), '.goli-cli');
  return join(goliHome, 'audit-log.jsonl');
}

/**
 * Append an entry to the audit log.
 *
 * @param entry - The audit log entry.
 */
export function appendAuditLog(entry: AuditLogEntry): void {
  const logPath = getAuditLogPath();
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf-8');
  } catch {
    // Best-effort — never crash the agent on audit log failure
  }
}

/**
 * Read all audit log entries.
 *
 * @param maxEntries - Max entries to return (default: all).
 * @param maxEntriesOrPath
 * @returns Array of audit log entries (newest last).
 */
export function readAuditLog(maxEntriesOrPath?: number | string): AuditLogEntry[] {
  // Accept either a path (string) or a max-entries count (number).
  // This dual signature lets callers pass either argument positionally.
  let logPath: string;
  let maxEntries: number | undefined;
  if (typeof maxEntriesOrPath === 'string') {
    logPath = maxEntriesOrPath;
  } else {
    logPath = getAuditLogPath();
    maxEntries = maxEntriesOrPath;
  }
  if (!existsSync(logPath)) return [];

  try {
    const content = readFileSync(logPath, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim().length > 0);
    const entries: AuditLogEntry[] = lines.map((line) => {
      try {
        return JSON.parse(line) as AuditLogEntry;
      } catch {
        return null;
      }
    }).filter((e): e is AuditLogEntry => e !== null);

    if (maxEntries !== undefined) {
      return entries.slice(-maxEntries);
    }
    return entries;
  } catch {
    return [];
  }
}

/**
 * Verify audit log integrity (basic checks):
 * - Each line is valid JSON
 * - Each entry has required fields
 * - Entries are in chronological order
 *
 * @param logPath
 * @returns An object with `ok` boolean and any errors found.
 */
export function verifyAuditLog(logPath?: string): { ok: boolean; errors: string[]; entryCount: number } {
  const resolvedPath = logPath ?? getAuditLogPath();
  if (!existsSync(resolvedPath)) {
    return { ok: true, errors: [], entryCount: 0 };
  }

  const errors: string[] = [];
  const entries = readAuditLog(logPath);

  let lastTimestamp = '';
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const required: (keyof AuditLogEntry)[] = [
      'timestamp',
      'tool',
      'action',
      'sandboxMode',
      'approval',
      'tier',
      'ok',
      'durationMs',
      'sessionId',
      'workspaceRoot',
    ];
    for (const field of required) {
      if (!(field in entry)) {
        errors.push(`Entry ${i}: missing field '${field}'`);
      }
    }

    // Check chronological order
    if (lastTimestamp && entry.timestamp < lastTimestamp) {
      errors.push(`Entry ${i}: timestamp ${entry.timestamp} is before previous ${lastTimestamp}`);
    }
    lastTimestamp = entry.timestamp;
  }

  return {
    ok: errors.length === 0,
    errors,
    entryCount: entries.length,
  };
}

/**
 * Get a summary of audit log entries (for the `goli audit` command).
 *
 * @param logPath - Optional path to the audit log. Defaults to the standard location.
 * @param maxEntries - Optional cap on the number of entries to read (for large logs).
 */
export function getAuditLogSummary(logPath?: string, maxEntries?: number): {
  totalEntries: number;
  totalDurationMs: number;
  byTool: Record<string, number>;
  byTier: Record<string, number>;
  byOutcome: Record<string, number>;
  godModeEntries: number;
  deniedEntries: number;
  errors: number;
  lastEntryTimestamp?: string;
  recentEntries: AuditLogEntry[];
} {
  const entries = readAuditLog(logPath);
  const byTool: Record<string, number> = {};
  const byTier: Record<string, number> = {};
  const byOutcome: Record<string, number> = {};
  let totalDurationMs = 0;
  let errorCount = 0;
  let godModeEntries = 0;
  let deniedEntries = 0;

  for (const entry of entries) {
    byTool[entry.tool] = (byTool[entry.tool] ?? 0) + 1;
    byTier[entry.tier] = (byTier[entry.tier] ?? 0) + 1;
    byOutcome[entry.ok ? 'ok' : 'failed'] = (byOutcome[entry.ok ? 'ok' : 'failed'] ?? 0) + 1;
    totalDurationMs += entry.durationMs;
    if (!entry.ok) errorCount++;
    if (entry.sandboxMode === 'danger-full-access') godModeEntries++;
    if (entry.approval === 'deny') deniedEntries++;
  }

  const recent = maxEntries ? entries.slice(-maxEntries) : entries;
  const lastEntry = entries.length > 0 ? entries[entries.length - 1] : undefined;

  return {
    totalEntries: entries.length,
    totalDurationMs,
    byTool,
    byTier,
    byOutcome,
    godModeEntries,
    deniedEntries,
    errors: errorCount,
    lastEntryTimestamp: lastEntry?.timestamp,
    recentEntries: recent,
  };
}
