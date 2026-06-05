import { randomUUID } from "node:crypto";
import { Octokit } from "@octokit/rest";
import { DockerSandbox } from "../src/sandbox/DockerSandbox.js";
import { SessionLogger } from "../src/telemetry/SessionLogger.js";
import {
	AgentLoop,
	type Session,
	DEFAULT_CONFIG,
} from "../src/agent/AgentLoop.js";
import { ToolRegistry } from "../src/tools/ToolRegistry.js";
import { Embedder } from "../src/indexer/embedder.js";
import { DiffManager } from "../src/diff/DiffManager.js";
import { HybridRetriever } from "../src/retriever/search.js";
import { GeminiProvider } from "../src/providers/GeminiProvider.js";
import * as path from "node:path";

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const REPO_OWNER = process.env.GITHUB_REPO_OWNER ?? "your-username";
const REPO_NAME = process.env.GITHUB_REPO_NAME ?? "goli-cli";

async function runDailyAudit() {
	console.log(`\n🛡️  Goli-CLI Daily Audit: ${new Date().toLocaleString()}`);

	const tasks = [
		"Find TypeScript files in src/ that have no corresponding .test.ts file and list them",
		"Check package.json dependencies: list any packages with major version updates available",
	];

	const findings = [];
	const projectRoot = process.cwd();
	const apiKey = process.env.GEMINI_API_KEY!;
	const provider = new GeminiProvider(apiKey, "gemini-flash-lite-latest");

	for (const task of tasks) {
		const sessionId = `audit-${randomUUID().substring(0, 8)}`;
		const logger = new SessionLogger(sessionId);
		const sandbox = new DockerSandbox(projectRoot);
		const embedder = new Embedder(provider);
		const idxPath = path.join(projectRoot, ".goli_cli", "index");
		const retriever = new HybridRetriever({ indexPath: idxPath });
		const diffManager = new DiffManager(projectRoot);

		try {
			await sandbox.init();

			const tools = new ToolRegistry(
				sandbox,
				retriever,
				diffManager,
				projectRoot,
				{} as any,
			);
			const session: Session = {
				sessionId,
				model: "gemini-flash-lite-latest",
				model_provider: provider,
				compactModel: provider,
				tools,
				diffManager,
				logger,
				costUsd: 0,
				turns: 0,
				task,
				language: "typescript",
				repoRoot: projectRoot,
				goliCLIMd: "",
				safetyDenialCount: 0,
				actionGate: {} as any,
				hitl: {} as any,
				retriever: retriever,
				embedder: embedder,
				telemetry: {} as any,
				sandbox,
			};
			(tools as any).session = session;

			const agent = new AgentLoop({ ...DEFAULT_CONFIG, maxTurns: 10 });
			const result = await agent.run(task, session);

			if (
				result.status === "done" &&
				result.answer &&
				result.answer.length > 50
			) {
				findings.push({ task, message: result.answer });
			}
		} catch (e: any) {
			console.error(`Audit task failed: ${e.message}`);
		} finally {
			await sandbox.destroy();
			logger.close();
		}
	}

	if (findings.length > 0 && process.env.GITHUB_TOKEN) {
		for (const item of findings) {
			await octokit.rest.issues.create({
				owner: REPO_OWNER,
				repo: REPO_NAME,
				title: `[audit] ${item.task.slice(0, 60)}`,
				body: item.message || "No details provided",
				labels: ["automated-audit"],
			});
		}
	}

	console.log(`Daily audit complete: ${findings.length} findings.`);
}

runDailyAudit().catch(console.error);
