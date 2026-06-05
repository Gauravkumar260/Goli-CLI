// src/indexer/embedder.ts
import type { ModelProvider } from "../providers/ModelProvider.js";

const BATCH_SIZE  = 32;    
const OLLAMA_MODEL = 'manutic/nomic-embed-code';

export const EMBEDDING_DIM = 768;   

export class Embedder {
  /**
   * @param provider Primary provider (might not support embeddings, e.g. Ollama Cloud)
   * @param fallbackProvider Optional fallback (e.g. Gemini) for embeddings
   */
  constructor(private provider: ModelProvider, private fallbackProvider?: ModelProvider) {}

  async embed(text: string): Promise<number[]> {
    // 1. Try local Ollama (0-cost)
    try {
        return await this.embedViaOllama([text]).then(res => res[0]!);
    } catch {
        // 2. Try primary provider
        try {
            return await this.provider.embed(text);
        } catch (err) {
            // 3. Try fallback provider (e.g. Gemini)
            if (this.fallbackProvider) {
                return await this.fallbackProvider.embed(text);
            }
            throw err;
        }
    }
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // 1. Try local Ollama
    try {
      return await this.embedViaOllama(texts);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      
      // 2. Try primary provider
      try {
          return await this.provider.embedBatch(texts);
      } catch (primaryErr: any) {
          // 3. Try fallback provider
          if (this.fallbackProvider) {
              process.stderr.write(
                `[goli] ⚠  Primary embedding failed (${primaryErr.message.slice(0, 40)}). Using fallback provider.\n`
              );
              return await this.fallbackProvider.embedBatch(texts);
          }
          
          process.stderr.write(
            `[goli] ⚠  nomic-embed-code unavailable (${reason.slice(0, 60)}). ` +
            `Falling back to provider-managed embeddings.\n`
          );
          throw primaryErr;
      }
    }
  }

  private async embedViaOllama(texts: string[]): Promise<number[][]> {
    const all: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const res = await fetch('http://localhost:11434/api/embed', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ model: OLLAMA_MODEL, input: batch }),
        signal:  AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
      const data = await res.json() as { embeddings: number[][] };
      all.push(...data.embeddings);
    }
    return all;
  }
}
