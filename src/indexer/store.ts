import * as lancedb from "@lancedb/lancedb";
import * as path from "path";
import * as fs from "fs/promises";

export interface Chunk {
  file: string;
  startLine: number;
  endLine: number;
  text: string;
  vector: number[];
}

export class Store {
  private dbPath: string;
  private table?: lancedb.Table;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async init() {
    await fs.mkdir(this.dbPath, { recursive: true });
    const db = await lancedb.connect(this.dbPath);
    try {
      this.table = await db.openTable("chunks");
    } catch (e) {
      // Table doesn't exist, will be created on first index
    }
  }

  async hybridSearch(query: string, vector: number[], limit: number = 5): Promise<Chunk[]> {
    if (!this.table) return [];
    
    // Simplified: just vector search for now
    const results = await this.table
      .vectorSearch(vector)
      .limit(limit)
      .toArray();
      
    return results as unknown as Chunk[];
  }

  async addChunks(chunks: Chunk[]) {
    const db = await lancedb.connect(this.dbPath);
    if (!this.table) {
      this.table = await db.createTable("chunks", chunks as any, { mode: "overwrite" });
    } else {
      await this.table.add(chunks as any);
    }
  }
}
