import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ConfigManager } from "../config/features.js";
import { Embedder } from "../indexer/embedder.js";
// src/commands/workspace.ts
import { Indexer } from "../indexer/indexer.js";
import { initDatabase } from "../indexer/initDb.js";
import { GeminiProvider } from "../providers/GeminiProvider.js";
import { HybridRetriever } from "../retriever/search.js";

interface WorkspaceConfig {
	name: string;
	repos: Array<{ id: string; path: string }>;
}

function workspacePath(name: string): string {
	return path.join(os.homedir(), ".goli", "workspaces", name);
}

export async function workspaceInitCommand(
	name: string,
	repos: string[],
): Promise<void> {
	const config: WorkspaceConfig = {
		name,
		repos: repos.map((p, i) => ({
			id: `${name}-${i + 1}`,
			path: path.resolve(p),
		})),
	};

	for (const repo of config.repos) {
		if (!fs.existsSync(path.join(repo.path, ".git"))) {
			console.error(`Not a git repository: ${repo.path}`);
			process.exit(1);
		}
	}

	const confManager = new ConfigManager();
	await confManager.load();
	const apiKey = confManager.getApiKey("gemini") || process.env.GEMINI_API_KEY;
	if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

	const idxPath = workspacePath(name);
	if (!fs.existsSync(idxPath)) {
		fs.mkdirSync(idxPath, { recursive: true });
	}
	await initDatabase(idxPath);

	const provider = new GeminiProvider(apiKey, "gemini-flash-latest");
	const embedder = new Embedder(provider);

	for (const repo of config.repos) {
		console.log(`\nIndexing ${repo.id} (${repo.path})...`);
		const indexer = new Indexer(repo.path, idxPath, embedder, repo.id);
		const result = await indexer.indexFull();
		console.log(
			`  ✓ ${result.chunksIndexed} chunks in ${(result.durationMs / 1000).toFixed(1)}s`,
		);
	}

	fs.writeFileSync(
		path.join(idxPath, "workspace.json"),
		JSON.stringify(config, null, 2),
	);
	console.log(`\n✅ Workspace "${name}" ready`);
	console.log(`   Search: goli search --workspace ${name} "<query>"`);
}

export function getWorkspaceRetriever(name: string): HybridRetriever {
	const idxPath = workspacePath(name);
	if (!fs.existsSync(idxPath)) {
		throw new Error(
			`Workspace "${name}" not found. Run: goli workspace init ${name} <repo1> <repo2>`,
		);
	}
	return new HybridRetriever({ indexPath: idxPath });
}
