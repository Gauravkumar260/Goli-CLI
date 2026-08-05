/**
 * Memory system types (Module 5, part 1).
 *
 * Defines the 3-tier memory model:
 * - Tier 1: Session memory (ephemeral, cleared per session)
 * - Tier 2: Persistent memory (MEMORY.md, USER.md, PROJECT.md — frozen snapshot)
 * - Tier 3: External memory (vector DB plugin)
 *
 * @module memory/types
 */

/** The three memory tiers. */
export type MemoryTier = 'session' | 'persistent' | 'external';

/** A single memory entry (for session memory). */
export interface SessionMemoryEntry {
  /** Unique ID. */
  id: string;
  /** The memory content (a fact, preference, or learning). */
  content: string;
  /** When the memory was recorded (ISO 8601). */
  timestamp: string;
  /** The category of memory. */
  category: MemoryCategory;
}

/** The category of a session memory entry. */
export type MemoryCategory =
  | 'fact' // A fact learned about the codebase
  | 'preference' // A user preference
  | 'decision' // An architectural decision
  | 'bug' // An unresolved bug
  | 'learning' // A general learning
  | 'context'; // Context for the current task

/** The persistent memory files and their character budgets. */
export interface PersistentMemoryFile {
  /** The file name (e.g. 'MEMORY.md'). */
  name: string;
  /** The file content (markdown). */
  content: string;
  /** The character budget (max length). */
  budget: number;
  /** The actual content length. */
  length: number;
  /** Whether the content exceeds the budget. */
  overBudget: boolean;
}

/** The frozen snapshot of persistent memory injected at session start. */
export interface MemorySnapshot {
  /** The MEMORY.md content (general agent memory). */
  memory?: string;
  /** The USER.md content (user preferences). */
  user?: string;
  /** The PROJECT.md content (project context). */
  project?: string;
  /** When the snapshot was taken (ISO 8601). */
  snapshotTime: string;
  /** The character counts at snapshot time. */
  counts: {
    memory: number;
    user: number;
    project: number;
    total: number;
  };
}

/**
 * The memory file character budgets (Hermes pattern).
 *
 * Round-2 verification item #7: previously had only `{MEMORY, USER,
 * PROJECT}` — no budget for the skills L1 fragment. The functional
 * workaround was `BasePromptContext.skillsL1` (added in P1-4), which
 * let the SystemPromptAssembler render the L1 metadata without a
 * formal budget constant. We now add `SKILLS_L1` so callers that
 * want to enforce budgets programmatically (e.g. `PersistentMemory`
 * or a future budget tracker) have a single source of truth for all
 * memory-tier budgets.
 */
export const MEMORY_BUDGETS = {
  /** MEMORY.md: ~800 tokens = ~3200 chars, budget 2200 to be safe. */
  MEMORY: 2200,
  /** USER.md: ~500 tokens = ~2000 chars, budget 1375. */
  USER: 1375,
  /** PROJECT.md: ~700 tokens = ~2800 chars, budget 2000. */
  PROJECT: 2000,
  /**
   * Skills L1 metadata: ~10 skills × ~100 tokens = ~1000 chars,
   * budget 800 to leave room for the "Available skills:" header and
   * surrounding formatting. Cap is enforced by the SystemPromptAssembler
   * (which renders the L1 metadata via `SkillLoader.formatL1ForPrompt()`).
   */
  SKILLS_L1: 800,
} as const;

/** The total budget across all files. */
export const TOTAL_MEMORY_BUDGET =
  MEMORY_BUDGETS.MEMORY +
  MEMORY_BUDGETS.USER +
  MEMORY_BUDGETS.PROJECT +
  MEMORY_BUDGETS.SKILLS_L1;

/** An external memory plugin (Tier 3). */
export interface ExternalMemoryPlugin {
  /** The plugin name. */
  name: string;
  /** Search the external memory. */
  search(query: string, topK?: number): Promise<ExternalMemoryResult[]>;
  /** Add an entry to the external memory. */
  add(content: string, metadata?: Record<string, unknown>): Promise<void>;
}

/** A result from external memory search. */
export interface ExternalMemoryResult {
  /** The content. */
  content: string;
  /** The relevance score (0.0 – 1.0). */
  score: number;
  /** Metadata. */
  metadata?: Record<string, unknown>;
}

/** A learning extracted by the curator at session end. */
export interface CuratedLearning {
  /** The learning content. */
  content: string;
  /** The category. */
  category: MemoryCategory;
  /** Which file to write to (MEMORY, USER, or PROJECT). */
  targetFile: 'MEMORY' | 'USER' | 'PROJECT';
  /** The priority (higher = more important to keep). */
  priority: number;
}
