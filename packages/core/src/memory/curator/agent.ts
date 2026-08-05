/**
 * Memory curator agent (Module 5, part 1).
 *
 * Runs at session end. Extracts learnings from session memory and
 * updates the persistent memory files (MEMORY.md, USER.md, PROJECT.md)
 * within their character budgets.
 *
 * ## What the curator does
 *
 * 1. Reads all session memory entries (Tier 1)
 * 2. Classifies each entry: which file does it belong to?
 *    - `preference` → USER.md
 *    - `fact` / `decision` / `bug` about the project → PROJECT.md
 *    - `learning` / `context` → MEMORY.md
 * 3. Deduplicates against existing persistent content
 * 4. Prioritizes: high-priority new entries replace low-priority old ones
 * 5. Writes back within budget (truncates from the end if over budget)
 *
 * ## Why a curator (not direct writes)?
 *
 * If the agent writes to persistent memory mid-session, it can:
 * - Rewrite its own constraints (safety risk)
 * - Flood the files with low-value entries
 * - Create inconsistencies between sessions
 *
 * The curator runs ONCE at session end, with a clear view of what
 * was learned, and can make informed curation decisions.
 *
 * @module memory/curator/agent
 */

import type { Logger } from '../../utils/logger.js';
import type { PersistentMemory } from '../persistent/files.js';
import type { SessionMemoryEntry, CuratedLearning, MemoryCategory } from '../types.js';

/** Options for the MemoryCurator. */
export interface MemoryCuratorOptions {
  /** The persistent memory manager. */
  persistentMemory: PersistentMemory;
  /** Logger instance. */
  logger?: Logger;
  /** Optional LLM client for AI-assisted curation. */
  llmClient?: {
    call: (params: {
      messages: Array<{ role: string; content: string; timestamp: string }>;
      effort?: string;
    }) => Promise<{ content: string }>;
  };
}

/**
 * Memory curator — extracts learnings and updates persistent memory.
 *
 * @module memory/curator/agent
 */
export class MemoryCurator {
  private readonly persistent: PersistentMemory;
  private readonly log?: Logger;

  constructor(opts: MemoryCuratorOptions) {
    this.persistent = opts.persistentMemory;
    this.log = opts.logger;
    // glmClient reserved for Phase 10 (AI-assisted curation)
    // this.glmClient = opts.glmClient;
  }

  /**
   * Run the curator on session-end memory entries.
   *
   * @param sessionEntries - The session memory entries to curate.
   * @returns A summary of what was curated.
   */
  async curate(sessionEntries: SessionMemoryEntry[]): Promise<{
    curated: number;
    written: number;
    files: { memory: number; user: number; project: number };
  }> {
    if (sessionEntries.length === 0) {
      return { curated: 0, written: 0, files: { memory: 0, user: 0, project: 0 } };
    }

    this.log?.info('Curating session memory', { entryCount: sessionEntries.length });

    // Classify each entry
    const learnings = this.classifyEntries(sessionEntries);

    // Deduplicate against existing content
    const existing = this.persistent.loadAll();
    const deduped = this.deduplicate(learnings, existing);

    // Write to the appropriate files
    const memoryEntries = deduped.filter((l) => l.targetFile === 'MEMORY');
    const userEntries = deduped.filter((l) => l.targetFile === 'USER');
    const projectEntries = deduped.filter((l) => l.targetFile === 'PROJECT');

    let memoryWritten = 0;
    let userWritten = 0;
    let projectWritten = 0;

    if (memoryEntries.length > 0) {
      const updated = this.mergeIntoFile(existing.memory.content, memoryEntries);
      this.persistent.save('MEMORY.md', updated);
      memoryWritten = memoryEntries.length;
    }

    if (userEntries.length > 0) {
      const updated = this.mergeIntoFile(existing.user.content, userEntries);
      this.persistent.save('USER.md', updated);
      userWritten = userEntries.length;
    }

    if (projectEntries.length > 0) {
      const updated = this.mergeIntoFile(existing.project.content, projectEntries);
      this.persistent.save('PROJECT.md', updated);
      projectWritten = projectEntries.length;
    }

    const totalWritten = memoryWritten + userWritten + projectWritten;

    this.log?.info('Curation complete', {
      curated: learnings.length,
      written: totalWritten,
      memoryWritten,
      userWritten,
      projectWritten,
    });

    return {
      curated: learnings.length,
      written: totalWritten,
      files: {
        memory: memoryWritten,
        user: userWritten,
        project: projectWritten,
      },
    };
  }

  /**
   * Classify session entries into target files.
   * @param entries
   */
  private classifyEntries(entries: SessionMemoryEntry[]): CuratedLearning[] {
    return entries.map((entry) => {
      const targetFile = this.classifyTargetFile(entry.category, entry.content);
      const priority = this.assessPriority(entry);
      return {
        content: entry.content,
        category: entry.category,
        targetFile,
        priority,
      };
    });
  }

  /**
   * Classify which file an entry belongs to.
   * @param category
   * @param content
   */
  private classifyTargetFile(
    category: MemoryCategory,
    content: string,
  ): 'MEMORY' | 'USER' | 'PROJECT' {
    // User preferences → USER.md
    if (category === 'preference') return 'USER';

    // Project-specific facts/decisions/bugs → PROJECT.md
    if (category === 'fact' || category === 'decision' || category === 'bug') {
      // Check if it mentions project-specific things
      if (content.match(/(?:this repo|this project|the codebase|src\/|packages\/)/i)) {
        return 'PROJECT';
      }
      return 'MEMORY';
    }

    // General learnings and context → MEMORY.md
    return 'MEMORY';
  }

  /**
   * Assess the priority of an entry (1-10).
   * @param entry
   */
  private assessPriority(entry: SessionMemoryEntry): number {
    let priority = 5; // Default

    // Bugs are high priority
    if (entry.category === 'bug') priority = 8;
    // Decisions are high priority
    if (entry.category === 'decision') priority = 7;
    // Preferences are medium-high
    if (entry.category === 'preference') priority = 6;
    // Facts are medium
    if (entry.category === 'fact') priority = 5;
    // Learnings are medium-low
    if (entry.category === 'learning') priority = 4;
    // Context is low (ephemeral)
    if (entry.category === 'context') priority = 2;

    // Longer entries are usually more important
    if (entry.content.length > 100) priority = Math.min(10, priority + 1);

    return priority;
  }

  /**
   * Deduplicate learnings against existing file content.
   * @param learnings
   * @param existing
   * @param existing.memory
   * @param existing.memory.content
   * @param existing.user
   * @param existing.user.content
   * @param existing.project
   * @param existing.project.content
   */
  private deduplicate(
    learnings: CuratedLearning[],
    existing: { memory: { content: string }; user: { content: string }; project: { content: string } },
  ): CuratedLearning[] {
    return learnings.filter((learning) => {
      const existingContent =
        learning.targetFile === 'MEMORY'
          ? existing.memory.content
          : learning.targetFile === 'USER'
            ? existing.user.content
            : existing.project.content;

      // Check if the content is already present (substring match)
      const normalized = learning.content.toLowerCase().trim();
      const existingLower = existingContent.toLowerCase();

      // Skip if exact match or very similar (first 50 chars match)
      if (existingLower.includes(normalized)) return false;
      if (normalized.length > 50 && existingLower.includes(normalized.slice(0, 50))) return false;

      return true;
    });
  }

  /**
   * Merge new learnings into an existing file's content.
   *
   * Strategy: PREPEND new entries as a "## Recent Learnings" section
   * at the TOP of the file. The previous implementation appended
   * new learnings to the END of the file as a new section — but
   * `PersistentMemory.save` (in persistent/files.ts) truncates
   * from the END when over budget. So the newest learnings — the
   * ones just curated — were the first to be truncated. The
   * curator's strategy directly contradicted the budget
   * enforcement strategy. Over multiple sessions, the file
   * accumulated many `## Recent Learnings` sections, and the
   * oldest ones (at the top) survived while the newest (at the
   * bottom) got truncated. We now PREPEND so the newest learnings
   * survive budget truncation (oldest-at-the-bottom gets
   * truncated first, which is the LRU direction).
   * @param existingContent
   * @param learnings
   */
  private mergeIntoFile(existingContent: string, learnings: CuratedLearning[]): string {
    if (learnings.length === 0) return existingContent;

    // Sort by priority (highest first)
    const sorted = [...learnings].sort((a, b) => b.priority - a.priority);

    // Format new entries
    const newSection = sorted
      .map((l) => `- [${l.category}] ${l.content}`)
      .join('\n');

    if (existingContent.length === 0) {
      return `## Recent Learnings\n${newSection}`;
    }

    // PREPEND the new section to the existing content so the
    // newest learnings are at the TOP. The bottom of the file
    // (the oldest learnings) gets truncated first when over
    // budget, which is the LRU direction.
    return `## Recent Learnings\n${newSection}\n\n${existingContent}`;
  }
}
