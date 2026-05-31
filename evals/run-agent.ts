import * as fs from "fs/promises";
import * as path from "path";
import { GeminiProvider } from "../src/providers/GeminiProvider";
import { ToolRegistry } from "../src/tools/ToolRegistry";
import { Store } from "../src/indexer/store";
import { Embedder } from "../src/indexer/embedder";
import { DiffManager } from "../src/diff/DiffManager";
import { AgentLoop, Session, DEFAULT_CONFIG } from "../src/agent/AgentLoop";
import { Retriever } from "../src/retriever/Retriever";
import { SessionLogger } from "../src/telemetry/SessionLogger";
import { SandboxPool } from "../src/sandbox/SandboxPool";
import * as crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();

async function main() {
  const projectRoot = process.cwd();
  const goldenSetPath = path.join(projectRoot, "evals", "golden-set.json");
  const goldenSet = JSON.parse(await fs.readFile(goldenSetPath, "utf-8"));

  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) throw new Error("GEMINI_API_KEY is not set");

  const provider = new GeminiProvider(geminiApiKey, "gemini-flash-latest");
  const compactModel = new GeminiProvider(geminiApiKey, "gemini-flash-lite-latest");
  const embedder = new Embedder(geminiApiKey);
  const store = new Store(projectRoot);
  const retriever = new Retriever(store, embedder);
  const sandboxPool = new SandboxPool(projectRoot);

  console.log(`\n🧪 Starting Agent Evaluation (${goldenSet.length} tasks)`);
  console.log("──────────────────────────────────────────────────────────");

  let successCount = 0;

  for (const task of goldenSet) {
    const sessionId = `eval-${crypto.randomUUID().substring(0, 8)}`;
    const logger = new SessionLogger(sessionId);
    const diffManager = new DiffManager(projectRoot);
    const sandbox = await sandboxPool.acquire();

    console.log(`\n[${task.id}] Task: ${task.description}`);

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

    const config = {
      ...DEFAULT_CONFIG,
      maxTurns: 10, // Capped for eval speed
      autoApprove: true, // Crucial for non-interactive eval
    };

    const agent = new AgentLoop(config);

    try {
      const result = await agent.run(task.description, session);
      
      // Simple validation: did the agent reach DONE?
      if (result.success) {
        successCount++;
        console.log(`✅ [${task.id}] PASSED`);
      } else {
        console.log(`❌ [${task.id}] FAILED: ${result.message}`);
      }
    } catch (e: any) {
      console.error(`💥 [${task.id}] CRASHED: ${e.message}`);
    } finally {
      await sandbox.destroy();
      logger.close();
    }
  }

  console.log("\n──────────────────────────────────────────────────────────");
  console.log(`🏁 Eval Complete: ${successCount}/${goldenSet.length} tasks passed.`);
  const passRate = (successCount / goldenSet.length) * 100;
  console.log(`📈 Pass Rate: ${passRate.toFixed(1)}%`);
  console.log("──────────────────────────────────────────────────────────\n");
}

main().catch(console.error);
