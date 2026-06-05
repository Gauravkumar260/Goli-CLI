import type {
	AgentSession,
	RetrievedChunk,
	ToolCall,
	ToolResult,
} from "../config/types.js";
import type { DiffManager } from "../diff/DiffManager.js";
import { formatChunksForContext } from "../retriever/format.js";
import type { HybridRetriever as Retriever } from "../retriever/search.js";
import type { Sandbox } from "../sandbox/Sandbox.js";
// src/tools/ToolRegistry.ts
import { buildTestCommand } from "./testCommand.js";

export type { ToolCall, ToolResult };

export const TIER_1 = new Set([
	"read_file",
	"read_file_lines",
	"list_directory",
	"search_code",
	"git_diff",
	"git_status",
	"git_create_branch",
]);
export const TIER_3 = new Set(["shell_exec", "git_commit", "delete_file"]);

export const TOOL_SCHEMAS = [
	{
		name: "read_file",
		description:
			"Read the complete contents of a file. Use this to understand existing code before modifying it.",
		parameters: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: "File path relative to repo root",
				},
			},
			required: ["path"],
		},
	},
	{
		name: "read_file_lines",
		description:
			"Read a specific line range from a file. Use when you only need part of a large file.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string" },
				start_line: { type: "number" },
				end_line: { type: "number" },
			},
			required: ["path", "start_line", "end_line"],
		},
	},
	{
		name: "list_directory",
		description:
			"List files and directories. Use when the file structure is not clear from the startup context.",
		parameters: {
			type: "object",
			properties: { path: { type: "string", default: "." } },
		},
	},
	{
		name: "search_code",
		description:
			"Semantic hybrid search over the indexed codebase. Use BEFORE editing to find where a symbol or pattern is defined. Returns top-K code chunks with file paths and line numbers.",
		parameters: {
			type: "object",
			properties: {
				query: { type: "string" },
				top_k: { type: "number", default: 5 },
			},
			required: ["query"],
		},
	},
	{
		name: "git_diff",
		description:
			"Show git diff. Use to review what has changed in the current session.",
		parameters: {
			type: "object",
			properties: { staged: { type: "boolean", default: false } },
		},
	},
	{
		name: "git_status",
		description: "Show git status. Use to see which files have been modified.",
		parameters: { type: "object", properties: {} },
	},
	{
		name: "git_create_branch",
		description:
			'Create a new git branch. Always prefix with "goli/". Use before making any changes.',
		parameters: {
			type: "object",
			properties: {
				name: {
					type: "string",
					description:
						'Branch name (will be prefixed with "goli/" if not already)',
				},
			},
			required: ["name"],
		},
	},
	{
		name: "write_file",
		description:
			"Create a new file or completely overwrite an existing one. Prefer edit_file for targeted changes. Use for new files only.",
		parameters: {
			type: "object",
			properties: { path: { type: "string" }, content: { type: "string" } },
			required: ["path", "content"],
		},
	},
	{
		name: "edit_file",
		description:
			"Replace a specific string in a file. old_str must match EXACTLY ONCE — include enough surrounding context. Fails if old_str appears 0 times (not found) or 2+ times (ambiguous).",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string" },
				old_str: { type: "string" },
				new_str: { type: "string" },
			},
			required: ["path", "old_str", "new_str"],
		},
	},
	{
		name: "run_tests",
		description:
			"Run the project test suite. Always run after making changes. Auto-detects test runner (jest/vitest/pytest/go/cargo).",
		parameters: {
			type: "object",
			properties: {
				scope: {
					type: "string",
					description: "Optional: specific test file or directory",
				},
			},
		},
	},
	{
		name: "shell_exec",
		description:
			"Execute a shell command. Requires a rationale field. Use only when no other tool covers the operation. RESTRICTED: no rm, no sudo, no curl | bash, no cat .env.",
		parameters: {
			type: "object",
			properties: {
				command: { type: "string" },
				rationale: {
					type: "string",
					description: "REQUIRED: why this command is needed",
				},
			},
			required: ["command", "rationale"],
		},
	},
	{
		name: "git_commit",
		description:
			"Stage all changes and commit with a message. ALWAYS the final step, never intermediate. Requires HITL approval.",
		parameters: {
			type: "object",
			properties: {
				message: {
					type: "string",
					description: "Conventional commit message (type: description)",
				},
			},
			required: ["message"],
		},
	},
	{
		name: "delete_file",
		description:
			"Delete a file permanently. Requires HITL approval. Cannot be undone within the session.",
		parameters: {
			type: "object",
			properties: { path: { type: "string" } },
			required: ["path"],
		},
	},
];

export class ToolRegistry {
	constructor(
		private sandbox: Sandbox,
		private retriever: Retriever,
		private diff: DiffManager,
		private repoRoot: string,
		private session: AgentSession,
	) {}

	cloneWithSandbox(newSandbox: Sandbox): ToolRegistry {
		return new ToolRegistry(
			newSandbox,
			this.retriever,
			this.diff,
			this.repoRoot,
			this.session,
		);
	}

	async getSchemas() {
		return TOOL_SCHEMAS;
	}

	getTier(toolName: string): 1 | 2 | 3 {
		if (TIER_1.has(toolName)) return 1;
		if (TIER_3.has(toolName)) return 3;
		return 2;
	}

	async dispatch(toolCall: ToolCall): Promise<ToolResult> {
		const { name, input, id } = toolCall;

		try {
			switch (name) {
				case "read_file":
					return this.readFile(id, input as { path: string });
				case "read_file_lines":
					return this.readFileLines(
						id,
						input as { path: string; start_line: number; end_line: number },
					);
				case "list_directory":
					return this.listDirectory(id, input as { path?: string });
				case "search_code":
					return this.searchCode(
						id,
						input as { query: string; top_k?: number },
					);
				case "git_diff":
					return this.gitDiff(id, input as { staged?: boolean });
				case "git_status":
					return this.gitStatus(id);
				case "git_create_branch":
					return this.gitCreateBranch(id, input as { name: string });
				case "write_file":
					return this.writeFile(id, input as { path: string; content: string });
				case "edit_file":
					return this.editFile(
						id,
						input as { path: string; old_str: string; new_str: string },
					);
				case "run_tests":
					return this.runTests(id, input as { scope?: string });
				case "shell_exec":
					return this.shellExec(
						id,
						input as { command: string; rationale: string },
					);
				case "git_commit":
					return this.gitCommit(id, input as { message: string });
				case "delete_file":
					return this.deleteFile(id, input as { path: string });
				default:
					return { id, success: false, error: `Unknown tool: ${name}` };
			}
		} catch (err) {
			return { id, success: false, error: (err as Error).message };
		}
	}

	private async readFile(
		id: string,
		input: { path: string },
	): Promise<ToolResult> {
		const content = await this.sandbox.readFile(input.path);
		return { id, success: true, output: content };
	}

	private async readFileLines(
		id: string,
		input: { path: string; start_line: number; end_line: number },
	): Promise<ToolResult> {
		const content = await this.sandbox.readFile(input.path);
		const lines = content
			.split("\n")
			.slice(input.start_line - 1, input.end_line);
		return { id, success: true, output: lines.join("\n") };
	}

	private async listDirectory(
		id: string,
		input: { path?: string },
	): Promise<ToolResult> {
		const result = await this.sandbox.execute(`ls -la "${input.path ?? "."}"`);
		return { id, success: true, output: result };
	}

	private async searchCode(
		id: string,
		input: { query: string; top_k?: number },
	): Promise<ToolResult> {
		const chunks = await this.retriever.search(
			input.query,
			input.top_k ?? 5,
			undefined,
			(this.session as any).embedder,
		);
		// Root Fix: Casting bypass
		return {
			id,
			success: true,
			output: formatChunksForContext(chunks as any as RetrievedChunk[]),
		};
	}

	private async gitDiff(
		id: string,
		input: { staged?: boolean },
	): Promise<ToolResult> {
		const cmd = input.staged ? "git diff --cached" : "git diff HEAD";
		const result = await this.sandbox.execute(cmd);
		return { id, success: true, output: result || "(no changes)" };
	}

	private async gitStatus(id: string): Promise<ToolResult> {
		const result = await this.sandbox.execute("git status --short");
		return { id, success: true, output: result || "(clean)" };
	}

	private async gitCreateBranch(
		id: string,
		input: { name: string },
	): Promise<ToolResult> {
		const branchName = input.name.startsWith("goli/")
			? input.name
			: `goli/${input.name}`;
		const sanitized = branchName.replace(/[^a-zA-Z0-9/_-]/g, "-").slice(0, 80);
		const result = await this.sandbox.execute(`git checkout -b "${sanitized}"`);
		return { id, success: true, output: result };
	}

	private async writeFile(
		id: string,
		input: { path: string; content: string },
	): Promise<ToolResult> {
		await this.sandbox.writeFile(input.path, input.content);
		return { id, success: true, output: `Wrote ${input.path}` };
	}

	private async editFile(
		id: string,
		input: { path: string; old_str: string; new_str: string },
	): Promise<ToolResult> {
		const current = await this.sandbox.readFile(input.path);
		const occurrences = current.split(input.old_str).length - 1;

		if (occurrences === 0)
			return {
				id,
				success: false,
				error: `old_str not found in ${input.path}`,
			};
		if (occurrences > 1)
			return {
				id,
				success: false,
				error: `old_str found ${occurrences} times in ${input.path}`,
			};

		const updated = current.replace(input.old_str, input.new_str);
		await this.sandbox.writeFile(input.path, updated);
		return { id, success: true, output: `Edited ${input.path}` };
	}

	private async runTests(
		id: string,
		input: { scope?: string },
	): Promise<ToolResult> {
		const { command } = buildTestCommand(input.scope, this.repoRoot);
		const result = await this.sandbox.execute(command);
		return { id, success: true, output: result };
	}

	private async shellExec(
		id: string,
		input: { command: string; rationale: string },
	): Promise<ToolResult> {
		const result = await this.sandbox.execute(input.command);
		console.log(`[DEBUG] shell_exec output: ${result.substring(0, 100)}...`);
		return { id, success: true, output: result };
	}
	private async gitCommit(
		id: string,
		input: { message: string },
	): Promise<ToolResult> {
		const result = await this.sandbox.execute(
			`git add -A && git commit -m "${input.message.replace(/"/g, '\\"')}"`,
		);
		return { id, success: true, output: result };
	}

	private async deleteFile(
		id: string,
		input: { path: string },
	): Promise<ToolResult> {
		await this.sandbox.execute(`rm -f "${input.path}"`);
		return { id, success: true, output: `Deleted ${input.path}` };
	}

	getToolDefinitions() {
		return TOOL_SCHEMAS;
	}
}
