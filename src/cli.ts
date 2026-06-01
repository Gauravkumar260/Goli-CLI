#!/usr/bin/env bun
import { Command } from "commander";
import { run } from "./run";
import { init } from "./commands/init";
import { search } from "./commands/search";
import { diff } from "./commands/diff";
import { commit } from "./commands/commit";
import { status } from "./commands/status";
import { usage } from "./commands/usage";
import { replay } from "./commands/replay";
import { verifyAudit } from "./commands/audit";
import { safetyStatus } from "./commands/safety";
import { evalStatus } from "./commands/eval-status";
import { runDoctor } from "./commands/doctor";
import { runFeatureCommand, runConfigCommand } from "./config/features";
import { runFeedbackCommand } from "./commands/feedback";
import { checkMaturity } from "./commands/maturity";
import dotenv from "dotenv";

dotenv.config();

const program = new Command();

program
  .name("goli")
  .description("Goli-CLI — Open-Core Model-Agnostic CLI Coding Agent")
  .version("0.1.0");

program
  .command("run")
  .description("Execute a natural language task")
  .argument("<task>", "The task to execute")
  .option("--plan", "Force execution planning")
  .option("--auto", "Skip confirmation prompts (YOLO mode)")
  .option("--apply", "Automatically apply changes to host on success")
  .option("--model <name>", "Override primary model (haiku|sonnet|flash)")
  .option("--mock", "Use mock provider for testing")
  .action(async (task, options) => {
    try {
      await run(task, options);
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command("init")
  .description("Index the current repository")
  .action(async () => {
    try {
      await init(process.cwd());
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command("status")
  .description("Show health dashboard and metrics")
  .action(async () => {
    try {
      await status();
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command("maturity")
  .description("Check project maturity and road to Level 2")
  .action(async () => {
    try {
      await checkMaturity();
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command("doctor")
  .description("Check system health and dependencies")
  .action(async () => {
      try {
          await runDoctor();
      } catch (error: any) {
          console.error(`Error: ${error.message}`);
          process.exit(1);
      }
  });

program
  .command("config")
  .description("Manage global configuration and API keys")
  .argument("[action]", "set")
  .argument("[provider]", "gemini|anthropic|ollama_cloud")
  .argument("[key]", "API key value")
  .action(async (action, provider, key) => {
      try {
          await runConfigCommand([action, provider, key]);
      } catch (error: any) {
          console.error(`Error: ${error.message}`);
          process.exit(1);
      }
  });

program
  .command("feature")
  .description("Manage experimental feature flags")
  .argument("[action]", "list|enable|disable")
  .argument("[name]", "Feature flag name")
  .action(async (action, name) => {
      try {
          await runFeatureCommand([action, name]);
      } catch (error: any) {
          console.error(`Error: ${error.message}`);
          process.exit(1);
      }
  });

program
  .command("feedback")
  .description("Provide feedback on recent agent performance")
  .action(async () => {
      try {
          await runFeedbackCommand();
      } catch (error: any) {
          console.error(`Error: ${error.message}`);
          process.exit(1);
      }
  });

const evalCmd = program.command("eval").description("Evaluation and benchmarking tools");

evalCmd
  .command("status")
  .description("Show evaluation dashboard and trajectory metrics")
  .action(async () => {
    try {
      await evalStatus();
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command("safety")
  .description("Show safety dashboard and audit integrity")
  .action(async () => {
    try {
      await safetyStatus();
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command("audit")
  .description("Verify the integrity of the audit trail")
  .action(async () => {
    try {
      await verifyAudit();
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command("usage")
  .description("Show model usage and cost breakdown")
  .action(async () => {
    try {
      await usage();
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command("replay")
  .description("Replay a past session from telemetry")
  .argument("<sessionId>", "The session ID to replay")
  .action(async (sessionId) => {
    try {
      await replay(sessionId);
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command("search")
  .description("Search the repository for code")
  .argument("<query>", "The search query")
  .option("-l, --limit <number>", "Number of results", "5")
  .action(async (query, options) => {
    try {
      await search(process.cwd(), query, parseInt(options.limit));
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command("diff")
  .description("Show pending changes")
  .action(async () => {
    try {
      await diff(process.cwd());
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command("commit")
  .description("Apply pending changes and commit")
  .action(async () => {
    try {
      await commit(process.cwd());
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

program.parse();
