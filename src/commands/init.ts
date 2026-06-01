import { glob } from "glob";
import * as fs from "fs/promises";
import * as path from "path";
import { CodeParser } from "../indexer/parser";
import { Embedder } from "../indexer/embedder";
import { Store, type Chunk } from "../indexer/store";
import { ConfigManager } from "../config/features";
import * as readline from "readline/promises";

export async function init(projectRoot: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const config = new ConfigManager();
  await config.load();

  if (!config.isTelemetryPromptShown()) {
      console.log("\n📊 Telemetry & Privacy");
      console.log("──────────────────────────────────────────────────────────");
      console.log("Goli-CLI can collect anonymous usage data to improve agent performance.");
      console.log("This is OPT-IN only. No code, file names, or diffs are ever sent.");
      console.log("Details: docs/TELEMETRY.md");
      
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await rl.question("\nEnable anonymous telemetry? [y/N]: ");
      rl.close();
      
      const enabled = answer.trim().toLowerCase() === 'y';
      config.setFeature('enable_telemetry', enabled);
      config.setTelemetryPromptShown(true);
      await config.save();
      console.log(`Telemetry ${enabled ? 'ENABLED' : 'DISABLED'}. You can change this anytime with 'goli-cli feature'.\n`);
  }

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
        vector: embeddings[i] || [],
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
