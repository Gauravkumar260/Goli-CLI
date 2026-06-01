import { Store } from "../indexer/store";
import { Embedder } from "../indexer/embedder";
import dotenv from "dotenv";

dotenv.config();

export async function search(projectRoot: string, query: string, limit: number = 5) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const embedder = new Embedder(apiKey);
  const store = new Store(projectRoot);

  const queryVector = await embedder.embed(query);
  const results = await store.hybridSearch(query, queryVector, limit);

  if (results.length === 0) {
    console.log("No relevant code found.");
    return;
  }

  console.log(`\n🔍 Search results for: "${query}"`);
  results.forEach((result, i) => {
    console.log(`\n[${i + 1}] ${result.file}:${result.startLine}-${result.endLine}`);
    console.log("──────────────────────────────────────────────────────────");
    console.log(result.text);
    console.log("──────────────────────────────────────────────────────────");
  });
}
