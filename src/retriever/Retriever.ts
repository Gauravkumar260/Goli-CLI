import { type Store, type Chunk } from "../indexer/store";
import { type Embedder } from "../indexer/embedder";

export interface RetrievedChunk extends Chunk {}

export class Retriever {
  constructor(
    private store: Store,
    private embedder: Embedder
  ) {}

  async search(query: string, topK: number = 5): Promise<RetrievedChunk[]> {
    const vector = await this.embedder.embed(query);
    return this.store.hybridSearch(query, vector, topK);
  }
}
