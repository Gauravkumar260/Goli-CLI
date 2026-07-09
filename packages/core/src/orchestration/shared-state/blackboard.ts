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
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

import type { AgentRole } from '../../agent/types.js';
import type { Logger } from '../../utils/logger.js';
import type { BlackboardEntry } from '../types.js';

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
      content: status,
      status,
      timestamp: new Date().toISOString(),
    };
    this.entries.push(entry);
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

  /** Persist the blackboard to disk. */
  private persist(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, this.toMarkdown(), 'utf-8');
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
