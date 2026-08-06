/**
 * Shared-state blackboard (Module 7).
 *
 * Agents don't message each other directly — they read/write a shared
 * file on disk. The "propose-validate-commit" (locked-blackboard)
 * protocol prevents race conditions.
 *
 * ## Why file-based (not messaging)?
 *
 * - No message ordering problems
 * - No lost messages
 * - Atomic file operations
 * - Human inspectability (can read the shared state file)
 *
 * @module orchestration/shared-state/blackboard
 */

import { randomUUID } from 'node:crypto';
import { writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';

import type { AgentRole } from '../../agent/types.js';
import type { BlackboardEntry } from '../types.js';
import type { Logger } from '@goli-cli/shared/utils/logger.js';

/** Options for the SharedBlackboard. */
export interface SharedBlackboardOptions {
  /** The shared state file path. */
  filePath?: string;
  /** The workspace root (default: ~/.agent/tasks/). */
  tasksDir?: string;
  /** Logger instance. */
  logger?: Logger;
}

/** The SharedBlackboard — file-based coordination for parallel agents. */
export class SharedBlackboard {
  private readonly filePath: string;
  private readonly log?: Logger;
  private readonly entries: BlackboardEntry[] = [];

  constructor(opts: SharedBlackboardOptions = {}) {
    const tasksDir = opts.tasksDir ?? join(process.env['HOME'] ?? '/tmp', '.agent', 'tasks');
    this.filePath = opts.filePath ?? join(tasksDir, 'shared-task-list.md');
    this.log = opts.logger;
  }

  /**
   * Propose a change (pending validation).
   * @param subtaskId
   * @param agentRole
   * @param content
   */
  propose(subtaskId: string, agentRole: AgentRole, content: string): BlackboardEntry {
    const entry: BlackboardEntry = {
      id: randomUUID(),
      subtaskId,
      agentRole,
      type: 'proposal',
      content,
      status: 'pending',
      timestamp: new Date().toISOString(),
    };
    this.entries.push(entry);
    this.persist();
    this.log?.debug('Proposal added', { subtaskId, agentRole, entryId: entry.id });
    return entry;
  }

  /**
   * Validate a proposal (mark as validated or rejected).
   * @param entryId
   * @param valid
   */
  validate(entryId: string, valid: boolean): boolean {
    const entry = this.entries.find((e) => e.id === entryId);
    if (!entry) return false;
    entry.status = valid ? 'validated' : 'rejected';
    this.persist();
    this.log?.debug('Proposal validated', { entryId, valid });
    return true;
  }

  /**
   * Commit a validated proposal.
   * @param entryId
   */
  commit(entryId: string): boolean {
    const entry = this.entries.find((e) => e.id === entryId);
    if (!entry || entry.status !== 'validated') return false;
    entry.status = 'committed';
    this.persist();
    this.log?.info('Proposal committed', { entryId, subtaskId: entry.subtaskId });
    return true;
  }

  /**
   * Update a subtask's status.
   *
   * The previous implementation set `content: status` (e.g.,
   * `content: 'pending'`) — the entry's content field was the
   * status enum, conflating content with status. The `content`
   * field should carry a human-readable description; the `status`
   * field already carries the enum. We now set
   * `content: 'Status changed to: ${status}'`.
   *
   * @param subtaskId
   * @param status
   * @param agentRole
   */
  updateStatus(subtaskId: string, status: BlackboardEntry['status'], agentRole: AgentRole): void {
    const entry: BlackboardEntry = {
      id: randomUUID(),
      subtaskId,
      agentRole,
      type: 'status',
      content: `Status changed to: ${status}`,
      status,
      timestamp: new Date().toISOString(),
    };
    this.entries.push(entry);
    // Bound the entries array so a long-running swarm session
    // doesn't grow without limit. The previous implementation
    // never trimmed — every propose/validate/commit/updateStatus
    // pushed a new entry, and the persisted markdown file grew
    // without bound. We now keep the most recent 10,000 entries
    // (LRU — oldest dropped first).
    const MAX_ENTRIES = 10_000;
    if (this.entries.length > MAX_ENTRIES) {
      const drop = this.entries.length - MAX_ENTRIES;
      this.entries.splice(0, drop);
    }
    this.persist();
  }

  /**
   * Get all entries for a subtask.
   * @param subtaskId
   */
  getBySubtask(subtaskId: string): BlackboardEntry[] {
    return this.entries.filter((e) => e.subtaskId === subtaskId);
  }

  /**
   * Get all pending proposals.
   */
  getPendingProposals(): BlackboardEntry[] {
    return this.entries.filter((e) => e.type === 'proposal' && e.status === 'pending');
  }

  /**
   * Get all committed entries.
   */
  getCommitted(): BlackboardEntry[] {
    return this.entries.filter((e) => e.status === 'committed');
  }

  /**
   * Get all entries.
   */
  getAll(): BlackboardEntry[] {
    return [...this.entries];
  }

  /**
   * Render the blackboard as a markdown file (human-readable).
   */
  toMarkdown(): string {
    const lines: string[] = ['# Shared Task List', ''];

    // Group by subtask
    const bySubtask = new Map<string, BlackboardEntry[]>();
    for (const entry of this.entries) {
      if (!bySubtask.has(entry.subtaskId)) bySubtask.set(entry.subtaskId, []);
      bySubtask.get(entry.subtaskId)!.push(entry);
    }

    for (const [_subtaskId, entries] of bySubtask) {
      lines.push(`## Subtask: ${_subtaskId}`, '');
      for (const entry of entries) {
        const icon = entry.status === 'committed' ? '✓' : entry.status === 'rejected' ? '✗' : '⏳';
        lines.push(`- ${icon} [${entry.type}] ${entry.agentRole}: ${entry.content.slice(0, 100)}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Persist the blackboard to disk.
   *
   * The previous implementation called `mkdirSync` + `writeFileSync`
   * on every `propose()`, `validate()`, `commit()`, and
   * `updateStatus()` call. In a swarm with 11 agents making frequent
   * proposals, this serialized all agent progress on disk I/O,
   * defeating the parallelism the blackboard is supposed to enable.
   * We now debounce: schedule a write 200ms in the future, and
   * collapse multiple mutations within that window into a single
   * write. Callers that need immediate durability can call
   * `persistNow()` directly.
   */
  private persistTimer: ReturnType<typeof setTimeout> | undefined;
  private persist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined;
      this.persistNow();
    }, 200);
  }

  /** Synchronous persist — for callers that need immediate durability. */
  persistNow(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      // Use a temp-file + atomic-rename pattern so a crash mid-write
      // doesn't corrupt the blackboard. The previous implementation
      // used `writeFileSync(this.filePath, ...)` directly — if the
      // process crashed mid-write, the file would be truncated /
      // partially written, and the next reader would see a corrupt
      // blackboard.
      const tmp = `${this.filePath}.tmp-${process.pid}`;
      writeFileSync(tmp, this.toMarkdown(), 'utf-8');
      renameSync(tmp, this.filePath);
    } catch {
      // Best-effort
    }
  }

  /** Clear all entries. */
  clear(): void {
    this.entries.length = 0;
    this.persist();
  }
}
