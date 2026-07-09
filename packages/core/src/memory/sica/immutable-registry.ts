/**
 * Immutable safety registry (Module 5, part 4).
 *
 * The keystone of SICA's safety guardrails. Protects critical files
 * from being modified by the SICA loop:
 *
 * - `src/sandbox/` — OS-native sandbox implementation
 * - `src/approval/` — approval policy engine
 * - `src/tools/hooks/builtin/` — safety hook scripts
 * - `src/sica/` — SICA evaluation harness + overseer
 * - `configs/sandbox.toml` — sandbox profiles
 *
 * ## How it works
 *
 * The registry maintains a list of "immutable paths". Before any SICA
 * proposal is applied, the registry checks if the proposal targets an
 * immutable path. If it does, the proposal is automatically rejected.
 *
 * In production (Phase 13+), the registry is enforced at the filesystem
 * level via read-only mounts (chmod 444 + chattr +i on Linux, or
 * equivalent on macOS). For Phase 11, the registry is enforced in
 * software (the SICA loop checks before applying).
 *
 * @module memory/sica/immutable-registry
 */

import { existsSync, chmodSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

import type { SicaTarget } from './types.js';
import type { Logger } from '../../utils/logger.js';

/** The immutable safety registry — protects critical files from SICA. */
export class ImmutableSafetyRegistry {
  private readonly immutablePaths: Set<string>;
  private readonly log?: Logger;

  constructor(opts: { logger?: Logger; workspaceRoot?: string } = {}) {
    this.log = opts.logger;
    const root = opts.workspaceRoot ?? process.cwd();

    // Default immutable paths — these CANNOT be modified by SICA
    this.immutablePaths = new Set([
      join(root, 'packages/core/src/sandbox/'), // OS-native sandbox
      join(root, 'packages/core/src/approval/'), // Approval policy engine
      join(root, 'packages/core/src/tools/hooks/builtin/'), // Safety hooks
      join(root, 'packages/core/src/sica/'), // SICA itself (meta-safety)
      join(root, 'packages/core/src/evals/redteam/'), // Red-team harness
      join(root, 'packages/core/src/orchestration/routing/'), // Provider blocklist
      join(root, 'config/sandbox.toml'), // Sandbox profiles
      join(root, 'config/routing.toml'), // Provider allowlist/blocklist
    ]);
  }

  /**
   * Check if a path is immutable (protected from SICA modification).
   * @param filePath
   */
  isImmutable(filePath: string): boolean {
    const resolved = resolve(filePath);
    for (const immutablePath of this.immutablePaths) {
      const rel = relative(immutablePath, resolved);
      // If the file is inside an immutable directory, or IS an immutable file
      if (!rel.startsWith('..') && rel !== '') {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if a SICA target is allowed to be modified.
   *
   * Some targets (hook_config) are partially immutable — only the
   * builtin hooks are protected, not user-defined hooks.
   * @param target
   * @param targetName
   */
  isTargetAllowed(target: SicaTarget, targetName: string): boolean {
    switch (target) {
      case 'hook_config': {
        // Builtin hooks are immutable; user hooks are mutable
        const builtinHooks = [
          'block_destructive',
          'block_secrets',
          'block_writes_outside_workspace',
          'audit_log',
        ];
        return !builtinHooks.includes(targetName);
      }

      case 'system_prompt':
        // The safety fragment is immutable; other fragments are mutable
        return targetName !== 'safety';

      case 'tool_description':
      case 'context_prompt':
      case 'todo_logic':
      case 'skill_definition':
        // These are all mutable
        return true;

      default:
        return false;
    }
  }

  /**
   * Add a path to the immutable registry (for extensibility).
   * @param path
   */
  addPath(path: string): void {
    this.immutablePaths.add(resolve(path));
    this.log?.info('Path added to immutable registry', { path });
  }

  /**
   * Get all immutable paths (for debugging / display).
   */
  getPaths(): string[] {
    return [...this.immutablePaths].sort();
  }

  /**
   * Enforce filesystem-level immutability (Phase 13+ production).
   *
   * On Linux: `chattr +i` (requires root).
   * On macOS: not directly supported; use read-only mount.
   * For Phase 11: `chmod 444` (read-only for all users).
   */
  enforceFilesystemImmutable(): { enforced: number; failed: number } {
    let enforced = 0;
    let failed = 0;

    for (const path of this.immutablePaths) {
      if (!existsSync(path)) continue;
      try {
        const stat = statSync(path);
        if (stat.isDirectory()) {
          // For directories, we can't easily make them read-only without
          // breaking the agent's ability to read them. In production,
          // we'd use mount --bind with read-only.
          this.log?.debug('Directory in immutable registry (use mount for full enforcement)', { path });
        } else {
          // Make file read-only
          chmodSync(path, 0o444);
          enforced++;
        }
      } catch (err) {
        this.log?.warn('Failed to enforce immutability', {
          path,
          error: err instanceof Error ? err.message : String(err),
        });
        failed++;
      }
    }

    this.log?.info('Filesystem immutability enforced', { enforced, failed });
    return { enforced, failed };
  }

  /**
   * Verify that no immutable file has been modified (integrity check).
   *
   * In production, this would compare against known-good hashes.
   * For Phase 11, it just checks that the files exist and are readable.
   */
  verifyIntegrity(): { ok: boolean; missingPaths: string[] } {
    const missingPaths: string[] = [];

    for (const path of this.immutablePaths) {
      if (!existsSync(path)) {
        missingPaths.push(path);
      }
    }

    return {
      ok: missingPaths.length === 0,
      missingPaths,
    };
  }
}
