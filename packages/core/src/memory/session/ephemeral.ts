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

import type { SessionMemoryEntry, MemoryCategory } from '../types.js';

/**
 * Session memory — ephemeral store for within-session learnings.
 *
 * @module memory/session/ephemeral
 */
export class SessionMemory {
  private readonly entries: SessionMemoryEntry[] = [];

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

  /** Serialize to a summary string (for the curator). */
  summarize(): string {
    if (this.entries.length === 0) return '(no session memories)';
    const byCategory: Record<string, string[]> = {};
    for (const entry of this.entries) {
      const cat = entry.category;
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(entry.content);
    }
    const lines: string[] = [];
    for (const [cat, items] of Object.entries(byCategory)) {
      lines.push(`### ${cat} (${items.length})`);
      for (const item of items) {
        lines.push(`  - ${item}`);
      }
    }
    return lines.join('\n');
  }
}
