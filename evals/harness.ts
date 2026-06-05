import * as crypto from "node:crypto";
import * as path from "node:path";
import {
	AgentLoop,
	DEFAULT_CONFIG,
	type Session,
} from "../src/agent/AgentLoop.js";
import type { PromptConfig } from "../src/agent/SystemPrompt.js";
import { DiffManager } from "../src/diff/DiffManager.js";
import { Embedder } from "../src/indexer/embedder.js";
import { initDatabase } from "../src/indexer/initDb.js";
import { GeminiProvider } from "../src/providers/GeminiProvider.js";
import { MockProvider } from "../src/providers/MockProvider.js";
import type { ModelProvider } from "../src/providers/ModelProvider.js";
import { HybridRetriever } from "../src/retriever/search.js";
import { DockerSandbox } from "../src/sandbox/DockerSandbox.js";
import { SessionLogger } from "../src/telemetry/SessionLogger.js";
import { ToolRegistry } from "../src/tools/ToolRegistry.js";
import type { EvalRecord, EvalTask, Grade } from "./types.js";

export async function runTask(
	task: EvalTask,
	options: {
		model: string;
		maxTurns: number;
		sessionCostCap: number;
		promptConfig?: PromptConfig;
	},
): Promise<EvalRecord> {
	const sessionId = `eval-${crypto.randomUUID().substring(0, 8)}`;
	const logger = new SessionLogger(sessionId);
	const projectRoot = process.cwd();

	const sandbox = new DockerSandbox(projectRoot, "goli_cli-sandbox:v1");

	try {
		console.log(`\n[${task.task_id}] Initializing isolated sandbox...`);
		await sandbox.init();

		if (task.base_commit && task.base_commit !== "HEAD") {
			console.log(
				`[${task.task_id}] Resetting sandbox to commit ${task.base_commit.substring(0, 7)}`,
			);
			await sandbox.execute(
				`cd /workspace && git reset --hard ${task.base_commit}`,
			);
		}

		const apiKey = process.env.GEMINI_API_KEY || "mock-key";
		let provider: ModelProvider;

		if (process.env.GOLI_CLI_PROVIDER === "mock") {
			provider = new MockProvider([
				JSON.stringify([
					{
						name: "write_file",
						input: { path: "eval_test.txt", content: "harness v2 test" },
					},
				]),
				"The task is complete. DONE",
			]);
		} else {
			provider = new GeminiProvider(apiKey, options.model);
		}

		const compactModel = new GeminiProvider(apiKey, "gemini-flash-lite-latest");
		const embedder = new Embedder(provider);
		const idxPath = path.join(projectRoot, ".goli_cli", "index");
		const retriever = new HybridRetriever({ indexPath: idxPath });
		const diffManager = new DiffManager(projectRoot);

		const session: Session = {
			sessionId,
			model: options.model,
			model_provider: provider,
			compactModel,
			tools: {} as any,
			diffManager,
			logger,
			costUsd: 0,
			turns: 0,
			task: task.task_description,
			language: task.language,
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

		const tools = new ToolRegistry(
			sandbox,
			retriever,
			diffManager,
			projectRoot,
			session,
		);
		session.tools = tools;

		const agent = new AgentLoop({
			...DEFAULT_CONFIG,
			maxTurns: options.maxTurns,
			sessionCostCapUsd: options.sessionCostCap,
			autoApprove: true,
			...(options.promptConfig ? { promptConfig: options.promptConfig } : {}),
		});

		const result = await agent.run(task.task_description, session);

		const grade = await gradeResult(task, result, sandbox);

		return { task, result, grade, sessionId };
	} finally {
		await sandbox.destroy();
		logger.close();
	}
}

async function gradeResult(
	task: EvalTask,
	result: any,
	sandbox: DockerSandbox,
): Promise<Grade> {
	if (task.oracle_type === "test_suite") {
		const output = await sandbox.execute(task.oracle);
		const passed = !output.toLowerCase().includes("failed");
		return {
			passed,
			score: passed ? 1.0 : 0.0,
			reason: passed ? "Test suite passed" : "Test suite failed",
		};
	}

	if (result && result.status === "done") {
		return { passed: true, score: 1.0, reason: "Agent reported success" };
	}

	return { passed: false, score: 0, reason: result?.reason || "Agent failed" };
}
