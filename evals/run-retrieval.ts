import * as fs from "fs/promises";
import * as path from "path";
import { Embedder } from "../src/indexer/embedder";
import { Store } from "../src/indexer/store";
import { calculatePrecisionAtK } from "./metrics";
import { type EvalTask } from "./types";
import dotenv from "dotenv";

dotenv.config();

async function main() {
  const projectRoot = process.cwd();
  const trainSplitPath = path.join(projectRoot, "evals", "splits", "train.json");
  const taskIds = JSON.parse(await fs.readFile(trainSplitPath, "utf-8")) as string[];
  
  const tasks: EvalTask[] = [];
  for (const id of taskIds) {
      let taskPath = path.join(projectRoot, "evals", "golden-set", "v1", `${id}.json`);
      const fssync = require('fs');
      if (!fssync.existsSync(taskPath)) {
          taskPath = path.join(projectRoot, "evals", "golden-set", "v2", `${id}.json`);
      }
      tasks.push(JSON.parse(await fs.readFile(taskPath, "utf-8")));
  }

  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) throw new Error("GEMINI_API_KEY is not set");

  const embedder = new Embedder(geminiApiKey);
  const store = new Store(projectRoot);

  console.log(`\n🧪 Starting Retrieval Evaluation (${tasks.length} tasks from TRAIN split)`);
  console.log("──────────────────────────────────────────────────────────");

  let totalPrecision = 0;

  for (const task of tasks) {
    const queryVector = await embedder.embed(task.task_description);
    const results = await store.hybridSearch(task.task_description, queryVector, 10);

    // Root Fix: Normalize paths to use forward slashes for cross-platform comparison
    const retrievedFiles = [...new Set(results.map(r => r.file.replace(/\\/g, '/')))];
    const expectedFiles = task.expected_files.map(f => f.replace(/\\/g, '/'));

    const precision = calculatePrecisionAtK(expectedFiles, retrievedFiles, 5);
    totalPrecision += precision;

    console.log(`[${task.task_id}] P@5: ${precision.toFixed(2)} | Task: ${task.task_description.substring(0, 50)}...`);
  }

  const avgPrecision = totalPrecision / tasks.length;
  console.log(`\n──────────────────────────────────────────────────────────`);
  console.log(`🏁 Eval Complete: Average Precision@5: ${avgPrecision.toFixed(2)}`);

  const evalLog = {
      avgPrecision,
      ts: new Date().toISOString()
  };
  await fs.writeFile(path.join(projectRoot, "evals", "latest-eval.json"), JSON.stringify(evalLog, null, 2), "utf8");

  if (avgPrecision >= 0.80) {
    console.log("✅ End-gate passed!");
  } else {
    console.log("❌ Average precision below threshold (0.80)");
    process.exit(1);
  }
}

async function fileExists(p: string) {
    try {
        await fs.access(p);
        return true;
    } catch {
        return false;
    }
}

main().catch(console.error);
