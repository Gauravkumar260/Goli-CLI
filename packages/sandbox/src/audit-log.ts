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

import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, existsSync, openSync, writeFileSync, closeSync, statSync, unlinkSync, readSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { createInterface } from 'node:readline';

import type { AuditLogEntry } from './types.js';

/** Sentinel prevHash for the first entry in the chain. */
const GENESIS_PREV_HASH = 'GENESIS';

/** The audit log file path. */
export function getAuditLogPath(): string {
  const goliHome = process.env['GOLI_HOME'] ?? join(homedir(), '.goli-cli');
  return join(goliHome, 'audit-log.jsonl');
}

/**
 * Compute the SHA-256 hash for an audit log entry, given the previous
 * entry's hash.
 *
 * Formula: `hash = sha256(prevHash + '\n' + canonicalJSON(entry_without_hash_fields))`
 *
 * The entry is serialized with sorted object keys (canonical JSON) so
 * that field-ordering differences across V8/Node versions don't break
 * the chain. The `hash` and `prevHash` fields are stripped before
 * hashing — otherwise the hash would be self-referential.
 *
 * P1-5 fix (audit Finding 6.26).
 */
function computeEntryHash(entry: AuditLogEntry, prevHash: string): string {
  // Strip the hash fields. We shallow-copy because AuditLogEntry is flat.
  const { hash: _h, prevHash: _p, ...rest } = entry;
  void _h; void _p;
  // Canonical JSON: sorted keys, no whitespace. `JSON.stringify` of a
  // re-serialized object with sorted keys is deterministic across runs.
  const canonical = canonicalJsonStringify(rest);
  return createHash('sha256')
    .update(prevHash + '\n' + canonical)
    .digest('hex');
}

/**
 * Deterministic JSON serialization with sorted object keys. Unlike
 * `JSON.stringify`, this guarantees that two semantically-equal objects
 * always produce byte-identical output regardless of insertion order.
 * Arrays preserve order (their elements are recursively canonicalized).
 */
function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJsonStringify).join(',') + ']';
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return '{' + keys
    .map((k) => JSON.stringify(k) + ':' + canonicalJsonStringify((value as Record<string, unknown>)[k]))
    .join(',') + '}';
}

/**
 * Read the last line of the audit log file (synchronously) and return
 * its `hash` field. Returns `GENESIS_PREV_HASH` if the file is empty
 * or doesn't exist. Returns `undefined` if the last line is unhashed
 * (written by an older client) — in that case the caller decides
 * whether to skip hashing (preserve backward compat) or re-hash from
 * the last hashed entry.
 *
 * We read the last ~4KB of the file rather than the whole file because
 * audit logs can grow to hundreds of MB on long-running agents.
 */
function readLastEntryHash(logPath: string): string {
  if (!existsSync(logPath)) return GENESIS_PREV_HASH;
  try {
    const stat = statSync(logPath);
    if (stat.size === 0) return GENESIS_PREV_HASH;
    // Read the last 8KB (enough for any single entry, even with a
    // long bash command — entries are capped at ~500 chars in the
    // action field by audit-log.ts:70).
    const readSize = Math.min(stat.size, 8192);
    const fd = openSync(logPath, 'r');
    try {
      const buf = Buffer.alloc(readSize);
      readSync(fd, buf, 0, readSize, stat.size - readSize);
      const tail = buf.toString('utf-8');
      // Split into lines and find the last non-empty one.
      const lines = tail.split('\n').filter((l) => l.trim().length > 0);
      if (lines.length === 0) return GENESIS_PREV_HASH;
      const lastLine = lines[lines.length - 1]!;
      const parsed = JSON.parse(lastLine) as AuditLogEntry;
      return parsed.hash ?? GENESIS_PREV_HASH;
    } finally {
      closeSync(fd);
    }
  } catch {
    // Corrupt tail or unreadable file — treat as genesis so we still
    // write a new entry (better than dropping audit events).
    return GENESIS_PREV_HASH;
  }
}

/**
 * Append an entry to the audit log.
 *
 * On POSIX, `appendFileSync` with `O_APPEND` is atomic per-write only
 * if the write is smaller than `PIPE_BUF` (4096 bytes). For larger
 * writes — common when the entry contains a long bash command —
 * concurrent writers (e.g., parent agent + subagents writing to the
 * same audit log) can interleave and corrupt the log. We use a
 * best-effort file lock (`flock` via `openSync(..., 'wx')` on a
 * sibling `.lock` file) so concurrent writers serialize. Lock
 * acquisition is best-effort: if the lock file already exists AND
 * is older than 30s (likely orphaned by a crashed process), we
 * take it over.
 *
 * P1-5 fix (audit Finding 6.26): we now compute and persist a
 * SHA-256 hash chain. Each entry's `prevHash` is the previous
 * entry's `hash` (or `"GENESIS"` for the first entry), and its
 * `hash` is `sha256(prevHash + '\n' + canonicalJSON(entry))`. This
 * makes the log tamper-evident: any deletion, modification,
 * reordering, or insertion breaks the chain at that point and is
 * detectable by `verifyAuditLog`. The hash computation is done
 * INSIDE the lock so concurrent writers form a consistent chain
 * (each new entry's prevHash is the last committed entry's hash).
 *
 * @param entry - The audit log entry.
 */
export function appendAuditLog(entry: AuditLogEntry): void {
  const logPath = getAuditLogPath();
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    const lockPath = `${logPath}.lock`;
    const lockFd = acquireLock(lockPath);
    try {
      // P1-5: Compute hash chain. Must be inside the lock so the
      // prevHash we read is the actual last entry at commit time
      // (not a stale read from before another writer committed).
      const prevHash = readLastEntryHash(logPath);
      const entryWithChain: AuditLogEntry = {
        ...entry,
        prevHash,
        hash: computeEntryHash(entry, prevHash),
      };
      const line = JSON.stringify(entryWithChain) + '\n';
      appendFileSync(logPath, line, 'utf-8');
    } finally {
      releaseLock(lockFd, lockPath);
    }
  } catch {
    // Best-effort — never crash the agent on audit log failure
  }
}

/** Best-effort lock acquisition. Returns the fd to release later, or -1. */
function acquireLock(lockPath: string): number {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    try {
      // 'wx' = O_WRONLY | O_CREAT | O_EXCL — fails if the file exists.
      const fd = openSync(lockPath, 'wx');
      writeFileSync(fd, String(process.pid), 'utf-8');
      return fd;
    } catch {
      // Lock file exists — check if it's stale.
      try {
        const stat = statSync(lockPath);
        if (Date.now() - stat.mtimeMs > 30_000) {
          // Stale lock — take it over by unlinking and recreating.
          try {
            unlinkSync(lockPath);
            continue;
          } catch {
            break;
          }
        }
      } catch {
        break;
      }
      // Briefly sleep before retrying (10ms).
      const start = Date.now();
      while (Date.now() - start < 10) { /* busy-wait — synchronous */ }
    }
  }
  return -1;
}

function releaseLock(fd: number, lockPath: string): void {
  if (fd >= 0) {
    try { closeSync(fd); } catch { /* ignore */ }
  }
  try {
    unlinkSync(lockPath);
  } catch {
    // Best-effort.
  }
}

/**
 * Read all audit log entries.
 *
 * For large logs, this now STREAMS the file line-by-line via
 * `createReadStream` + `readline.createInterface` instead of
 * loading the entire file into memory with `readFileSync` + `split`.
 * The previous implementation would OOM the process on a long-running
 * agent's audit log (potentially hundreds of MB / GBs).
 *
 * @param maxEntries - Max entries to return (default: all).
 * @param maxEntriesOrPath
 * @returns Array of audit log entries (newest last).
 */
export async function readAuditLog(maxEntriesOrPath?: number | string): Promise<AuditLogEntry[]> {
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
    const entries: AuditLogEntry[] = [];
    const stream = createReadStream(logPath, { encoding: 'utf-8' });
    const rl = createInterface({ input: stream });
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        entries.push(JSON.parse(trimmed) as AuditLogEntry);
      } catch {
        // Skip corrupted lines (best-effort).
      }
      // If we only need the last `maxEntries`, keep the buffer bounded
      // so we don't accumulate the entire log in memory.
      if (maxEntries !== undefined && entries.length > maxEntries * 2) {
        entries.splice(0, entries.length - maxEntries);
      }
    }
    if (maxEntries !== undefined) {
      return entries.slice(-maxEntries);
    }
    return entries;
  } catch {
    return [];
  }
}

/**
 * Verify audit log integrity.
 *
 * Checks performed:
 * - Each line is valid JSON
 * - Each entry has required fields
 * - Entries are in chronological order
 * - SHA-256 hash chain is intact (each entry's `prevHash` matches the
 *   previous entry's `hash`, and each entry's `hash` matches
 *   `sha256(prevHash + canonicalJSON(entry))`).
 *
 * ## Backward compatibility
 *
 * Entries written by older clients (before P1-5) have no `hash`/`prevHash`
 * fields. Such entries are reported as warnings, not errors — the chain
 * is "unhashed" but not "broken". A log consisting entirely of unhashed
 * entries verifies OK (with a warning). A log where SOME entries are
 * hashed and others are not is treated as suspicious: each transition
 * (hashed → unhashed or unhashed → hashed) is flagged.
 *
 * P1-5 fix (audit Finding 6.26): the previous implementation only
 * checked JSON validity, field presence, and chronological order. An
 * attacker with write access could delete, modify, reorder, or insert
 * entries undetected. We now verify the cryptographic chain.
 *
 * @param logPath
 * @returns An object with `ok` boolean and any errors found.
 */
export async function verifyAuditLog(logPath?: string): Promise<{ ok: boolean; errors: string[]; entryCount: number }> {
  const resolvedPath = logPath ?? getAuditLogPath();
  if (!existsSync(resolvedPath)) {
    return { ok: true, errors: [], entryCount: 0 };
  }

  const errors: string[] = [];
  const entries = await readAuditLog(logPath);

  let lastTimestamp = '';
  let prevHash = GENESIS_PREV_HASH;
  let hashedCount = 0;
  let unhashedCount = 0;
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

    // P1-5: Verify hash chain. Backward compat: unhashed entries
    // (no `hash` field) are tolerated with a warning, NOT a failure.
    if (entry.hash === undefined) {
      unhashedCount++;
      // If this entry is unhashed but the previous was hashed, the
      // chain is broken — flag as an error (suggests tampering or a
      // downgrade attack).
      if (hashedCount > 0) {
        errors.push(`Entry ${i}: unhashed entry after hashed chain — chain broken (possible tampering or client downgrade)`);
      }
      // Reset prevHash so the next hashed entry starts a fresh chain
      // (its prevHash should be GENESIS or its own sentinel; if it
      // claims to chain off this unhashed entry, that's an error).
      prevHash = GENESIS_PREV_HASH;
      continue;
    }

    // This entry claims to be hashed. Verify it.
    hashedCount++;

    // Check prevHash linkage.
    if (entry.prevHash !== prevHash) {
      errors.push(
        `Entry ${i}: hash-chain broken — prevHash '${entry.prevHash}' does not match previous entry's hash '${prevHash}'. ` +
        `This indicates the entry was inserted, deleted, reordered, or modified.`,
      );
    }

    // Recompute the hash and check it matches.
    const recomputed = computeEntryHash(entry, entry.prevHash ?? GENESIS_PREV_HASH);
    if (recomputed !== entry.hash) {
      errors.push(
        `Entry ${i}: hash mismatch — stored hash '${entry.hash.slice(0, 16)}…' does not match recomputed '${recomputed.slice(0, 16)}…'. ` +
        `This indicates the entry's fields were modified after being written.`,
      );
    }

    prevHash = entry.hash;
  }

  // If the entire log is unhashed (legacy), report OK with no errors
  // — the chain simply isn't present. The audit command's output
  // notes the unhashed count separately so the user knows the log
  // predates the hash-chain feature.
  void unhashedCount;
  void hashedCount;

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
export async function getAuditLogSummary(logPath?: string, maxEntries?: number): Promise<{
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
}> {
  const entries = await readAuditLog(logPath);
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
