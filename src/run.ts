import { GeminiProvider } from "./providers/GeminiProvider";
import { ClaudeProvider } from "./providers/ClaudeProvider";
import { MockProvider } from "./providers/MockProvider";
import { ToolRegistry } from "./tools/ToolRegistry";
import { Store } from "./indexer/store";
import { Embedder } from "./indexer/embedder";
import { DiffManager } from "./diff/DiffManager";
import { AgentLoop, Session, DEFAULT_CONFIG } from "./agent/AgentLoop";
import { ModelProvider } from "./providers/ModelProvider";
import { Retriever } from "./retriever/Retriever";
import { SessionLogger } from "./telemetry/SessionLogger";
import { SandboxPool } from "./sandbox/SandboxPool";
import * as crypto from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import dotenv from "dotenv";

dotenv.config();

export interface RunOptions {
  plan?: boolean;
  auto?: boolean;
  model?: string;
  mock?: boolean;
}

export async function run(task: string, options: RunOptions = {}) {
  const providerType = options.mock ? "mock" : (process.env.APEX_PROVIDER || "gemini");
  let provider: ModelProvider;
  let compactModel: ModelProvider;

  const geminiApiKey = process.env.GEMINI_API_KEY;

  if (providerType === "mock") {
    console.log("🛠️ Using Mock Provider for End-to-End Test");
    provider = new MockProvider([
      JSON.stringify([
        { name: "list_directory", input: { path: "." } },
        { name: "write_file", input: { path: "success.txt", content: "APEX Phase 5 Staging Verified" } }
      ]),
      "The task is complete. DONE"
    ]);
    compactModel = new MockProvider(["Summary: Mock compaction."]);
  } else if (providerType === "claude") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set for Claude provider");
    provider = new ClaudeProvider(apiKey, options.model === "sonnet" ? "claude-3-5-sonnet-latest" : "claude-3-haiku-20240307");
    compactModel = new ClaudeProvider(apiKey, "claude-3-haiku-20240307");
  } else {
    if (!geminiApiKey) throw new Error("GEMINI_API_KEY is required");
    provider = new GeminiProvider(geminiApiKey, "gemini-flash-latest");
    compactModel = new GeminiProvider(geminiApiKey, "gemini-flash-lite-latest");
  }

  const projectRoot = process.cwd();
  const sessionId = crypto.randomUUID().substring(0, 8);
  const logger = new SessionLogger(sessionId);
  const diffManager = new DiffManager(projectRoot);
  const store = new Store(projectRoot);
  const embedder = new Embedder(geminiApiKey || "mock-key");
  const retriever = new Retriever(store, embedder);
  
  // Root fix: Pass correct Phase 5 image to SandboxPool
  const sandboxPool = new SandboxPool(projectRoot, "apex-sandbox:v1");

  console.log(`\n🚀 Initializing APEX Session [${sessionId}]`);
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
      const patchPath = path.join(projectRoot, ".apex", "latest.patch");
      await fs.mkdir(path.dirname(patchPath), { recursive: true });
      await fs.writeFile(patchPath, diff, "utf8");
      
      console.log("\n──────────────────────────────────────────────────────────");
      console.log("📝 Staged changes available.");
      console.log("Run 'apex diff' to review or 'apex commit' to apply to host.");
      console.log("──────────────────────────────────────────────────────────");
    } else {
      console.log("No changes staged.");
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
