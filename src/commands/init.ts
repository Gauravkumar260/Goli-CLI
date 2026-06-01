import { glob } from "glob";
import * as fs from "fs/promises";
import * as path from "path";
import { CodeParser } from "../indexer/parser";
import { Embedder } from "../indexer/embedder";
import { Store, type Chunk } from "../indexer/store";

export async function init(projectRoot: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const parser = new CodeParser();
  const embedder = new Embedder(apiKey);
  const store = new Store(projectRoot);

  const files = await glob("**/*.{ts,py,go,tsx}", {
    cwd: projectRoot,
    ignore: ["node_modules/**", ".goli_cli/**", "dist/**", "build/**"],
  });

  console.log(`Found ${files.length} files to index.`);

  for (const file of files) {
    const filePath = path.join(projectRoot, file);
    const content = await fs.readFile(filePath, "utf-8");
    const ext = path.extname(file).slice(1);

    try {
      console.log(`Indexing ${file}...`);
      const tree = await parser.parse(content, ext);
      const chunks = parser.getChunks(tree, content);

      if (chunks.length === 0) continue;

      const texts = chunks.map(c => c.text);
      const embeddings = await embedder.embedBatch(texts);

      const storeChunks: Chunk[] = chunks.map((c, i) => ({
        vector: embeddings[i] || [], // Root fix: handle potential undefined
        text: c.text,
        file: file,
        startLine: c.startLine,
        endLine: c.endLine,
      }));

      await store.addChunks(storeChunks);
    } catch (e: any) {
      console.error(`Failed to index ${file}: ${e.message}`);
    }
  }

  await store.createFTSIndex();

  console.log("Indexing complete.");
}
