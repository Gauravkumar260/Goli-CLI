/**
 * Session memory (Tier 1) — ephemeral, cleared per session.
 *
 * Stores in-session learnings that haven't been curated into persistent
 * memory yet. The curator runs at session end to extract learnings and
 * update the persistent files.
 *
 * @module memory/session/ephemeral
 */

import { randomUUID } from 'node:crypto';

import type { MemoryCategory } from '../types.js';
import type { SessionMemoryEntry } from '../types.js';

/**
 * Session memory — ephemeral store for within-session learnings.
 *
 * @module memory/session/ephemeral
 */
export class SessionMemory {
  /**
   * Bound on the entries array. The previous implementation grew the
   * array without bound — a long-running session that recorded an
   * entry per tool call could accumulate tens of thousands of entries,
   * each ~200 bytes, totaling multiple MB of retained strings. We
   * now cap at 1000 entries (configurable via constructor option) and
   * evict the OLDEST entry when full.
   */
  private readonly maxEntries: number;
  private readonly entries: SessionMemoryEntry[] = [];

  constructor(opts: { maxEntries?: number } = {}) {
    this.maxEntries = opts.maxEntries ?? 1000;
  }

  /**
   * Record a new memory entry.
   * @param content
   * @param category
   */
  record(content: string, category: MemoryCategory = 'learning'): SessionMemoryEntry {
    const entry: SessionMemoryEntry = {
      id: randomUUID(),
      content,
      category,
      timestamp: new Date().toISOString(),
    };
    this.entries.push(entry);
    // Bound the array — evict the OLDEST entry (FIFO) when over cap.
    while (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
    return entry;
  }

  /** Get all entries. */
  getAll(): SessionMemoryEntry[] {
    return [...this.entries];
  }

  /**
   * Get entries by category.
   * @param category
   */
  getByCategory(category: MemoryCategory): SessionMemoryEntry[] {
    return this.entries.filter((e) => e.category === category);
  }

  /**
   * Get recent entries (last N).
   * @param n
   */
  getRecent(n: number): SessionMemoryEntry[] {
    return this.entries.slice(-n);
  }

  /**
   * Search entries by keyword.
   * @param query
   */
  search(query: string): SessionMemoryEntry[] {
    const q = query.toLowerCase();
    return this.entries.filter((e) => e.content.toLowerCase().includes(q));
  }

  /** Clear all entries. */
  clear(): void {
    this.entries.length = 0;
  }

  /** Get the entry count. */
  get count(): number {
    return this.entries.length;
  }

  /**
   * Serialize to a summary string (for the curator).
   *
   * The previous implementation included every entry verbatim — a
   * 1000-entry session produced a 200KB summary string that blew
   * the curator's context window. We now cap each category at 50
   * items (configurable) and emit a "and N more" footer so the
   * curator sees a representative sample without drowning.
   */
  summarize(): string {
    if (this.entries.length === 0) return '(no session memories)';
    const MAX_PER_CATEGORY = 50;
    const byCategory: Record<string, string[]> = {};
    for (const entry of this.entries) {
      const cat = entry.category;
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(entry.content);
    }
    const lines: string[] = [];
    for (const [cat, items] of Object.entries(byCategory)) {
      const shown = items.slice(-MAX_PER_CATEGORY); // keep the NEWEST
      const omitted = items.length - shown.length;
      lines.push(`### ${cat} (${items.length})`);
      for (const item of shown) {
        lines.push(`  - ${item}`);
      }
      if (omitted > 0) {
        lines.push(`  ... and ${omitted} older ${cat} entr${omitted === 1 ? 'y' : 'ies'} omitted (use getByCategory('${cat}') to see all).`);
      }
    }
    return lines.join('\n');
  }
}
