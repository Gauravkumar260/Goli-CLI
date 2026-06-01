import { DockerSandbox } from "../src/sandbox/DockerSandbox";
import { SessionLogger } from "../src/telemetry/SessionLogger";
import { AgentLoop, type Session, DEFAULT_CONFIG } from "../src/agent/AgentLoop";
import { type EvalTask, type EvalRecord, type Grade } from "./types";
import { GeminiProvider } from "../src/providers/GeminiProvider";
import { MockProvider } from "../src/providers/MockProvider";
import { ToolRegistry } from "../src/tools/ToolRegistry";
import { Store } from "../src/indexer/store";
import { Embedder } from "../src/indexer/embedder";
import { DiffManager } from "../src/diff/DiffManager";
import { Retriever } from "../src/retriever/Retriever";
import { type ModelProvider } from "../src/providers/ModelProvider";
import { type PromptConfig } from "../src/agent/systemPrompt";
import * as crypto from "crypto";

export async function runTask(
  task: EvalTask,
  options: { model: string; maxTurns: number; sessionCostCap: number; promptConfig?: PromptConfig }
): Promise<EvalRecord> {

  const sessionId = `eval-${crypto.randomUUID().substring(0, 8)}`;
  const logger = new SessionLogger(sessionId);
  const projectRoot = process.cwd();

  const sandbox = new DockerSandbox(projectRoot, "goli_cli-sandbox:v1");

  try {
    console.log(`\n[${task.task_id}] Initializing isolated sandbox...`);
    await sandbox.init();

    if (task.base_commit && task.base_commit !== "HEAD") {
        console.log(`[${task.task_id}] Resetting sandbox to commit ${task.base_commit.substring(0, 7)}`);
        await sandbox.execute(`cd /workspace && git reset --hard ${task.base_commit}`);
    }

    const apiKey = process.env.GEMINI_API_KEY || "mock-key";
    let provider: ModelProvider;

    if (process.env.GOLI_CLI_PROVIDER === "mock") {
        provider = new MockProvider([
            JSON.stringify([{ name: "write_file", input: { path: "eval_test.txt", content: "harness v2 test" } }]),
            "The task is complete. DONE"
        ]);
    } else {
        provider = new GeminiProvider(apiKey, options.model);
    }

    const compactModel = new GeminiProvider(apiKey, "gemini-flash-lite-latest");
    const embedder = new Embedder(apiKey);
    const store = new Store(projectRoot);
    const retriever = new Retriever(store, embedder);
    const diffManager = new DiffManager(projectRoot);

    const tools = new ToolRegistry(sandbox, retriever, diffManager, projectRoot);

    const session: Session = {
      sessionId,
      model: provider,
      compactModel,
      tools,
      diffManager,
      logger,
      costUsd: 0,
    };

    const agent = new AgentLoop({
      ...DEFAULT_CONFIG,
      maxTurns: options.maxTurns,
      sessionCostCapUsd: options.sessionCostCap,
      autoApprove: true,
      promptConfig: options.promptConfig
    });

    const result = await agent.run(task.task_description, session);

    const grade = await gradeResult(task, result, sandbox);

    return { task, result, grade, sessionId };

  } finally {
    await sandbox.destroy();
    logger.close();
  }
}

async function gradeResult(task: EvalTask, result: any, sandbox: DockerSandbox): Promise<Grade> {
    if (task.oracle_type === 'test_suite') {
        const output = await sandbox.execute(task.oracle);
        const passed = !output.toLowerCase().includes("failed");
        return {
            passed,
            score: passed ? 1.0 : 0.0,
            reason: passed ? "Test suite passed" : "Test suite failed"
        };
    }

    if (result && result.success) {
        return { passed: true, score: 1.0, reason: "Agent reported success" };
    }

    return { passed: false, score: 0, reason: result?.message || "Agent failed" };
}
