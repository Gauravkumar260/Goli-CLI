import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import dotenv from "dotenv";
import { AgentLoop, DEFAULT_CONFIG } from "./agent/AgentLoop.js";
import { HITLManager } from "./agent/HITLManager.js";
import { ConfigManager } from "./config/features.js";
import type { RunOptions, Session } from "./config/types.js";
import { DiffManager } from "./diff/DiffManager.js";
import { Embedder } from "./indexer/embedder.js";
import {
	createCompactModel,
	createProvider,
	selectModelTier,
} from "./providers/router.js";
import { HybridRetriever } from "./retriever/search.js";
import { ActionGate } from "./safety/ActionGate.js";
import { SandboxPool } from "./sandbox/SandboxPool.js";
import { SessionLogger } from "./telemetry/SessionLogger.js";
import { ToolRegistry } from "./tools/ToolRegistry.js";

dotenv.config();

export async function run(
	task: string,
	options: RunOptions = {},
): Promise<void> {
	const config = new ConfigManager();
	await config.load();

	const projectRoot = process.cwd();
	const sessionId = crypto.randomUUID().substring(0, 8);
	const logger = new SessionLogger(sessionId);

	const modelSpec = selectModelTier(task, 0, 0, options.model);
	const provider = createProvider(modelSpec);
	const compactModel = createCompactModel();

	const embedder = new Embedder(provider, compactModel);
	const idxPath = path.join(projectRoot, ".goli_cli", "index");
	const retriever = new HybridRetriever({ indexPath: idxPath });
	const diffManager = new DiffManager(projectRoot);
	const sandboxPool = new SandboxPool(projectRoot, "goli_cli-sandbox:v1");

	console.log(`\n🚀 Initializing Goli-CLI Session [${sessionId}]`);
	const sandbox = await sandboxPool.acquire();

	try {
		const session: Session = {
			sessionId,
			task,
			repoRoot: projectRoot,
			language: "typescript",
			model: modelSpec,
			turns: 0,
			costUsd: 0,
			safetyDenialCount: 0,
			goliCLIMd: "",
			logger,
			model_provider: provider,
			compactModel,
			retriever,
			embedder,
			diffManager,
			sandbox,
			telemetry: {},
			// These will be initialized properly
			tools: {} as any,
			actionGate: {} as any,
			hitl: {} as any,
		};

		session.tools = new ToolRegistry(
			sandbox,
			retriever,
			diffManager,
			projectRoot,
			session,
		);
		session.actionGate = new ActionGate(session);
		session.hitl = new HITLManager();

		const agent = new AgentLoop({
			...DEFAULT_CONFIG,
			...(options.auto !== undefined ? { autoApprove: options.auto } : {}),
		});

		const _result = await agent.run(task, session);

		console.log("\n📊 Session complete.");
		const diff = await sandbox.execute("git diff HEAD");

		if (diff && diff.trim().length > 0) {
			const patchPath = path.join(projectRoot, ".goli_cli", "latest.patch");
			await fs.mkdir(path.dirname(patchPath), { recursive: true });
			await fs.writeFile(patchPath, diff, "utf8");
			console.log(`📝 Patch saved to ${patchPath}`);
		}
	} finally {
		await sandbox.destroy();
		logger.close();
	}
}
