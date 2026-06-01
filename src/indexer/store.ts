import * as lancedb from "@lancedb/lancedb";
import * as path from "path";

export interface Chunk {
  vector: number[];
  text: string;
  file: string;
  startLine: number;
  endLine: number;
  score?: number;
}

export class Store {
  private db: lancedb.Connection | null = null;
  private table: lancedb.Table | null = null;
  private dbPath: string;

  constructor(projectRoot: string) {
    this.dbPath = path.join(projectRoot, ".goli_cli", "lancedb");
  }

  async connect() {
    if (!this.db) {
      this.db = await lancedb.connect(this.dbPath);
    }
  }

  async addChunks(chunks: Chunk[]) {
    await this.connect();

    const data = chunks.map(c => ({ ...c }));

    if (!this.table) {
      try {
        this.table = await this.db!.openTable("chunks");
      } catch {
        this.table = await this.db!.createTable("chunks", data);
        return;
      }
    }
    await this.table.add(data);
  }

  async hybridSearch(_query: string, vector: number[], limit: number = 5): Promise<Chunk[]> {
    await this.connect();
    
    // Root fix: Ensure table is opened in search path
    if (!this.table) {
        try {
            this.table = await this.db!.openTable("chunks");
        } catch (e) {
            return [];
        }
    }

    try {
      const results = await this.table
        .query()
        .nearestTo(vector)
        .limit(limit)
        .toArray();

      return results.map(r => ({
          vector: r.vector as number[],
          text: r.text as string,
          file: r.file as string,
          startLine: r.startLine as number,
          endLine: r.endLine as number,
          score: (r as any)._distance
      })) as Chunk[];
    } catch (e: any) {
      console.error("Vector search error:", e.message);
      return [];
    }
  }

  async createFTSIndex() {
    await this.connect();
    if (!this.table) {
        try { this.table = await this.db!.openTable("chunks"); } catch {}
    }
    if (this.table) {
        try {
            await this.table.createIndex("text", {
                config: lancedb.Index.fts()
            });
        } catch (e: any) {
            console.warn("FTS Index creation not supported or failed:", e.message);
        }
    }
  }
}
