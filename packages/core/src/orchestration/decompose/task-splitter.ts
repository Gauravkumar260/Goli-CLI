/**
 * Task splitter (Module 7).
 *
 * Decomposes a task into subtasks, classifies them as independent or
 * dependent, and recommends an orchestration pattern.
 *
 * ## Decomposition heuristics
 *
 * - If the task mentions multiple files/features → multiple subtasks
 * - If subtasks touch the same file → dependent (force sequential)
 * - If subtasks touch hotspot files (package.json, Cargo.toml, etc.)
 *   → force sequential (collision risk)
 * - If all subtasks are independent → fan-out/fan-in (parallel)
 * - If subtasks are sequential → handoff (the 11-agent pipeline)
 *
 * @module orchestration/decompose/task-splitter
 */

import { randomUUID } from 'node:crypto';

import { DEFAULT_ORCHESTRATION_CONFIG } from '../types.js';

import type { AgentRole } from '../../agent/types.js';
import type { Subtask, TaskDecomposition, OrchestrationPattern } from '../types.js';

/** The TaskSplitter — decomposes tasks into subtasks. */
export class TaskSplitter {
  private readonly hotspotFiles: string[];

  constructor(opts: { hotspotFiles?: string[] } = {}) {
    this.hotspotFiles = opts.hotspotFiles ?? DEFAULT_ORCHESTRATION_CONFIG.hotspotFiles;
  }

  /**
   * Decompose a task into subtasks.
   * @param task
   */
  decompose(task: string): TaskDecomposition {
    const subtasks = this.extractSubtasks(task);
    const hotspotFiles = this.identifyHotspots(task, subtasks);
    const parallelRecommended = this.canParallelize(subtasks, hotspotFiles);
    const pattern = this.recommendPattern(task, subtasks, parallelRecommended);

    return {
      task,
      subtasks,
      pattern,
      parallelRecommended,
      hotspotFiles,
    };
  }

  /**
   * Extract subtasks from the task description.
   * @param task
   */
  private extractSubtasks(task: string): Subtask[] {
    const subtasks: Subtask[] = [];

    // Heuristic: look for "and", "then", "also", "after that" to split
    const parts = task
      .split(/\s+(?:and|then|also|after that|next|finally|additionally)\s+/i)
      .filter((p) => p.trim().length > 0);

    if (parts.length <= 1) {
      // Single task — no decomposition needed
      subtasks.push({
        id: randomUUID(),
        description: task,
        role: this.classifyRole(task),
        independent: true,
        dependsOn: [],
        expectedOutput: 'Completed task',
        priority: 1,
      });
      return subtasks;
    }

    // Multiple parts — create subtasks
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!.trim();
      const role = this.classifyRole(part);
      const touchesHotspot = this.hotspotFiles.some((f) => part.toLowerCase().includes(f.toLowerCase()));

      subtasks.push({
        id: randomUUID(),
        description: part,
        role,
        independent: i > 0 && !touchesHotspot, // First task is always sequential
        dependsOn: i > 0 ? [subtasks[i - 1]!.id] : [],
        expectedOutput: `Completed: ${part.slice(0, 60)}`,
        priority: parts.length - i, // Earlier = higher priority
      });
    }

    return subtasks;
  }

  /**
   * Classify the best agent role for a subtask.
   * @param description
   */
  private classifyRole(description: string): AgentRole {
    const d = description.toLowerCase();
    // Specificity-first ordering: check more specific roles
    // BEFORE broader ones. The previous implementation checked
    // `implement|write|...|fix` (implementer) and
    // `debug|fix|error` (debugger) BEFORE `test|spec|coverage|qa`
    // (qa-tester), so "fix the failing test" was classified as
    // 'debugger' (matched `fix`) instead of the more specific
    // 'qa-tester'. We now check qa-tester and security-auditor
    // before implementer/debugger.
    if (d.match(/explore|scan|map|understand|survey/)) return 'scout';
    if (d.match(/research|analyze|study|investigate/)) return 'researcher';
    if (d.match(/design|architect|plan|blueprint|strategy/)) return 'architect';
    if (d.match(/decompose|break down|todo|steps/)) return 'planner';
    // Specific roles first.
    if (d.match(/test|spec|coverage|qa/)) return 'qa-tester';
    if (d.match(/security|audit|vulnerab|secret/)) return 'security-auditor';
    if (d.match(/review|check|approve|inspect/)) return 'reviewer';
    if (d.match(/document|readme|docs?|comment/)) return 'documenter';
    // Broader roles.
    if (d.match(/implement|write|code|build|create|add|refactor/)) return 'implementer';
    if (d.match(/debug|fix|error|crash|trace|diagnose/)) return 'debugger';
    return 'orchestrator';
  }

  /**
   * Identify hotspot files mentioned in the task.
   * @param task
   * @param _subtasks
   */
  private identifyHotspots(task: string, _subtasks: Subtask[]): string[] {
    const taskLower = task.toLowerCase();
    return this.hotspotFiles.filter((f) => taskLower.includes(f.toLowerCase()));
  }

  /**
   * Check if subtasks can run in parallel.
   * @param subtasks
   * @param hotspotFiles
   */
  private canParallelize(subtasks: Subtask[], hotspotFiles: string[]): boolean {
    if (subtasks.length <= 1) return false;
    if (hotspotFiles.length > 0) return false; // Hotspot collision risk
    return subtasks.every((s) => s.independent);
  }

  /**
   * Recommend an orchestration pattern.
   * @param task
   * @param subtasks
   * @param parallelRecommended
   */
  private recommendPattern(
    task: string,
    subtasks: Subtask[],
    parallelRecommended: boolean,
  ): OrchestrationPattern {
    if (subtasks.length <= 1) return 'single-loop';
    if (parallelRecommended && subtasks.length >= 4) return 'fan-out-fan-in';
    if (subtasks.length >= 3 && subtasks.every((s) => !s.independent)) return 'handoff';
    // Use word boundaries + bounded distance between "pros" and
    // "cons" so "prosperous considerations" or "process consultants"
    // don't match. The previous implementation used greedy `.*`
    // which matched across the entire string.
    if (subtasks.length === 2 && task.match(/\bdebate\b|\bcompare\b|\bpros\b.{0,40}\bcons\b/i)) return 'debate';
    return 'handoff'; // Default to sequential pipeline
  }
}
