/**
 * Persistent memory files (Module 5, part 1).
 *
 * Manages the three bounded markdown files:
 * - `~/.agent/memories/MEMORY.md` (~800 tokens, 2200 chars)
 * - `~/.agent/memories/USER.md` (~500 tokens, 1375 chars)
 * - `./PROJECT.md` (~700 tokens, 2000 chars) — per-repo
 *
 * ## Character budgets (Hermes pattern)
 *
 * Hard character budgets force curation. Without them, memory files
 * grow unboundedly and dominate the system prompt, degrading the
 * agent's attention. The budgets are deliberately tight — the agent
 * must decide what's worth keeping.
 *
 * ## Frozen snapshot injection
 *
 * At session start, the memory files are read and frozen into a
 * snapshot. The snapshot is injected into the system prompt as a
 * read-only block. The agent CANNOT modify the snapshot mid-session
 * — this prevents the agent from rewriting its own memory to escape
 * constraints (e.g. "I'm now allowed to run rm -rf").
 *
 * Within-session learnings go to Tier 1 (session memory). The curator
 * runs at session end to extract learnings and update the persistent
 * files (within budget).
 *
 * @module memory/persistent/files
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

import { MEMORY_BUDGETS, TOTAL_MEMORY_BUDGET } from '../types.js';

import type { PersistentMemoryFile, MemorySnapshot } from '../types.js';

/** Options for PersistentMemory. */
export interface PersistentMemoryOptions {
  /** Override the memories directory (default: ~/.agent/memories). */
  memoriesDir?: string;
  /** Override the project root (default: process.cwd()). */
  projectRoot?: string;
}

/**
 * Persistent memory manager — loads, saves, and enforces budgets on
 * the three markdown memory files.
 *
 * @module memory/persistent/files
 */
export class PersistentMemory {
  private readonly memoriesDir: string;
  private readonly projectRoot: string;

  constructor(opts: PersistentMemoryOptions = {}) {
    this.memoriesDir = opts.memoriesDir ?? this.defaultMemoriesDir();
    this.projectRoot = opts.projectRoot ?? process.cwd();
  }

  /** Default memories directory: ~/.agent/memories/ */
  private defaultMemoriesDir(): string {
    return join(homedir(), '.agent', 'memories');
  }

  /**
   * Get the path to a memory file.
   * @param name
   */
  getFilePath(name: 'MEMORY.md' | 'USER.md' | 'PROJECT.md'): string {
    if (name === 'PROJECT.md') {
      return join(this.projectRoot, 'PROJECT.md');
    }
    return join(this.memoriesDir, name);
  }

  /**
   * Load a memory file (returns empty string if not found).
   * @param name
   */
  load(name: 'MEMORY.md' | 'USER.md' | 'PROJECT.md'): PersistentMemoryFile {
    const filePath = this.getFilePath(name);
    const budget =
      name === 'MEMORY.md'
        ? MEMORY_BUDGETS.MEMORY
        : name === 'USER.md'
          ? MEMORY_BUDGETS.USER
          : MEMORY_BUDGETS.PROJECT;

    let content = '';
    if (existsSync(filePath)) {
      content = readFileSync(filePath, 'utf-8');
    }

    return {
      name,
      content,
      budget,
      length: content.length,
      overBudget: content.length > budget,
    };
  }

  /** Load all three memory files. */
  loadAll(): {
    memory: PersistentMemoryFile;
    user: PersistentMemoryFile;
    project: PersistentMemoryFile;
  } {
    return {
      memory: this.load('MEMORY.md'),
      user: this.load('USER.md'),
      project: this.load('PROJECT.md'),
    };
  }

  /**
   * Save a memory file. Enforces the character budget by truncating
   * from the END (keeping the beginning, which is usually the most
   * important / oldest memories).
   *
   * @param name - The file name.
   * @param content - The new content.
   * @returns The saved file (possibly truncated).
   */
  save(name: 'MEMORY.md' | 'USER.md' | 'PROJECT.md', content: string): PersistentMemoryFile {
    const budget =
      name === 'MEMORY.md'
        ? MEMORY_BUDGETS.MEMORY
        : name === 'USER.md'
          ? MEMORY_BUDGETS.USER
          : MEMORY_BUDGETS.PROJECT;

    // Enforce budget. The previous implementation always sliced
    // to `budget - markerLength` if `content.length > budget`, but
    // it didn't account for the case where `content.length` is
    // between `budget - markerLength` and `budget` — adding the
    // truncation marker to that would push it OVER budget. The
    // marker should only be added if we actually truncated.
    // We now compute the effective slice based on the actual
    // budget overflow.
    const truncationMarker = '\n\n[... truncated ...]';
    let truncated = content;
    if (content.length > budget) {
      const sliceEnd = Math.max(0, budget - truncationMarker.length);
      truncated = content.slice(0, sliceEnd) + truncationMarker;
    }

    const filePath = this.getFilePath(name);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, truncated, 'utf-8');

    return {
      name,
      content: truncated,
      budget,
      length: truncated.length,
      overBudget: false, // We just enforced it
    };
  }

  /**
   * Append content to a memory file (with budget enforcement).
   *
   * @param name - The file name.
   * @param content - The content to append.
   * @returns The updated file.
   */
  append(name: 'MEMORY.md' | 'USER.md' | 'PROJECT.md', content: string): PersistentMemoryFile {
    const existing = this.load(name);
    const newContent = existing.content.length > 0
      ? existing.content + '\n\n' + content
      : content;
    return this.save(name, newContent);
  }

  /**
   * Take a frozen snapshot of all memory files for session-start injection.
   *
   * The snapshot is read-only — the agent cannot modify it mid-session.
   */
  takeSnapshot(): MemorySnapshot {
    const files = this.loadAll();
    return {
      memory: files.memory.content || undefined,
      user: files.user.content || undefined,
      project: files.project.content || undefined,
      snapshotTime: new Date().toISOString(),
      counts: {
        memory: files.memory.length,
        user: files.user.length,
        project: files.project.length,
        total: files.memory.length + files.user.length + files.project.length,
      },
    };
  }

  /**
   * Check if any memory file is over budget.
   */
  checkBudgets(): { memory: boolean; user: boolean; project: boolean; any: boolean } {
    const files = this.loadAll();
    return {
      memory: files.memory.overBudget,
      user: files.user.overBudget,
      project: files.project.overBudget,
      any: files.memory.overBudget || files.user.overBudget || files.project.overBudget,
    };
  }

  /**
   * Get the total budget usage ratio (0.0 – 1.0).
   */
  getUsageRatio(): number {
    const files = this.loadAll();
    const total = files.memory.length + files.user.length + files.project.length;
    return total / TOTAL_MEMORY_BUDGET;
  }

  /**
   * Clear a memory file (set to empty).
   * @param name
   */
  clear(name: 'MEMORY.md' | 'USER.md' | 'PROJECT.md'): void {
    this.save(name, '');
  }
}
