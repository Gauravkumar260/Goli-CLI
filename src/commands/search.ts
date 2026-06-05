import * as path from "node:path";
import dotenv from "dotenv";
import { ConfigManager } from "../config/features.js";
import { Embedder } from "../indexer/embedder.js";
import { createProvider } from "../providers/router.js";
import { HybridRetriever } from "../retriever/search.js";

dotenv.config();

export async function search(
	projectRoot: string,
	query: string,
	limit = 5,
): Promise<void> {
	const config = new ConfigManager();
	await config.load();

	// V2 Default Update: Use router to select primary provider (defaults to Ollama)
	// and provide Gemini as fallback for embeddings
	const ollamaApiKey =
		config.getApiKey("ollama_cloud") || process.env.OLLAMA_API_KEY;
	const geminiApiKey = config.getApiKey("gemini") || process.env.GEMINI_API_KEY;

	if (!ollamaApiKey && !geminiApiKey) {
		throw new Error(
			"No API keys found. Run 'goli config set ollama_cloud <key>' or 'goli config set gemini <key>'",
		);
	}

	const provider = createProvider(
		ollamaApiKey ? "ollama/gpt-oss:120b" : "gemini/gemini-1.5-flash",
	);

	let fallbackEmbedder: any;
	if (geminiApiKey) {
		fallbackEmbedder = createProvider("gemini/gemini-1.5-flash-8b");
	}

	const embedder = new Embedder(provider, fallbackEmbedder);

	const idxPath = path.join(projectRoot, ".goli_cli", "index");
	const retriever = new HybridRetriever({ indexPath: idxPath });

	const results = await retriever.search(query, limit, provider, embedder);

	if (!results || results.length === 0) {
		console.log("No relevant code found.");
		return;
	}

	console.log(`\n🔍 Search results for: "${query}"`);
	for (let i = 0; i < results.length; i++) {
		const r = results[i];
		if (r) {
			console.log(`\n[${i + 1}] ${r.file_path}:${r.start_line}-${r.end_line}`);
			console.log("──────────────────────────────────────────────────────────");
			console.log(r.content);
			console.log("──────────────────────────────────────────────────────────");
		}
	}
}
