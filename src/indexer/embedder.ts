import { GoogleGenerativeAI } from "@google/generative-ai";

export class Embedder {
  private genAI: GoogleGenerativeAI;
  private model: any;

  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    // Using gemini-embedding-2 as discovered via API
    this.model = this.genAI.getGenerativeModel({ model: "gemini-embedding-2" });
  }

  async embed(text: string): Promise<number[]> {
    const result = await this.model.embedContent(text);
    return result.embedding.values;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // The SDK for Gemini 2.0 might use different batching. 
    // If batchEmbedContents fails, we fall back to Promise.all of individual calls.
    try {
      const result = await this.model.batchEmbedContents({
        requests: texts.map(text => ({ 
          content: { parts: [{ text }] },
          taskType: "RETRIEVAL_DOCUMENT" 
        }))
      });
      return result.embeddings.map((e: any) => e.values);
    } catch (e) {
      console.warn("Batch embedding failed, falling back to individual calls...");
      const results = await Promise.all(texts.map(text => this.embed(text)));
      return results;
    }
  }
}
