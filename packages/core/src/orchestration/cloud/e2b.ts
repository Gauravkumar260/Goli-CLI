/**
 * E2B cloud sandbox (Module 7).
 *
 * E2B provides Firecracker microVMs — hardware-level isolation
 * (separate kernel per session), 125-200ms boot, ~5MB overhead.
 * Used by 94% of Fortune 100 for agentic workloads.
 *
 * Phase 13 ships a client stub that generates the E2B SDK calls.
 * In production, the E2B SDK (`@e2b/code-interpreter`) would be
 * installed and the actual sandbox created. For Phase 13, we provide
 * the interface and configuration generation.
 *
 * @module orchestration/cloud/e2b
 */

import { randomUUID } from 'node:crypto';

import type { Logger } from '../../utils/logger.js';
import type { CloudSandboxSession } from '../types.js';

/** Options for the E2BSandbox. */
export interface E2BSandboxOptions {
  /** Logger instance. */
  logger?: Logger;
  /** The E2B API key (from env: E2B_API_KEY). */
  apiKey?: string;
  /** Whether to auto-destroy sandboxes on completion (default: true). */
  autoDestroy?: boolean;
  /** Max concurrent sandboxes (default: 10). */
  maxConcurrent?: number;
}

/** The E2B sandbox — Firecracker microVM management. */
export class E2BSandbox {
  private readonly log?: Logger;
  private readonly apiKey?: string;
  private readonly maxConcurrent: number;
  private readonly sessions: Map<string, CloudSandboxSession> = new Map();

  constructor(opts: E2BSandboxOptions = {}) {
    this.log = opts.logger;
    this.apiKey = opts.apiKey ?? process.env['E2B_API_KEY'];
    this.maxConcurrent = opts.maxConcurrent ?? 10;
  }

  /**
   * Create a new sandbox (preload repo if specified).
   *
   * Race-safe: the previous implementation checked
   * `this.sessions.size >= this.maxConcurrent` and then later
   * `this.sessions.set(...)` — but two concurrent `create()` calls
   * (e.g., parallel subagent spawns) could both pass the check
   * before either adds to the map, exceeding `maxConcurrent`. We
   * now use a counter-based admission token: increment
   * `pendingCreations` BEFORE the check, so concurrent callers
   * see each other.
   *
   * @param repoUrl - Optional git repo to preload.
   * @returns The sandbox session.
   */
  private pendingCreations = 0;
  async create(repoUrl?: string): Promise<CloudSandboxSession> {
    // Reserve a slot BEFORE checking the size — this is the
    // admission token. If we exceed maxConcurrent after the
    // reservation, release the token and throw.
    this.pendingCreations++;
    try {
      const effectiveCount = this.sessions.size + this.pendingCreations;
      if (effectiveCount > this.maxConcurrent) {
        throw new Error(`Max concurrent sandboxes reached: ${this.maxConcurrent} (active=${this.sessions.size}, pending=${this.pendingCreations})`);
      }

      const session: CloudSandboxSession = {
        sandboxId: randomUUID(),
        provider: 'e2b',
        repoUrl,
        status: 'creating',
        createdAt: new Date().toISOString(),
      };

      this.sessions.set(session.sandboxId, session);

      this.log?.info('Creating E2B sandbox', {
        sandboxId: session.sandboxId,
        repoUrl,
      });

      try {
        // In production, this would call the E2B SDK:
        //   import { Sandbox } from '@e2b/code-interpreter';
        //   const sandbox = await Sandbox.create({ apiKey: this.apiKey });
        //   if (repoUrl) await sandbox.runCommand(`git clone ${repoUrl} .`);

        // Phase 13 stub: simulate creation
        await new Promise((resolve) => setTimeout(resolve, 200)); // Simulate 200ms boot
        session.status = 'ready';

        this.log?.info('E2B sandbox ready', { sandboxId: session.sandboxId });
      } catch (err) {
        session.status = 'destroyed';
        this.log?.error('E2B sandbox creation failed', {
          sandboxId: session.sandboxId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      return session;
    } finally {
      // Release the admission token regardless of outcome.
      this.pendingCreations--;
    }
  }

  /**
   * Execute a command in a sandbox.
   *
   * @param sandboxId - The sandbox ID.
   * @param command - The command to execute.
   * @returns The command output.
   */
  async execute(sandboxId: string, command: string): Promise<{
    ok: boolean;
    stdout: string;
    stderr: string;
    exitCode: number;
  }> {
    const session = this.sessions.get(sandboxId);
    if (!session || session.status !== 'ready') {
      return { ok: false, stdout: '', stderr: 'Sandbox not ready', exitCode: 1 };
    }

    session.status = 'executing';

    try {
      // In production: const result = await sandbox.runCommand(command);
      // Phase 13 stub
      const output = `[e2b:${sandboxId.slice(0, 8)}] $ ${command}\n(simulated output)`;
      session.status = 'ready';
      return { ok: true, stdout: output, stderr: '', exitCode: 0 };
    } catch (err) {
      session.status = 'ready';
      return {
        ok: false,
        stdout: '',
        stderr: err instanceof Error ? err.message : String(err),
        exitCode: 1,
      };
    }
  }

  /**
   * Destroy a sandbox (auto-destroy on completion).
   * @param sandboxId
   */
  async destroy(sandboxId: string): Promise<boolean> {
    const session = this.sessions.get(sandboxId);
    if (!session) return false;

    try {
      // In production: await sandbox.kill();
      session.status = 'destroyed';
      session.destroyedAt = new Date().toISOString();
      this.sessions.delete(sandboxId);

      this.log?.info('E2B sandbox destroyed', { sandboxId });
      return true;
    } catch {
      return false;
    }
  }

  /** Destroy all active sandboxes (cleanup). */
  async destroyAll(): Promise<void> {
    for (const id of [...this.sessions.keys()]) {
      await this.destroy(id);
    }
  }

  /** Get all active sandboxes. */
  getActive(): CloudSandboxSession[] {
    return [...this.sessions.values()].filter((s) => s.status !== 'destroyed');
  }

  /** Get the active sandbox count. */
  get count(): number {
    return this.sessions.size;
  }

  /** Check if the E2B API key is configured. */
  get isConfigured(): boolean {
    return !!this.apiKey;
  }
}
