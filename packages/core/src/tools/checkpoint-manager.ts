/**
 * Transparent filesystem checkpoint manager (Hermes pattern).
 *
 * Creates git snapshots before file-mutating operations using a single
 * shared shadow git store. This lets the user (and agent) roll back
 * to a known-good state if something goes wrong.
 *
 * ## Key design decisions
 *
 * - **Single shared shadow git store** at `~/.goli-cli/checkpoints/store/`
 *   — git objects are deduplicated across projects (was per-project
 *   before, ~40MB × N worktrees).
 * - **GIT_DIR + GIT_WORK_TREE + GIT_INDEX_FILE** — separate env vars
 *   so no git state leaks into the user's project. The user's `.git`
 *   is never touched.
 * - **Once per turn** — triggers before file-mutating ops (write_file,
 *   edit_file, bash with destructive flags). Not per-tool-call.
 * - **Auto-prune** — deletes refs whose workdir no longer exists or
 *   whose last touch is older than `retentionDays`, then `git gc --prune=now`.
 * - **Size cap** — drops oldest checkpoints per project if total size
 *   exceeds `maxSizeMb`.
 * - **NOT a tool** — the LLM never sees it. Transparent infrastructure
 *   controlled by a config flag.
 * - **Secrets protection** — by default, files matching common secret
 *   patterns (`.env`, `*.pem`, `id_rsa`, `.aws/credentials`, etc.) are
 *   NOT added to the shadow index. This prevents secrets from being
 *   persisted to disk in the shadow store.
 * - **Persistent index** — the in-memory `checkpoints` array is backed
 *   by a JSON manifest on disk so checkpoints survive process restarts
 *   and `restore()` works across sessions.
 *
 * @module tools/checkpoint-manager
 */

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';

import type { Logger } from '../utils/logger.js';

/** A checkpoint record. */
export interface Checkpoint {
  /** Unique checkpoint ID. */
  id: string;
  /** The project workspace root. */
  workspaceRoot: string;
  /** The git ref name (e.g. `checkpoint/project-abc123/turn-5`). */
  ref: string;
  /** The commit SHA. */
  commitSha: string;
  /** When the checkpoint was created (ISO 8601). */
  createdAt: string;
  /** The turn number (for display). */
  turnNumber: number;
  /** The file that triggered the checkpoint (if any). */
  triggeredBy?: string;
  /** The checkpoint size in bytes (estimated). */
  sizeBytes?: number;
}

/** Options for the CheckpointManager. */
export interface CheckpointManagerOptions {
  /** Logger instance. */
  logger?: Logger;
  /** The shadow git store path (default: ~/.goli-cli/checkpoints/store/). */
  storePath?: string;
  /** Retention period in days (default: 7). */
  retentionDays?: number;
  /** Max total size per project in MB (default: 500). */
  maxSizeMb?: number;
  /** Whether checkpoints are enabled (default: true). */
  enabled?: boolean;
  /** Whether the workspace is a git repo (checked at init). */
  isGitRepo?: boolean;
  /** Glob patterns of files to exclude from checkpoints (secrets, etc.). */
  excludePatterns?: string[];
}

/**
 * Default exclude patterns — files that should never be persisted to the
 * shadow git store because they typically contain secrets. Users can
 * override via `excludePatterns`.
 */
export const DEFAULT_EXCLUDE_PATTERNS: readonly string[] = [
  '.env',
  '.env.*',
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  'id_rsa',
  'id_rsa.*',
  'id_ed25519',
  'id_ed25519.*',
  'id_dsa',
  'id_ecdsa',
  '.aws/credentials',
  '.aws/config',
  '.gcp/credentials*.json',
  '.ssh/*',
  '.npmrc',
  '.pypirc',
  '.netrc',
  'credentials.json',
  'service-account*.json',
  '*.keystore',
  '*.jks',
];

/**
 * Transparent filesystem checkpoint manager.
 *
 * Creates shadow git snapshots before file-mutating operations.
 * The LLM never sees this — it's transparent infrastructure.
 *
 * @module tools/checkpoint-manager
 */
export class CheckpointManager {
  private readonly log?: Logger;
  private readonly storePath: string;
  private readonly retentionDays: number;
  private readonly enabled: boolean;
  private readonly excludePatterns: readonly string[];
  private isGitRepo: boolean;
  private currentTurn = 0;
  private checkpointThisTurn = false;
  /**
   * In-memory cache of the on-disk checkpoint manifest. The manifest is
   * the source of truth — without it, checkpoints created in a previous
   * session would be orphaned (the git refs exist but the metadata is lost).
   */
  private readonly checkpoints: Checkpoint[] = [];

  constructor(opts: CheckpointManagerOptions = {}) {
    this.log = opts.logger;
    this.storePath = opts.storePath ?? join(homedir(), '.goli-cli', 'checkpoints', 'store');
    this.retentionDays = opts.retentionDays ?? 7;
    this.enabled = opts.enabled ?? true;
    this.isGitRepo = opts.isGitRepo ?? false;
    this.excludePatterns = opts.excludePatterns ?? DEFAULT_EXCLUDE_PATTERNS;
  }

  /**
   * Initialize the checkpoint manager for a workspace.
   *
   * Checks if the workspace is a git repo and initializes the shadow
   * git store if needed. Loads the on-disk checkpoint manifest so
   * `list()` and `restore()` work across process restarts.
   * @param workspaceRoot
   */
  init(workspaceRoot: string): void {
    if (!this.enabled) {
      this.log?.debug('Checkpoints disabled');
      return;
    }

    // Check if workspace is a git repo
    this.isGitRepo = this.checkIsGitRepo(workspaceRoot);
    if (!this.isGitRepo) {
      this.log?.info('Workspace is not a git repo — checkpoints disabled for this workspace', {
        workspaceRoot,
      });
      return;
    }

    // Initialize shadow git store
    this.initShadowStore();

    // Load the on-disk manifest so previously-created checkpoints are
    // available for restore() / list() across process restarts.
    this.loadManifest();

    // Defer prune to avoid blocking startup. The previous
    // implementation called `this.prune(workspaceRoot)` on every
    // `init()`. `prune()` calls `git gc --prune=now --quiet` on
    // the shadow store — on a large store (hundreds of checkpoints,
    // GBs of objects), `git gc` can take minutes, blocking the
    // agent's startup. We now defer prune to the next tick so
    // `init()` returns immediately and the agent loop can start.
    // The prune runs in the background; if it fails, the old
    // checkpoints remain (no harm — they'll be pruned on the next
    // init).
    setImmediate(() => {
      try {
        this.prune(workspaceRoot);
      } catch (err) {
        this.log?.warn('Deferred prune failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    this.log?.info('Checkpoint manager initialized', {
      workspaceRoot,
      storePath: this.storePath,
      retentionDays: this.retentionDays,
      loadedCheckpoints: this.checkpoints.length,
    });
  }

  /**
   * Start a new turn (reset the per-turn checkpoint flag).
   */
  startTurn(): void {
    this.currentTurn++;
    this.checkpointThisTurn = false;
  }

  /**
   * Create a checkpoint before a file-mutating operation.
   *
   * Only creates one checkpoint per turn (the first file-mutating op
   * triggers it; subsequent ops in the same turn don't).
   *
   * @param workspaceRoot - The workspace root.
   * @param triggeredBy - The tool/file that triggered the checkpoint.
   * @returns The created checkpoint, or null if skipped.
   */
  checkpoint(workspaceRoot: string, triggeredBy?: string): Checkpoint | null {
    if (!this.enabled || !this.isGitRepo) return null;

    // Only one checkpoint per turn
    if (this.checkpointThisTurn) {
      this.log?.debug('Checkpoint already created this turn — skipping');
      return null;
    }

    // NOTE: we set `checkpointThisTurn = true` ONLY after the
    // shadow checkpoint has actually been created and the manifest
    // saved. The previous implementation set it BEFORE the try
    // block, so if `createShadowCheckpoint` threw (disk full, git
    // error), the catch block returned `null` but
    // `checkpointThisTurn` remained `true`. Subsequent `checkpoint()`
    // calls in the same turn returned `null` immediately ("Checkpoint
    // already created this turn — skipping"). The agent proceeded
    // with file mutations believing a rollback point existed when
    // none did.

    try {
      const checkpoint = this.createShadowCheckpoint(workspaceRoot, triggeredBy);
      this.checkpoints.push(checkpoint);
      this.saveManifest();
      // Mark this turn as checkpointed ONLY after success.
      this.checkpointThisTurn = true;

      this.log?.info('Checkpoint created', {
        id: checkpoint.id,
        ref: checkpoint.ref,
        commitSha: checkpoint.commitSha.slice(0, 12),
        turnNumber: checkpoint.turnNumber,
        triggeredBy,
      });

      return checkpoint;
    } catch (err) {
      this.log?.error('Failed to create checkpoint', {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  /**
   * List all checkpoints for a workspace.
   * @param workspaceRoot
   */
  list(workspaceRoot: string): Checkpoint[] {
    return this.checkpoints.filter((c) => c.workspaceRoot === workspaceRoot);
  }

  /**
   * Restore a checkpoint (roll back to the snapshot).
   *
   * WARNING: This overwrites the user's working tree with the checkpoint
   * content. Uncommitted changes are lost. The caller should warn the
   * user before invoking this.
   *
   * @param checkpointId - The checkpoint ID to restore.
   * @param workspaceRoot - The workspace root.
   * @returns True if the restore succeeded.
   */
  restore(checkpointId: string, workspaceRoot: string): boolean {
    const checkpoint = this.checkpoints.find(
      (c) => c.id === checkpointId && c.workspaceRoot === workspaceRoot,
    );
    if (!checkpoint) {
      this.log?.warn('Checkpoint not found', { checkpointId });
      return false;
    }

    try {
      // Use shadow git to restore the working tree. Pass the SHA as a
      // separate arg (not interpolated into a shell string) to prevent
      // command injection if a checkpoint ID were ever crafted.
      // We also use `--` to mark end-of-options so a tampered
      // manifest (commitSha starting with `-`, e.g.
      // `--upload-pack=evil`) is treated as a tree-ish, not an
      // option. The previous implementation omitted `--`, so a
      // local attacker who could write to
      // ~/.goli-cli/checkpoints/store/manifest.json (which is
      // JSON.parse'd without validation in `loadManifest`) could
      // inject git options.
      const env = this.shadowEnv(workspaceRoot);
      // Validate the commit SHA — must be a 40-char hex string (or
      // the 7-char short form). Reject anything that starts with `-`.
      const sha = checkpoint.commitSha;
      if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
        this.log?.error('Checkpoint commitSha failed validation — refusing to restore', {
          checkpointId,
          commitSha: sha.slice(0, 12) + '…',
        });
        return false;
      }
      execFileSync('git', ['checkout', '-f', sha, '--'], {
        env: { ...process.env, ...env },
        cwd: workspaceRoot,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 15_000,
      });

      this.log?.info('Checkpoint restored', {
        id: checkpoint.id,
        commitSha: checkpoint.commitSha.slice(0, 12),
      });
      return true;
    } catch (err) {
      this.log?.error('Failed to restore checkpoint', {
        id: checkpointId,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  /**
   * Prune old checkpoints.
   *
   * - Deletes refs whose workdir no longer exists
   * - Deletes refs older than retentionDays
   * - Runs `git gc --prune=now` to clean up dangling objects
   * - Enforces size cap (drops oldest per project)
   * - Persists the cleaned manifest to disk
   * @param _workspaceRoot
   */
  prune(_workspaceRoot: string): void {
    // Note: the parameter is kept for API compatibility but pruning now
    // iterates ALL workspaces' checkpoints (the manifest is global). The
    // previous implementation also ignored the parameter in practice.
    if (!this.enabled || !this.isGitRepo) return;

    const now = Date.now();
    const maxAgeMs = this.retentionDays * 24 * 60 * 60 * 1000;
    let prunedCount = 0;

    // Filter out old checkpoints
    const remaining: Checkpoint[] = [];
    for (const cp of this.checkpoints) {
      const age = now - new Date(cp.createdAt).getTime();
      const workdirExists = existsSync(cp.workspaceRoot);

      if (!workdirExists || age > maxAgeMs) {
        // Delete the ref. Pass ref as separate arg (not shell-interpolated)
        // to prevent injection via crafted ref names.
        try {
          const env = this.shadowEnv(cp.workspaceRoot);
          execFileSync('git', ['update-ref', '-d', cp.ref], {
            env: { ...process.env, ...env },
            cwd: this.storePath,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 5000,
          });
          prunedCount++;
        } catch {
          // Best-effort
        }
      } else {
        remaining.push(cp);
      }
    }

    this.checkpoints.length = 0;
    this.checkpoints.push(...remaining);

    // Run git gc to clean up dangling objects
    try {
      execFileSync('git', ['gc', '--prune=now', '--quiet'], {
        cwd: this.storePath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 30_000,
      });
    } catch {
      // Best-effort
    }

    // Persist the cleaned manifest
    this.saveManifest();

    if (prunedCount > 0) {
      this.log?.info('Pruned old checkpoints', { prunedCount, remaining: this.checkpoints.length });
    }
  }

  /**
   * Get the total checkpoint count.
   */
  get count(): number {
    return this.checkpoints.length;
  }

  /**
   * Get the current turn number.
   */
  get turn(): number {
    return this.currentTurn;
  }

  /**
   * Check if checkpoints are enabled for the current workspace.
   */
  get isActive(): boolean {
    return this.enabled && this.isGitRepo;
  }

  // ─── Internal methods ──────────────────────────────────────────

  /**
   * Check if a directory is a git repo.
   * @param dir
   */
  private checkIsGitRepo(dir: string): boolean {
    try {
      execFileSync('git', ['rev-parse', '--git-dir'], {
        cwd: dir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 5000,
      });
      return true;
    } catch {
      return false;
    }
  }

  /** Initialize the shadow git store. */
  private initShadowStore(): void {
    // Check if the store is already a git repo (not just if the dir exists)
    const isGitStore = existsSync(join(this.storePath, 'HEAD'));
    if (!isGitStore) {
      mkdirSync(this.storePath, { recursive: true });
      try {
        execFileSync('git', ['init', '--bare', '--quiet'], {
          cwd: this.storePath,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 10_000,
        });
        this.log?.debug('Shadow git store initialized', { path: this.storePath });
      } catch (err) {
        this.log?.error('Failed to init shadow git store', {
          error: err instanceof Error ? err.message : String(err),
        });
        this.isGitRepo = false;
      }
    }
  }

  /** Path to the on-disk manifest of checkpoints. */
  private get manifestPath(): string {
    return join(this.storePath, 'manifest.json');
  }

  /** Load the on-disk checkpoint manifest into the in-memory array.
   *
   * The previous implementation used `JSON.parse(raw) as Checkpoint[]`
   * — an unchecked cast. A corrupted or tampered manifest could have
   * `commitSha: '../../etc/passwd'`, `ref: 'refs/heads/main'`
   * (deleting the user's branch on next `prune`), or
   * `workspaceRoot: '/'` (causing `prune` to delete refs for the
   * wrong workspace). We now validate each checkpoint entry's
   * fields before accepting it.
   */
  private loadManifest(): void {
    try {
      if (!existsSync(this.manifestPath)) return;
      const raw = readFileSync(this.manifestPath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      this.checkpoints.length = 0;
      for (const entry of parsed) {
        if (this.validateCheckpointEntry(entry)) {
          this.checkpoints.push(entry as Checkpoint);
        } else {
          this.log?.warn('Skipping invalid checkpoint manifest entry', {
            entry: JSON.stringify(entry).slice(0, 200),
          });
        }
      }
    } catch (err) {
      this.log?.warn('Failed to load checkpoint manifest', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Validate a parsed checkpoint manifest entry. Rejects entries
   * with missing/wrong-typed fields, suspicious `commitSha` values
   * (must be 7-40 hex chars — no path traversal), suspicious `ref`
   * values (must start with `refs/goli/`), or wrong-typed
   * `workspaceRoot`.
   */
  private validateCheckpointEntry(entry: unknown): entry is Checkpoint {
    if (typeof entry !== 'object' || entry === null) return false;
    const e = entry as Record<string, unknown>;
    // Required fields.
    if (typeof e['id'] !== 'string') return false;
    if (typeof e['turnNumber'] !== 'number') return false;
    if (typeof e['triggeredBy'] !== 'string') return false;
    // commitSha: must be hex (7-40 chars). Reject anything that
    // looks like a path (contains `/`, `..`, starts with `-`).
    const sha = e['commitSha'];
    if (typeof sha !== 'string' || !/^[0-9a-f]{7,40}$/i.test(sha)) return false;
    // ref: must start with 'refs/goli/' to prevent deleting user
    // branches like 'refs/heads/main'.
    const ref = e['ref'];
    if (typeof ref !== 'string' || !ref.startsWith('refs/goli/')) return false;
    // workspaceRoot: optional but if present must be a string.
    if (e['workspaceRoot'] !== undefined && typeof e['workspaceRoot'] !== 'string') return false;
    return true;
  }

  /** Persist the in-memory checkpoint array to disk (atomic write). */
  private saveManifest(): void {
    try {
      mkdirSync(this.storePath, { recursive: true });
      const tmp = `${this.manifestPath}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.checkpoints, null, 2), 'utf-8');
      renameSync(tmp, this.manifestPath);
    } catch (err) {
      this.log?.warn('Failed to save checkpoint manifest', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Create a shadow git checkpoint.
   * @param workspaceRoot
   * @param triggeredBy
   */
  private createShadowCheckpoint(workspaceRoot: string, triggeredBy?: string): Checkpoint {
    const checkpointId = randomUUID().slice(0, 12);
    const projectName = basename(workspaceRoot).replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    const ref = `refs/checkpoints/${projectName}/${checkpointId}`;
    const turnNumber = this.currentTurn;

    // Set up shadow git environment
    const env = this.shadowEnv(workspaceRoot);
    const fullEnv = {
      ...process.env,
      ...env,
      GIT_AUTHOR_NAME: 'Goli-CLI Checkpoint',
      GIT_AUTHOR_EMAIL: 'checkpoint@goli.dev',
      GIT_COMMITTER_NAME: 'Goli-CLI Checkpoint',
      GIT_COMMITTER_EMAIL: 'checkpoint@goli.dev',
    };

    // Add files to the shadow index, EXCLUDING secret patterns.
    // We use `git add` with pathspec exclude rules so secrets (.env,
    // id_rsa, *.pem, etc.) are never persisted to the shadow store.
    //
    // Pathspec magic: `:(exclude)PATTERN` must be a SINGLE arg (not
    // `:(exclude)` and `PATTERN` as separate args — git would treat the
    // latter as two pathspecs, the first being a literal `:(exclude)`
    // which matches nothing, and the second being a positive include of
    // `PATTERN`).
    const excludeArgs: string[] = [];
    for (const pattern of this.excludePatterns) {
      excludeArgs.push(`:(exclude)${pattern}`);
    }
    // `git add -A -- <exclude pathspecs>` adds everything except the excluded.
    execFileSync('git', ['add', '-A', '--', ...excludeArgs], {
      env: fullEnv,
      cwd: workspaceRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30_000,
    });

    // Create a tree from the index
    const treeSha = execFileSync('git', ['write-tree'], {
      env: fullEnv,
      cwd: workspaceRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10_000,
    }).trim();

    // Create a commit object. Pass the commit message via stdin (-F -)
    // so `triggeredBy` cannot inject shell metacharacters into the command
    // (the previous implementation interpolated it into a `git commit-tree
    // -m "..."` shell string — real shell injection).
    const parentSha = this.checkpoints.length > 0
      ? this.checkpoints[this.checkpoints.length - 1]!.commitSha
      : null;
    const commitMessage = `checkpoint: turn ${turnNumber}${triggeredBy ? ` (${triggeredBy})` : ''}`;
    const commitArgs = ['commit-tree', treeSha];
    if (parentSha) commitArgs.push('-p', parentSha);
    commitArgs.push('-m', commitMessage);
    const commitSha = execFileSync('git', commitArgs, {
      env: fullEnv,
      cwd: workspaceRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10_000,
    }).trim();

    // Update the ref. Pass ref and SHA as separate args (not shell-interpolated).
    execFileSync('git', ['update-ref', ref, commitSha], {
      env: fullEnv,
      cwd: this.storePath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    });

    return {
      id: checkpointId,
      workspaceRoot,
      ref,
      commitSha,
      createdAt: new Date().toISOString(),
      turnNumber,
      triggeredBy,
    };
  }

  /**
   * Build the shadow git environment variables.
   *
   * GIT_DIR points to the shadow store (not the user's .git).
   * GIT_WORK_TREE points to the user's workspace.
   * GIT_INDEX_FILE uses a separate index file per project to avoid conflicts.
   * @param workspaceRoot
   */
  private shadowEnv(workspaceRoot: string): Record<string, string> {
    const projectName = basename(workspaceRoot).replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    const indexFile = join(this.storePath, 'indexes', `${projectName}.index`);

    // Ensure the indexes directory exists
    mkdirSync(join(this.storePath, 'indexes'), { recursive: true });

    return {
      GIT_DIR: this.storePath,
      GIT_WORK_TREE: workspaceRoot,
      GIT_INDEX_FILE: indexFile,
    };
  }
}
