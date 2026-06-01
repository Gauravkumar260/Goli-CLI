import { GeminiProvider } from "./providers/GeminiProvider";
import { ClaudeProvider } from "./providers/ClaudeProvider";
import { OllamaCloudProvider } from "./providers/OllamaCloudProvider";
import { MockProvider } from "./providers/MockProvider";
import { ToolRegistry } from "./tools/ToolRegistry";
import { Store } from "./indexer/store";
import { Embedder } from "./indexer/embedder";
import { DiffManager } from "./diff/DiffManager";
import { AgentLoop, type Session, DEFAULT_CONFIG } from "./agent/AgentLoop";
import { type ModelProvider } from "./providers/ModelProvider";
import { Retriever } from "./retriever/Retriever";
import { SessionLogger } from "./telemetry/SessionLogger";
import { SandboxPool } from "./sandbox/SandboxPool";
import { ConfigManager } from "./config/features";
import * as crypto from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import dotenv from "dotenv";

dotenv.config();

export interface RunOptions {
  plan?: boolean;
  auto?: boolean;
  apply?: boolean;
  model?: string;
  mock?: boolean;
}

export async function run(task: string, options: RunOptions = {}) {
  const config = new ConfigManager();
  await config.load();

  const providerType = options.mock ? "mock" : (process.env.GOLI_CLI_PROVIDER || "ollama-cloud");
  let provider: ModelProvider;
  let compactModel: ModelProvider;

  const geminiApiKey = config.getApiKey('gemini');
  const ollamaApiKey = config.getApiKey('ollama_cloud');
  const anthropicApiKey = config.getApiKey('anthropic');

  if (providerType === "mock") {
    console.log("🛠️ Using Mock Provider for End-to-End Test");
    provider = new MockProvider([
        JSON.stringify([{ name: "write_file", input: { path: "success.txt", content: "Chaos testing passed" } }]),
        "DONE"
    ]);
    compactModel = new MockProvider([JSON.stringify({ verdict: "SAFE", reason: "Mock pass", risk_category: "none" })]);
  } else if (providerType === "claude") {
    if (!anthropicApiKey) throw new Error("ANTHROPIC_API_KEY is not set. Use 'goli config set anthropic <key>'");
    provider = new ClaudeProvider(anthropicApiKey, options.model === "sonnet" ? "claude-3-5-sonnet-latest" : "claude-3-haiku-20240307");
    compactModel = new ClaudeProvider(anthropicApiKey, "claude-3-haiku-20240307");
  } else if (providerType === "ollama-cloud") {
    if (!ollamaApiKey) throw new Error("OLLAMA_API_KEY is not set. Use 'goli config set ollama_cloud <key>'");
    provider = new OllamaCloudProvider(ollamaApiKey, options.model || "gpt-oss:120b");
    compactModel = new OllamaCloudProvider(ollamaApiKey, "gpt-oss:120b");
  } else {
    if (!geminiApiKey) throw new Error("GEMINI_API_KEY is required. Use 'goli config set gemini <key>'");
    provider = new GeminiProvider(geminiApiKey, "gemini-flash-latest");
    compactModel = new GeminiProvider(geminiApiKey, "gemini-flash-lite-latest");
  }

  const projectRoot = process.cwd();

  try {
      const { execSync } = require('child_process');
      execSync('git rev-parse --is-inside-work-tree', { stdio: 'ignore' });
  } catch (e) {
      throw new Error("Goli-CLI requires a git repository for isolated execution. Please run 'git init' first.");
  }

  const sessionId = crypto.randomUUID().substring(0, 8);
  const logger = new SessionLogger(sessionId);
  const diffManager = new DiffManager(projectRoot);
  const store = new Store(projectRoot);
  const embedder = new Embedder(geminiApiKey || "mock-key");
  const retriever = new Retriever(store, embedder);

  const sandboxPool = new SandboxPool(projectRoot, "goli_cli-sandbox:v1");

  console.log(`\n🚀 Initializing Goli-CLI Session [${sessionId}]`);
  console.log("Provisioning sandbox...");
  const sandbox = await sandboxPool.acquire();

  try {
    const tools = new ToolRegistry(sandbox, retriever, diffManager, projectRoot);

    const session: Session = {
      sessionId,
      model: provider,
      compactModel,
      tools,
      diffManager,
      logger,
      costUsd: 0,
      task,
      language: "typescript"
    };

    const agent = new AgentLoop({
      ...DEFAULT_CONFIG,
      forcePlan: options.plan,
      autoApprove: options.auto,
    });

    const result = await agent.run(task, session);

    console.log("\n📊 Session complete. Extracting staged changes...");
    const diff = await sandbox.extractDiff();

    if (diff && diff.trim() !== "" && diff.trim() !== "(no changes)") {
      if (options.apply) {
          console.log("⚡ Auto-applying changes to host machine...");
          await sandbox.applyDiffToHost(diff);
          console.log("✅ Task completed and applied directly.");
      } else {
          const patchPath = path.join(projectRoot, ".goli_cli", "latest.patch");
          const metaPath = path.join(projectRoot, ".goli_cli", "session-meta.json");

          await fs.mkdir(path.dirname(patchPath), { recursive: true });
          await fs.writeFile(patchPath, diff, "utf8");

          const meta = {
              sessionId,
              task,
              language: session.language,
              model: (session.model as any).modelName || providerType,
              costUsd: session.costUsd,
              retrievedChunks: result.context.retrievedChunks,
              turns: result.context.messages.length / 2
          };
          await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), "utf8");

          console.log("\n──────────────────────────────────────────────────────────");
          console.log("📝 Staged changes available.");
          console.log("Run 'goli diff' to review or 'goli commit' to apply to host.");
          console.log("──────────────────────────────────────────────────────────");
      }
    }

    if (result.success) {
      console.log("\n✅ Task successful.");
    } else {
      console.error(`\n❌ Task failed: ${result.message}`);
    }

    console.log(`Final Cost: $${session.costUsd.toFixed(4)}`);
  } catch (e: any) {
    console.error(`\n💥 Fatal Error: ${e.message}`);
    logger.log({ turn: 0, type: 'failure', response: e.message });
  } finally {
    console.log("Cleaning up sandbox...");
    await sandbox.destroy();
    logger.close();
  }
}
