// src/commands/init.ts
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as readline from "node:readline/promises";
import { ConfigManager } from "../config/features.js";
import { Embedder } from "../indexer/embedder.js";
import { Indexer } from "../indexer/indexer.js";
import { createProvider } from "../providers/router.js";

export async function init(projectRoot: string): Promise<void> {
	const config = new ConfigManager();
	await config.load();

	const geminiApiKey = config.getApiKey("gemini") || process.env.GEMINI_API_KEY;
	const ollamaApiKey = config.getApiKey("ollama_cloud") || process.env.OLLAMA_API_KEY;

	if (!geminiApiKey) {
		throw new Error(
			"Indexing requires Gemini for embeddings. Use 'goli config set gemini <key>'",
		);
	}

	if (!config.isTelemetryPromptShown()) {
		console.log("\n📊 Telemetry & Privacy");
		console.log("──────────────────────────────────────────────────────────");
		console.log(
			"Goli-CLI can collect anonymous usage data to improve agent performance.",
		);
		console.log("This is OPT-IN only. No code, file names, or diffs are ever sent.");
		console.log("Details: docs/TELEMETRY.md");

		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
		});
		const answer = await rl.question("\nEnable anonymous telemetry? [y/N]: ");
		rl.close();

		const enabled = answer.trim().toLowerCase() === "y";
		config.setFeature("enable_telemetry", enabled);
		config.setTelemetryPromptShown(true);
		await config.save();
		console.log(
			`Telemetry ${enabled ? "ENABLED" : "DISABLED"}. You can change this anytime with 'goli feature'.\n`,
		);
	}

    // V2 Default Update: Use Ollama for the provider interface but Gemini for the actual indexing
	const provider = createProvider(ollamaApiKey ? "ollama/gpt-oss:120b" : "gemini/gemini-1.5-flash");
	const fallbackEmbedder = createProvider("gemini/gemini-1.5-flash-8b");
	
	const embedder = new Embedder(provider, fallbackEmbedder);
	const indexPath = path.join(projectRoot, ".goli_cli", "index");
	const indexer = new Indexer(projectRoot, indexPath, embedder);

	console.log(`🚀 Initializing index for ${projectRoot}`);
	const result = await indexer.indexFull();

	console.log(
		`\n✅ Indexing complete: ${result.chunksIndexed} chunks from ${result.filesProcessed} files in ${(result.durationMs / 1000).toFixed(1)}s`,
	);
	if (result.errors.length > 0) {
		console.warn(
			`⚠️  Encountered ${result.errors.length} errors during indexing. Check logs for details.`,
		);
	}
}
