/**
 * External memory plugin (Tier 3) — vector DB recall.
 *
 * Uses the context engine's vector store (Phase 7 LanceDB, or the
 * session-memory-based stub) to search past session learnings.
 *
 * Phase 8 ships a stub that searches session memory. Phase 10
 * (trajectory logging) will wire this to a real vector store.
 *
 * @module memory/external/vector-plugin
 */

import type { SessionMemory } from '../session/ephemeral.js';
import type { ExternalMemoryPlugin, ExternalMemoryResult } from '../types.js';

/** Options for the VectorMemoryPlugin. */
export interface VectorMemoryPluginOptions {
  /** The session memory to search (Phase 8 stub). */
  sessionMemory?: SessionMemory;
}

/**
 * External memory plugin — searches past learnings via vector similarity.
 *
 * Phase 8: stub that searches session memory.
 * Phase 10: will use LanceDB for real vector search.
 *
 * @module memory/external/vector-plugin
 */
export class VectorMemoryPlugin implements ExternalMemoryPlugin {
  readonly name = 'vector-memory';
  private readonly sessionMemory?: SessionMemory;
  private readonly entries: Array<{ content: string; metadata?: Record<string, unknown> }> = [];

  constructor(opts: VectorMemoryPluginOptions = {}) {
    this.sessionMemory = opts.sessionMemory;
  }

  /**
   * Search the external memory.
   *
   * Phase 8: keyword-based search on session memory + locally-added entries.
   * Phase 10: vector similarity search via LanceDB.
   * @param query
   * @param topK
   */
  async search(query: string, topK: number = 5): Promise<ExternalMemoryResult[]> {
    const results: ExternalMemoryResult[] = [];
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 2);

    // Search session memory
    if (this.sessionMemory) {
      for (const entry of this.sessionMemory.getAll()) {
        const content = entry.content.toLowerCase();
        let score = 0;
        for (const word of queryWords) {
          if (content.includes(word)) {
            score += 0.15;
          }
        }
        if (score > 0) {
          results.push({
            content: entry.content,
            score: Math.min(1.0, score),
            metadata: { category: entry.category, timestamp: entry.timestamp, source: 'session' },
          });
        }
      }
    }

    // Search locally-added entries
    for (const entry of this.entries) {
      const content = entry.content.toLowerCase();
      let score = 0;
      for (const word of queryWords) {
        if (content.includes(word)) {
          score += 0.15;
        }
      }
      if (score > 0) {
        results.push({
          content: entry.content,
          score: Math.min(1.0, score),
          metadata: { ...entry.metadata, source: 'external' },
        });
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  /**
   * Add an entry to the external memory.
   * @param content
   * @param metadata
   */
  async add(content: string, metadata?: Record<string, unknown>): Promise<void> {
    this.entries.push({ content, metadata });
  }

  /** Get the entry count. */
  get count(): number {
    return this.entries.length;
  }
}
