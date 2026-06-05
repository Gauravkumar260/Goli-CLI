import * as fs from "node:fs/promises";
import * as path from "node:path";
import dotenv from "dotenv";
import { Embedder } from "../src/indexer/embedder.js";
import { GeminiProvider } from "../src/providers/GeminiProvider.js";
import { HybridRetriever } from "../src/retriever/search.js";
import { calculatePrecisionAtK } from "./metrics.js";
import type { EvalTask } from "./types.js";

dotenv.config();

async function runRetrievalEval() {
	const projectRoot = process.cwd();
	const apiKey = process.env.GEMINI_API_KEY;
	if (!apiKey) throw new Error("GEMINI_API_KEY required");

	const provider = new GeminiProvider(apiKey, "gemini-flash-latest");
	const embedder = new Embedder(provider);
	const idxPath = path.join(projectRoot, ".goli_cli", "index");
	const retriever = new HybridRetriever({ indexPath: idxPath });

	const tasksDir = path.join(projectRoot, "evals", "golden-set", "v1");
	const taskFiles = await fs.readdir(tasksDir);

	console.log("\n🧪 Goli-CLI Retrieval Evaluation");
	console.log(`Tasks: ${taskFiles.length}`);
	console.log("──────────────────────────────────────────────────────────");

	let totalPrecision = 0;

	for (const file of taskFiles) {
		const task = JSON.parse(
			await fs.readFile(path.join(tasksDir, file), "utf-8"),
		) as EvalTask;

		const results = await retriever.search(
			task.task_description,
			5,
			provider,
			embedder,
		);

		const expectedFiles = task.expected_files.map((f) => f.replace(/\\/g, "/"));
		const retrievedFiles = [
			...new Set(results.map((r: any) => r.file_path.replace(/\\/g, "/"))),
		];

		const precision = calculatePrecisionAtK(expectedFiles, retrievedFiles, 5);
		totalPrecision += precision;

		const status = precision > 0.5 ? "✅" : "🚧";
		console.log(
			`${status} [${task.task_id}] P@5: ${precision.toFixed(2)} | Query: ${task.task_description.substring(0, 50)}...`,
		);
	}

	const avgPrecision = totalPrecision / taskFiles.length;
	console.log("──────────────────────────────────────────────────────────");
	console.log(`🏁 Avg Precision@5: ${(avgPrecision * 100).toFixed(1)}%`);
	console.log("──────────────────────────────────────────────────────────\n");
}

runRetrievalEval().catch(console.error);
