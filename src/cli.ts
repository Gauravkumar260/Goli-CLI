#!/usr/bin/env bun
import { Command } from "commander";
import dotenv from "dotenv";
import { verifyAudit } from "./commands/audit.js";
import { runDoctor } from "./commands/doctor.js";
import { evalStatus } from "./commands/eval-status.js";
import { init } from "./commands/init.js";
import { safetyStatus } from "./commands/safety.js";
import { search } from "./commands/search.js";
import { status } from "./commands/status.js";
import { workspaceInitCommand } from "./commands/workspace.js";
import { runConfigCommand, runFeatureCommand } from "./config/features.js";
import { run } from "./run.js";

dotenv.config();

const program = new Command();

program
	.name("goli")
	.description("Goli-CLI — Open-Core Model-Agnostic CLI Coding Agent")
	.version("0.1.0");

function wrapCommand(fn: (...args: any[]) => Promise<void>) {
	return async (...args: any[]) => {
		try {
			await fn(...args);
		} catch (error: any) {
			console.error(`Error: ${error.message}`);
			process.exit(1);
		}
	};
}

program
	.command("run")
	.description("Execute a natural language task")
	.argument("<task>", "The task to execute")
	.option("--plan", "Force execution planning")
	.option("--auto", "Skip confirmation prompts (YOLO mode)")
	.option("--apply", "Automatically apply changes to host on success")
	.option("--model <name>", "Override primary model")
	.option("--mock", "Use mock provider for testing")
	.action(
		wrapCommand(async (task, options) => {
			await run(task, options);
		}),
	);

program
	.command("init")
	.description("Index the current repository")
	.action(
		wrapCommand(async () => {
			await init(process.cwd());
		}),
	);

program
	.command("workspace")
	.description("Manage multi-repo workspaces")
	.argument("<name>", "Workspace name")
	.argument("[repos...]", "Repository paths")
	.action(
		wrapCommand(async (name, repos) => {
			await workspaceInitCommand(name, repos);
		}),
	);

program
	.command("status")
	.description("Show health dashboard and metrics")
	.action(
		wrapCommand(async () => {
			await status();
		}),
	);

program
	.command("doctor")
	.description("Check system health and dependencies")
	.action(
		wrapCommand(async () => {
			await runDoctor();
		}),
	);

program
	.command("config")
	.description("Manage global configuration and API keys")
	.argument("[action]", "set")
	.argument("[provider]", "gemini|anthropic|ollama_cloud")
	.argument("[key]", "API key value")
	.action(
		wrapCommand(async (action, provider, key) => {
			await runConfigCommand([action, provider, key]);
		}),
	);

program
	.command("feature")
	.description("Manage experimental feature flags")
	.argument("[action]", "list|enable|disable")
	.argument("[name]", "Feature flag name")
	.action(
		wrapCommand(async (action, name) => {
			await runFeatureCommand([action, name]);
		}),
	);

const evalCmd = program
	.command("eval")
	.description("Evaluation and benchmarking tools");

evalCmd
	.command("status")
	.description("Show evaluation dashboard and trajectory metrics")
	.action(
		wrapCommand(async () => {
			await evalStatus();
		}),
	);

program
	.command("safety")
	.description("Show safety dashboard and audit integrity")
	.action(
		wrapCommand(async () => {
			await safetyStatus();
		}),
	);

program
	.command("search")
	.description("Search the repository for code")
	.argument("<query>", "The search query")
	.option("-l, --limit <number>", "Number of results", "5")
	.action(
		wrapCommand(async (query, options) => {
			await search(process.cwd(), query, Number.parseInt(options.limit, 10));
		}),
	);

program
	.command("audit [subcommand]")
	.description("Audit log operations")
	.action(
		wrapCommand(async (subcommand) => {
			if (subcommand === "verify") await verifyAudit();
			else console.log("Usage: goli audit verify");
		}),
	);

program.parse();
