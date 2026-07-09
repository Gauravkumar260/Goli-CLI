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
   */
  acceptIntegrity(scope: string, identifier: string, hash: string): void {
    const storedData = this.loadIntegrityData();
    const key = this.getIntegrityKey(scope, identifier);
    storedData[key] = hash;
    this.saveIntegrityData(storedData);
  }

  /** Build the storage key for a (scope, identifier) pair. */
  private getIntegrityKey(scope: string, identifier: string): string {
    return `${scope}:${identifier}`;
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

  /** Save the integrity data to the storage file. */
  private saveIntegrityData(data: StoredIntegrityData): void {
    try {
      mkdirSync(dirname(this.storagePath), { recursive: true });
      writeFileSync(this.storagePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch {
      // Silently fail — integrity checking is a safety net, not a hard gate.
    }
  }
}
