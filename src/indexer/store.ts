import * as lancedb from "@lancedb/lancedb";
import * as path from "path";
import { Reranker } from "./reranker";      

export interface Chunk {
  vector: number[];
  text: string;
  file: string;
  startLine: number;
  endLine: number;
}

export class Store {
  private db: lancedb.Connection | null = null;
  private table: lancedb.Table | null = null;
  private dbPath: string;

  constructor(projectRoot: string) {
    this.dbPath = path.join(projectRoot, ".apex", "lancedb");
  }

  async connect() {
    this.db = await lancedb.connect(this.dbPath);
    try {
      this.table = await this.db.openTable("chunks");
    } catch (e) {
      this.table = null;
    }
  }

  async addChunks(chunks: Chunk[]) {
    if (!this.db) await this.connect();

    if (!this.table) {
      this.table = await this.db!.createTable("chunks", chunks);
    } else {
      await this.table.add(chunks);
    }
  }

  async createFTSIndex() {
    if (!this.db) await this.connect();
    if (!this.table) return;

    console.log("Creating FTS index...");
    try {
        await this.table.createIndex("text");
    } catch (e: any) {
        if (!e.message.includes("already exists")) {
            throw e;
        }
    }
  }

  async hybridSearch(query: string, vector: number[], limit: number = 5): Promise<Chunk[]> {
    if (!this.db) await this.connect();
    if (!this.table) {
        console.warn("Table 'chunks' not found in LanceDB.");
        return [];
    }

    try {
      const initialLimit = limit * 4;
      const results = await this.table
        .search(query)
        .vectorSearch(vector)
        .rerank(new lancedb.rerankers.RRFReranker())
        .limit(initialLimit)
        .toArray();

      const chunks = results as unknown as Chunk[];

      if (chunks.length > 0 && process.env.ENABLE_RERANKER === 'true') {
        const reranker = new Reranker();
        const docs = chunks.map(c => c.text);
        const scores = await reranker.rerank(query, docs);

        const reranked = chunks
          .map((c, i) => ({ chunk: c, score: scores[i] }))
          .sort((a, b) => b.score - a.score)
          .map(item => item.chunk);

        return reranked.slice(0, limit);
      }

      return chunks.slice(0, limit);
    } catch (e: any) {
      console.warn("Hybrid search failed:", e.message);
      return this.search(vector, limit);
    }
  }

  async search(vector: number[], limit: number = 5): Promise<Chunk[]> {
    if (!this.db) await this.connect();
    if (!this.table) return [];

    try {
      const results = await this.table
        .vectorSearch(vector)
        .limit(limit)
        .toArray();

      return results as unknown as Chunk[];
    } catch (e: any) {
      console.error("Vector search error:", e.message);
      return [];
    }
  }

  async getRepoMap(): Promise<string> {
    if (!this.db) await this.connect();
    if (!this.table) return "No index available.";

    try {
      // Get unique files and their first few lines as a map
      const results = await this.table.query().limit(100).toArray();
      const files = new Set<string>();
      results.forEach((r: any) => files.add(r.file));
      
      let map = "Files indexed:\n";
      Array.from(files).slice(0, 20).forEach(f => map += `- ${f}\n`);
      if (files.size > 20) map += `... and ${files.size - 20} more files.\n`;
      
      return map;
    } catch (e: any) {
      return "Error generating repo map: " + e.message;
    }
  }
}
