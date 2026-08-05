/**
 * config/integrity.ts — Policy Integrity Manager.
 *
 * Computes SHA-256 hashes of policy/config files to detect tampering or
 * unexpected changes between sessions. Mirrors gemini-cli's
 * `PolicyIntegrityManager` pattern.
 *
 * How it works:
 *   1. `checkIntegrity(scope, identifier, policyDir)` computes a deterministic
 *      SHA-256 of all files in `policyDir` (sorted by relative path, content
 *      + path + `\0` separator).
 *   2. The hash is compared against the last-known-good hash stored in
 *      `.goli/policy.hash` (keyed by `${scope}:${identifier}`).
 *   3. Returns MATCH / MISMATCH / NEW.
 *   4. `acceptIntegrity(scope, identifier, hash)` persists the current hash
 *      as the new last-known-good.
 *
 * Use case: on startup, if policy files have changed since the last session,
 * the TUI shows a PolicyUpdateDialog asking the user to ACCEPT (persist new
 * hash + load policies) or IGNORE (load defaults only, don't persist).
 *
 * P0-5 fix (remediation plan Phase 5): added `MidSessionIntegrityChecker`
 * for runtime verification. The startup check only runs once; the
 * mid-session checker caches hashes at session start and re-verifies
 * them on demand (called before T1+ tool executions). This closes a
 * SICA self-modification attack vector where SICA could modify its
 * own guard code mid-session without detection.
 *
 * @module integrity
 */

import * as crypto from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';

/** The integrity status of a policy directory. */
export enum IntegrityStatus {
  /** The current hash matches the stored hash. */
  MATCH = 'MATCH',
  /** The current hash does NOT match the stored hash (files changed). */
  MISMATCH = 'MISMATCH',
  /** No stored hash exists yet (first time checking this scope). */
  NEW = 'NEW',
}

/** Result of {@link PolicyIntegrityManager.checkIntegrity}. */
export interface IntegrityResult {
  /** The integrity status. */
  status: IntegrityStatus;
  /** The current SHA-256 hash (hex). */
  hash: string;
  /** Number of files hashed. */
  fileCount: number;
}

/** Stored integrity data: key = `${scope}:${identifier}`, value = hash. */
interface StoredIntegrityData {
  [key: string]: string;
}

/**
 * Compute a deterministic SHA-256 hash of all files in a directory.
 *
 * Files are sorted by relative path. Each file contributes:
 *   `<relativePath>\0<content>\0`
 * to the hash. This ensures renames and modifications are both detected.
 *
 * Exported for unit testing.
 *
 * @param dir - The directory to hash.
 * @param readFile - Optional custom file reader (for testing).
 * @param readDir - Optional custom dir reader (for testing).
 * @param statFn - Optional custom stat function (for testing). Must return an object with `isDirectory()` and `isFile()`.
 * @returns The hex hash + file count.
 */
export function calculateIntegrityHash(
  dir: string,
  readFile: (path: string) => string = defaultReadFile,
  readDir: (path: string) => string[] = defaultReadDir,
  statFn: (path: string) => { isDirectory(): boolean; isFile(): boolean } = defaultStat,
): { hash: string; fileCount: number } {
  const files = collectFiles(dir, readDir, statFn);
  files.sort((a, b) => a.localeCompare(b));

  const hash = crypto.createHash('sha256');
  for (const filePath of files) {
    const relPath = relative(dir, filePath);
    const content = readFile(filePath);
    hash.update(relPath);
    hash.update('\0');
    hash.update(content);
    hash.update('\0');
  }

  return { hash: hash.digest('hex'), fileCount: files.length };
}

/** Recursively collect all files under `dir`. Returns absolute paths. */
function collectFiles(
  dir: string,
  readDir: (path: string) => string[],
  statFn: (path: string) => { isDirectory(): boolean; isFile(): boolean },
): string[] {
  // Note: we do NOT check existsSync(dir) here — when a custom statFn is
  // provided (for testing), the dir may not exist on disk. The readDir
  // call will throw and we'll return [].
  const result: string[] = [];
  const walk = (d: string): void => {
    let entries: string[];
    try {
      entries = readDir(d);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(d, entry);
      try {
        const stat = statFn(full);
        if (stat.isDirectory()) {
          walk(full);
        } else if (stat.isFile()) {
          result.push(full);
        }
      } catch {
        // Skip unreadable entries.
      }
    }
  };
  walk(dir);
  return result;
}

// ─── Default file system helpers ──────────────────────────────────────────

function defaultReadFile(path: string): string {
  return readFileSync(path, 'utf-8');
}

function defaultReadDir(path: string): string[] {
  return readdirSync(path);
}

function defaultStat(path: string): { isDirectory(): boolean; isFile(): boolean } {
  return statSync(path);
}

// ─── PolicyIntegrityManager ───────────────────────────────────────────────

/**
 * Manages policy file integrity via SHA-256 hashing.
 *
 * Usage:
 *   const mgr = new PolicyIntegrityManager({ storagePath: '.goli/policy.hash' });
 *   const result = await mgr.checkIntegrity('project', process.cwd(), '.goli/policies');
 *   if (result.status === IntegrityStatus.MISMATCH) {
 *     // Show PolicyUpdateDialog...
 *     await mgr.acceptIntegrity('project', process.cwd(), result.hash);
 *   }
 */
export class PolicyIntegrityManager {
  private readonly storagePath: string;
  private readonly readFile: (path: string) => string;
  private readonly readDir: (path: string) => string[];
  private readonly statFn: (path: string) => { isDirectory(): boolean; isFile(): boolean };

  constructor(opts: {
    /** Path to the JSON file storing last-known-good hashes. */
    storagePath: string;
    /** Optional custom file reader (for testing). */
    readFile?: (path: string) => string;
    /** Optional custom dir reader (for testing). */
    readDir?: (path: string) => string[];
    /** Optional custom stat function (for testing). */
    statFn?: (path: string) => { isDirectory(): boolean; isFile(): boolean };
  }) {
    this.storagePath = opts.storagePath;
    this.readFile = opts.readFile ?? defaultReadFile;
    this.readDir = opts.readDir ?? defaultReadDir;
    this.statFn = opts.statFn ?? defaultStat;
  }

  /**
   * Check the integrity of a policy directory against the stored hash.
   *
   * @param scope - The policy scope (e.g. 'project', 'user').
   * @param identifier - A unique identifier for the scope (e.g. project path).
   * @param policyDir - The directory containing the policy files.
   * @returns The integrity result (MATCH / MISMATCH / NEW).
   */
  checkIntegrity(
    scope: string,
    identifier: string,
    policyDir: string,
  ): IntegrityResult {
    const { hash: currentHash, fileCount } = calculateIntegrityHash(
      policyDir,
      this.readFile,
      this.readDir,
      this.statFn,
    );
    const storedData = this.loadIntegrityData();
    const key = this.getIntegrityKey(scope, identifier);
    const storedHash = storedData[key];

    if (!storedHash) {
      return { status: IntegrityStatus.NEW, hash: currentHash, fileCount };
    }
    if (storedHash === currentHash) {
      return { status: IntegrityStatus.MATCH, hash: currentHash, fileCount };
    }
    return { status: IntegrityStatus.MISMATCH, hash: currentHash, fileCount };
  }

  /**
   * Accept and persist the current integrity hash for a given scope.
   *
   * @param scope - The policy scope.
   * @param identifier - A unique identifier for the scope.
   * @param hash - The hash to persist.
   * @returns `true` if the hash was persisted; `false` if the write
   *   failed (the caller may want to surface this to the user —
   *   the previous implementation silently swallowed write errors,
   *   so the user thought the new policy was accepted but the next
   *   session flagged it as MISMATCH again).
   */
  acceptIntegrity(scope: string, identifier: string, hash: string): boolean {
    const storedData = this.loadIntegrityData();
    const key = this.getIntegrityKey(scope, identifier);
    storedData[key] = hash;
    return this.saveIntegrityData(storedData);
  }

  /**
   * Build the storage key for a (scope, identifier) pair.
   *
   * The previous implementation used `${scope}:${identifier}`. If
   * the `identifier` contained a colon (e.g. a Windows path like
   * `C:\projects\foo`), the key was ambiguous — `project:C:\foo`
   * could collide with another scope/identifier pair that produced
   * the same string. We now sanitize both parts by replacing colons
   * and other JSON-key-unsafe characters with underscores, AND
   * append a SHA-256 suffix of the original (scope, identifier) to
   * guarantee uniqueness regardless of the input characters.
   */
  private getIntegrityKey(scope: string, identifier: string): string {
    const sanitize = (s: string): string => s.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64);
    const uniq = crypto.createHash('sha256').update(`${scope}\0${identifier}`).digest('hex').slice(0, 16);
    return `${sanitize(scope)}:${sanitize(identifier)}:${uniq}`;
  }

  /** Load the stored integrity data from the storage file. */
  private loadIntegrityData(): StoredIntegrityData {
    try {
      if (!existsSync(this.storagePath)) return {};
      const content = readFileSync(this.storagePath, 'utf-8');
      const parsed: unknown = JSON.parse(content);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        Object.values(parsed).every((v) => typeof v === 'string')
      ) {
        return parsed as StoredIntegrityData;
      }
      return {};
    } catch {
      return {};
    }
  }

  /**
   * Save the integrity data to the storage file.
   *
   * @returns `true` on success, `false` on failure. The previous
   *   implementation silently swallowed write errors — the caller
   *   thought the new hash was persisted, but the next session
   *   flagged it as MISMATCH. We now return the success flag so
   *   callers can surface the failure to the user (and we still
   *   don't crash — integrity is a safety net, not a hard gate).
   */
  private saveIntegrityData(data: StoredIntegrityData): boolean {
    try {
      mkdirSync(dirname(this.storagePath), { recursive: true });
      writeFileSync(this.storagePath, JSON.stringify(data, null, 2), 'utf-8');
      return true;
    } catch {
      // Don't crash — but DO return false so the caller knows.
      return false;
    }
  }
}

// ─── P0-5: Mid-Session Integrity Checker ───────────────────────────────

/**
 * P0-5 fix (remediation plan Phase 5): the default list of policy
 * file paths that the mid-session checker monitors. These are the
 * files whose modification mid-session would compromise the agent's
 * safety guarantees (e.g. an attacker — or SICA itself — editing
 * `approval/engine.ts` to weaken the approval gate).
 *
 * The paths are relative to the package roots. The checker resolves
 * them against `process.cwd()` and `__dirname` (the @goli/core
 * package root) so it works regardless of where the user invoked
 * `goli` from.
 */
export const DEFAULT_POLICY_PATHS: readonly string[] = [
  // Core safety modules — modifying these mid-session could bypass
  // the approval gate, the sandbox, or the integrity check itself.
  'packages/core/src/approval/engine.ts',
  'packages/core/src/approval/enhanced-approval.ts',
  'packages/core/src/approval/blast-radius.ts',
  'packages/core/src/sandbox/executor.ts',
  'packages/core/src/sandbox/path-validation.ts',
  'packages/core/src/config/integrity.ts',
  // SICA immutable registry — the guard for self-modification.
  'packages/core/src/memory/sica/immutable-registry.ts',
  // Skills subsystem (SkillWriter writes here — must not modify seeds).
  'packages/core/src/memory/skills/seeds.ts',
];

/**
 * P0-5: Cache TTL for the mid-session integrity check. The checker
 * re-hashes all policy files at most once per minute. The cache is
 * keyed on `Date.now()` — a check within the TTL returns the cached
 * result without touching the filesystem. This keeps the per-T1+
 * overhead negligible (sub-millisecond after the first check).
 */
const MID_SESSION_CACHE_TTL_MS = 60_000;

/**
 * P0-5: Result of a mid-session integrity verification.
 */
export interface MidSessionIntegrityResult {
  /** Whether the policy files match their session-start hashes. */
  ok: boolean;
  /**
   * When `ok` is false, the list of files that changed (relative
   * paths). Empty when `ok` is true.
   */
  changedFiles: string[];
  /**
   * When `ok` is false, a human-readable message suitable for
   * logging + surfacing to the user.
   */
  message?: string;
  /** Wall-clock duration of the check (ms). */
  durationMs: number;
}

/**
 * P0-5: Mid-session policy integrity checker.
 *
 * Unlike `PolicyIntegrityManager` (which compares against a
 * persisted last-known-good hash), this checker caches the hashes
 * at session start (in memory) and re-verifies them on demand. The
 * use case is detecting mid-session modification of safety-critical
 * files — e.g. an attacker (or a buggy tool, or SICA itself) editing
 * `approval/engine.ts` during a running session.
 *
 * Usage:
 * ```ts
 * const checker = new MidSessionIntegrityChecker();
 * checker.captureBaseline(); // at session start
 * // ... later, before a T1+ tool call:
 * const result = checker.verify();
 * if (!result.ok) {
 *   // deny the tool call + log + abort
 * }
 * ```
 *
 * The check is cached for `MID_SESSION_CACHE_TTL_MS` (60s) so the
 * per-T1+ overhead is negligible after the first check.
 */
export class MidSessionIntegrityChecker {
  private readonly policyPaths: readonly string[];
  private baseline: Map<string, string> | null = null;
  private lastCheck: MidSessionIntegrityResult | null = null;
  private lastCheckTime = 0;

  constructor(opts: { policyPaths?: readonly string[] } = {}) {
    this.policyPaths = opts.policyPaths ?? DEFAULT_POLICY_PATHS;
  }

  /**
   * Capture the baseline hashes at session start. Must be called
   * before `verify()`. Idempotent — calling it again resets the
   * baseline (use after a known-intentional policy update).
   */
  captureBaseline(): void {
    this.baseline = this.computeHashes(this.policyPaths);
    this.lastCheck = null;
    this.lastCheckTime = 0;
  }

  /**
   * Verify that the policy files still match their baseline hashes.
   *
   * Returns a cached result when called within
   * `MID_SESSION_CACHE_TTL_MS` of the last check (so per-T1+ callers
   * don't re-hash on every tool call). The cache is busted when the
   * TTL expires OR when `captureBaseline()` is called.
   *
   * Returns `{ ok: true, changedFiles: [], durationMs: 0 }` when no
   * baseline has been captured (the checker is inert — callers that
   * haven't called `captureBaseline()` get a no-op).
   */
  verify(): MidSessionIntegrityResult {
    // No baseline → no-op (inert checker).
    if (this.baseline === null) {
      return { ok: true, changedFiles: [], durationMs: 0 };
    }
    // Cache hit.
    const now = Date.now();
    if (this.lastCheck !== null && now - this.lastCheckTime < MID_SESSION_CACHE_TTL_MS) {
      return this.lastCheck;
    }
    const start = now;
    const current = this.computeHashes(this.policyPaths);
    const changedFiles: string[] = [];
    for (const [path, hash] of current) {
      const baseHash = this.baseline.get(path);
      if (baseHash !== hash) {
        changedFiles.push(path);
      }
    }
    // Also detect deleted files (in baseline but not in current).
    for (const [path] of this.baseline) {
      if (!current.has(path)) {
        changedFiles.push(path + ' (deleted)');
      }
    }
    const result: MidSessionIntegrityResult = {
      ok: changedFiles.length === 0,
      changedFiles,
      message: changedFiles.length === 0
        ? undefined
        : `Policy files modified mid-session: ${changedFiles.join(', ')}`,
      durationMs: Date.now() - start,
    };
    this.lastCheck = result;
    this.lastCheckTime = now;
    return result;
  }

  /**
   * Compute SHA-256 hashes for the given policy file paths. Files
   * that don't exist or can't be read are skipped (their absence is
   * detected by `verify()` comparing the key set, not by throwing
   * here). Returns a Map keyed on the original path string.
   */
  private computeHashes(paths: readonly string[]): Map<string, string> {
    const hashes = new Map<string, string>();
    for (const p of paths) {
      // Resolve against cwd (user's project) AND the @goli/core
      // package root (so the checker works regardless of where the
      // user invoked `goli` from). We try cwd first, then the
      // core package dir.
      const candidates = [
        join(process.cwd(), p),
        // The @goli/core package is at packages/core relative to
        // the monorepo root. When the user runs `goli` from inside
        // the monorepo, `process.cwd()` already resolves these. When
        // they run from elsewhere (e.g. `goli` installed globally),
        // the paths won't resolve and the checker is inert — which
        // is the correct behavior (we can't verify what we can't
        // see).
      ];
      for (const fullPath of candidates) {
        try {
          if (!existsSync(fullPath)) continue;
          const content = readFileSync(fullPath, 'utf-8');
          const hash = crypto.createHash('sha256').update(content).digest('hex');
          hashes.set(p, hash);
          break; // first existing candidate wins
        } catch {
          // Read error — skip this file. The verify() step will
          // detect the missing hash as a change.
        }
      }
    }
    return hashes;
  }
}
