export class Reranker {
  private ollamaUrl: string;
  private model: string;

  constructor(model: string = "bbjson/bge-reranker-base", ollamaUrl: string = "http://localhost:11434") {
    this.model = model;
    this.ollamaUrl = ollamaUrl;
  }

  async rerank(query: string, documents: string[]): Promise<number[]> {
    try {
      const scores = await Promise.all(documents.map(async (doc) => {
        const response = await fetch(`${this.ollamaUrl}/api/generate`, {
          method: 'POST',
          body: JSON.stringify({
            model: this.model,
            prompt: `Query: ${query}\nDocument: ${doc}\nScore the relevance from 0 to 1:`,
            stream: false
          })
        });
        const json: any = await response.json();
        const score = parseFloat(json.response.trim());
        return isNaN(score) ? 0 : score;
      }));
      return scores;
    } catch (e) {
      console.warn("Reranking failed:", e);
      return documents.map(() => 0);
    }
  }
}
