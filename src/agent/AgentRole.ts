// src/agent/AgentRole.ts
import type { ModelSpec } from "../providers/router.js";

export type AgentRole =
	| "orchestrator"
	| "planner"
	| "implementer"
	| "scout"
	| "compaction";

export interface RoleConfig {
	role: AgentRole;
	systemSuffix: string;
	allowedTools: string[] | "all";
	maxTurns: number;
	modelSpec: ModelSpec;
}

export const ROLE_CONFIGS: Record<AgentRole, RoleConfig> = {
	orchestrator: {
		role: "orchestrator",
		systemSuffix: `You are the orchestrating agent. Your job is to:
1. Understand the full scope of the task
2. Break it into sub-tasks with clear file scopes
3. Delegate each sub-task by specifying: task description + target files
4. Synthesize sub-agent results into a final answer
You do NOT write code. You plan, delegate, and synthesize.`,
		allowedTools: [
			"search_code",
			"read_file",
			"list_directory",
			"git_status",
			"git_diff",
		],
		maxTurns: 10,
		modelSpec: "gemini/gemini-2.0-flash",
	},

	planner: {
		role: "planner",
		systemSuffix: `You are the planning agent. Given a task, output a JSON plan.
Format: { "steps": [{ "id": "1", "description": "...", "files": ["..."], "rationale": "...", "dependsOn": [] }] }
Keep steps atomic — each step touches at most 2-3 files.
Output ONLY the JSON. No prose.`,
		allowedTools: ["search_code", "read_file", "list_directory"],
		maxTurns: 5,
		modelSpec: "gemini/gemini-2.0-flash-lite",
	},

	implementer: {
		role: "implementer",
		systemSuffix: `You are an implementation agent working on a specific sub-task.
You have been given a focused task and the files in your scope.
Do NOT modify files outside your scope. Do NOT call git_commit.
When your sub-task is complete, stop and write a brief summary.`,
		allowedTools: "all",
		maxTurns: 20,
		modelSpec: "gemini/gemini-2.0-flash",
	},

	scout: {
		role: "scout",
		systemSuffix: `You are a read-only scouting agent. Your job is to explore the codebase
and answer specific questions about structure, patterns, and dependencies.
You may NEVER write files or execute shell commands.
Output a structured summary of your findings.`,
		allowedTools: ["search_code", "read_file", "list_directory", "git_status"],
		maxTurns: 8,
		modelSpec: "gemini/gemini-2.0-flash-lite",
	},

	compaction: {
		role: "compaction",
		systemSuffix:
			"Summarize the agent session history. Be precise. 300 words max.",
		allowedTools: [],
		maxTurns: 1,
		modelSpec: "gemini/gemini-2.0-flash-lite",
	},
};
