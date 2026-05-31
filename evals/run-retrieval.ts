import * as fs from "fs/promises";
import * as path from "path";
import { Embedder } from "../src/indexer/embedder";
import { Store } from "../src/indexer/store";
import { calculatePrecisionAtK } from "./metrics";
import dotenv from "dotenv";

dotenv.config();

async function main() {
  const projectRoot = process.cwd();
  const goldenSetPath = path.join(projectRoot, "evals", "golden-set.json");
  const goldenSet = JSON.parse(await fs.readFile(goldenSetPath, "utf-8"));

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const embedder = new Embedder(apiKey);
  const store = new Store(projectRoot);

  console.log(`\n--- Starting Retrieval Evaluation (${goldenSet.length} tasks) ---\n`);

  let totalPrecision = 0;

  for (const task of goldenSet) {
    console.log(`Task: ${task.description}`);
    
    const queryVector = await embedder.embed(task.description);
    const results = await store.search(queryVector, 10); // Look at top 10 chunks
    
    // Extract unique filenames from chunks
    const retrievedFiles = [...new Set(results.map(r => r.file))];
    
    const precision = calculatePrecisionAtK(task.expected_files, retrievedFiles, 5);
    totalPrecision += precision;

    console.log(`  Expected:  [${task.expected_files.join(", ")}]`);
    console.log(`  Retrieved: [${retrievedFiles.slice(0, 5).join(", ")}]`);
    console.log(`  Precision@5: ${precision.toFixed(2)}\n`);
  }

  const avgPrecision = totalPrecision / goldenSet.length;
  console.log(`--- Evaluation Complete ---`);
  console.log(`Average Precision@5: ${avgPrecision.toFixed(2)}`);

  if (avgPrecision >= 0.65) {
    console.log("✅ End-gate passed!");
  } else {
    console.log("❌ End-gate failed. Precision < 0.65.");
  }
}

main().catch(console.error);
