import { Command } from "commander";
import { run } from "./run";
import { init } from "./commands/init";
import { search } from "./commands/search";
import { diff } from "./commands/diff";
import { commit } from "./commands/commit";
import { status } from "./commands/status";
import { usage } from "./commands/usage";
import { replay } from "./commands/replay";
import dotenv from "dotenv";

dotenv.config();

const program = new Command();

program
  .name("apex")
  .description("APEX — Open-Core Model-Agnostic CLI Coding Agent")
  .version("0.1.0");

program
  .command("run")
  .description("Execute a natural language task")
  .argument("<task>", "The task to execute")
  .option("--plan", "Force execution planning")
  .option("--auto", "Skip confirmation prompts (YOLO mode)")
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
