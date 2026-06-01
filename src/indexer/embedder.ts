import { GoogleGenerativeAI } from "@google/generative-ai";

export class Embedder {
  private genAI: GoogleGenerativeAI;
  private model: any;

  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({ model: "gemini-embedding-2" });
  }

  async embed(text: string): Promise<number[]> {
    return this.withRetry(async () => {
        const result = await this.model.embedContent(text);
        return result.embedding.values;
    });
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    try {
      return await this.withRetry(async () => {
          const result = await this.model.batchEmbedContents({
            requests: texts.map(text => ({
              content: { parts: [{ text }] },
              taskType: "RETRIEVAL_DOCUMENT"
            }))
          });
          return result.embeddings.map((e: any) => e.values);
      });
    } catch (e) {
      console.warn("Batch embedding failed, falling back to individual resilient calls...");
      const results = [];
      for (let i = 0; i < texts.length; i++) {
          const text = texts[i];
          if (text) {
            results.push(await this.embed(text));
          }
      }
      return results;
    }
  }

  private async withRetry<T>(fn: () => Promise<T>, retries = 5): Promise<T> {
    let lastError: any;
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (e: any) {
            lastError = e;
            if (e.message?.includes("429") || e.status === 429) {
                const wait = Math.pow(2, i) * 1000 + Math.random() * 1000;
                console.log(`📡 Rate limit hit (429). Retrying in ${(wait/1000).toFixed(1)}s...`);
                await new Promise(resolve => setTimeout(resolve, wait));
                continue;
            }
            throw e;
        }
    }
    throw lastError;
  }
}
