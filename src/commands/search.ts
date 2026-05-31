import { Embedder } from "../indexer/embedder";
import { Store } from "../indexer/store";

export async function search(projectRoot: string, query: string, limit: number = 5) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const embedder = new Embedder(apiKey);
  const store = new Store(projectRoot);

  console.log(`Searching for: "${query}"...`);
  const queryVector = await embedder.embed(query);
  const results = await store.search(queryVector, limit);

  if (results.length === 0) {
    console.log("No results found. Have you run 'apex init'?");
    return;
  }

  results.forEach((result, i) => {
    console.log(`\n[${i + 1}] ${result.file}:${result.startLine}-${result.endLine}`);
    console.log("---");
    console.log(result.text.slice(0, 300) + (result.text.length > 300 ? "..." : ""));
    console.log("---");
  });
}
