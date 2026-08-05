/**
 * External memory plugin — past-learnings recall.
 *
 * This plugin is the "external recall" tier of the memory system. It
 * searches past session learnings and locally-added entries using a
 * lightweight ranking algorithm.
 *
 * ## Honest naming (P3-5, audit Finding 5.27)
 *
 * The class is named `VectorMemoryPlugin` for backwards-compatibility
 * with the public API (`createMemorySystem` returns it as `external`),
 * but the search algorithm is NOT a real vector embedding similarity
 * search. It is a **TF-IDF-weighted lexical scorer** with cosine-like
 * normalization. This is faster, has zero native dependencies, and is
 * sufficient for the typical memory-recall workload (a few hundred
 * short entries).
 *
 * P3-5: we now export `TFIDFMemoryPlugin` as an ALIAS for
 * `VectorMemoryPlugin` so new callers can use the honest name. Old
 * callers keep working. The `name` property is also updated to
 * `'tfidf-memory'` (was `'vector-memory'`) so logs reflect the actual
 * algorithm. A real vector backend (LanceDB / hnswlib-node / sqlite-vec)
 * can be slotted in by replacing the `search` and `add` methods — the
 * interface is intentionally compatible with a future swap.
 *
 * @module memory/external/vector-plugin
 */

import type { SessionMemory } from '../session/ephemeral.js';
import type { ExternalMemoryPlugin, ExternalMemoryResult } from '../types.js';

/** Options for the VectorMemoryPlugin / TFIDFMemoryPlugin. */
export interface VectorMemoryPluginOptions {
  /** The session memory to search. */
  sessionMemory?: SessionMemory;
  /** Max locally-added entries (default: 10_000). Bounds memory use. */
  maxLocalEntries?: number;
}

/**
 * A ranked memory entry (content + precomputed term-frequency vector).
 */
interface RankedEntry {
  content: string;
  metadata?: Record<string, unknown>;
  /** Term frequencies: term → count. */
  termFreq: Map<string, number>;
  /** Magnitude of the term-frequency vector (for cosine normalization). */
  magnitude: number;
  /** When the entry was added (for recency boost). */
  addedAt: number;
}

/**
 * External memory plugin — searches past learnings via TF-IDF-weighted
 * lexical scoring (not real vector similarity).
 *
 * @module memory/external/vector-plugin
 */
export class VectorMemoryPlugin implements ExternalMemoryPlugin {
  // P3-5: renamed from 'vector-memory' to 'tfidf-memory' so logs
  // reflect the actual algorithm (TF-IDF, not vector embeddings).
  readonly name = 'tfidf-memory';
  private readonly sessionMemory?: SessionMemory;
  private readonly entries: RankedEntry[] = [];
  private readonly maxLocalEntries: number;
  /** Document frequency: term → number of entries containing it. */
  private readonly docFreq = new Map<string, number>();

  constructor(opts: VectorMemoryPluginOptions = {}) {
    this.sessionMemory = opts.sessionMemory;
    this.maxLocalEntries = opts.maxLocalEntries ?? 10_000;
  }

  /**
   * Tokenize a string into normalized terms for scoring.
   *
   * Splits on non-alphanumeric, lowercases, strips diacritics, and
   * drops very short tokens (≤2 chars) and pure-digit tokens. This
   * is intentionally simple — no stemming, no stopword list — to
   * keep the implementation dependency-free.
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '') // strip diacritics
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2 && !/^\d+$/.test(t));
  }

  /** Build a term-frequency vector + its magnitude from text. */
  private buildVector(text: string): { termFreq: Map<string, number>; magnitude: number } {
    const termFreq = new Map<string, number>();
    for (const term of this.tokenize(text)) {
      termFreq.set(term, (termFreq.get(term) ?? 0) + 1);
    }
    let magnitude = 0;
    for (const count of termFreq.values()) magnitude += count * count;
    magnitude = Math.sqrt(magnitude);
    return { termFreq, magnitude };
  }

  /**
   * Score a query vector against an entry vector using TF-IDF
   * cosine similarity.
   */
  private score(
    queryVec: Map<string, number>,
    queryMag: number,
    entry: RankedEntry,
    totalDocs: number,
  ): number {
    if (queryMag === 0 || entry.magnitude === 0) return 0;
    let dot = 0;
    // Iterate the smaller vector for speed.
    const [small, large] = queryVec.size < entry.termFreq.size
      ? [queryVec, entry.termFreq]
      : [entry.termFreq, queryVec];
    for (const [term, count] of small) {
      const other = large.get(term);
      if (other === undefined) continue;
      // IDF weighting: rarer terms contribute more.
      const df = this.docFreq.get(term) ?? 1;
      const idf = Math.log(1 + totalDocs / df);
      dot += count * other * idf;
    }
    // Cosine normalization. We skip dividing by idf-magnitude since
    // the IDF factor is constant per query (it doesn't change the
    // ranking, only the absolute score).
    return dot / (queryMag * entry.magnitude);
  }

  /**
   * Search past learnings.
   *
   * @param query - The search query.
   * @param topK - Max results to return.
   */
  async search(query: string, topK: number = 5): Promise<ExternalMemoryResult[]> {
    const results: ExternalMemoryResult[] = [];
    const { termFreq: queryVec, magnitude: queryMag } = this.buildVector(query);
    if (queryMag === 0) return [];

    // Total docs = local entries + session-memory entries (approx).
    const sessionEntries = this.sessionMemory?.getAll() ?? [];
    const totalDocs = this.entries.length + Math.max(1, sessionEntries.length);

    // Search session memory.
    for (const entry of sessionEntries) {
      const { termFreq, magnitude } = this.buildVector(entry.content);
      // Build a transient RankedEntry.
      const ranked: RankedEntry = {
        content: entry.content,
        metadata: { category: entry.category, timestamp: entry.timestamp, source: 'session' },
        termFreq,
        magnitude,
        addedAt: typeof entry.timestamp === 'string'
          ? Date.parse(entry.timestamp) || Date.now()
          : Date.now(),
      };
      const score = this.score(queryVec, queryMag, ranked, totalDocs);
      if (score > 0) {
        results.push({
          content: entry.content,
          score: Math.min(1.0, score),
          metadata: { category: entry.category, timestamp: entry.timestamp, source: 'session' },
        });
      }
    }

    // Search locally-added entries.
    for (const entry of this.entries) {
      const score = this.score(queryVec, queryMag, entry, totalDocs);
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
   *
   * @param content
   * @param metadata
   */
  async add(content: string, metadata?: Record<string, unknown>): Promise<void> {
    const { termFreq, magnitude } = this.buildVector(content);
    // Update document frequencies BEFORE capping the entries array
    // (so an evicted entry's terms are still counted until the next
    // rebuild). This is a slight over-count but is conservative
    // (it makes IDF smaller for those terms, which is safe).
    for (const term of termFreq.keys()) {
      this.docFreq.set(term, (this.docFreq.get(term) ?? 0) + 1);
    }
    this.entries.push({ content, metadata, termFreq, magnitude, addedAt: Date.now() });
    // Bound the entries array. Evict the OLDEST entry (FIFO).
    if (this.entries.length > this.maxLocalEntries) {
      const evicted = this.entries.shift();
      // We don't decrement docFreq — it would be O(terms) per evict
      // and we'd need a refcount. The slight over-count is acceptable.
      void evicted;
    }
  }

  /** Get the entry count. */
  get count(): number {
    return this.entries.length;
  }
}

/**
 * P3-5 (audit Finding 5.27): Honest-name alias for `VectorMemoryPlugin`.
 *
 * The class implements TF-IDF lexical scoring, NOT vector embeddings.
 * New callers should use `TFIDFMemoryPlugin`; `VectorMemoryPlugin` is
 * kept for backward compatibility. Both names refer to the same class.
 */
export const TFIDFMemoryPlugin = VectorMemoryPlugin;

