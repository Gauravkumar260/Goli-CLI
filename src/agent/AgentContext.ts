import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Message } from "../providers/ModelProvider.js";
import {
	formatChunksForContext,
	type RetrievedChunk,
} from "../retriever/format.js";
import { buildSystemPrompt } from "./SystemPrompt.js";

/**
 * Interface representing the initial context injected into the first turn.
 */
export interface InitialContext {
	systemPrompt: string;
	userMessage: string;
	retrievedChunks: RetrievedChunk[];
	goliCLIMd: string;
	estimatedTokens: number;
}

/**
 * Standardized Context management for Goli-CLI.
 */
export class ContextManager {
	public messages: Message[] = [];
	public systemPrompt = "";
	public tokenCount = 0;
	public windowSize = 128000;

	constructor(messages: Message[] = []) {
		this.messages = messages;
	}

	updateTokenCount() {
		this.tokenCount = this.messages.reduce((acc, m) => {
			const content = m.content || "";
			return acc + Math.ceil(content.length / 4);
		}, 0);
	}
}

function safeExec(cmd: string, cwd: string, timeoutMs: number): string {
	try {
		return execSync(cmd, {
			cwd,
			encoding: "utf8",
			timeout: timeoutMs,
			stdio: ["pipe", "pipe", "pipe"],
		})
			.toString()
			.trim();
	} catch (_err: any) {
		return "";
	}
}

function readGoliCliMd(repoRoot: string): string {
	const mdPath = join(repoRoot, "Goli-CLI.md");
	if (!existsSync(mdPath)) return "";
	const raw = readFileSync(mdPath, "utf8");
	return raw.replace(/ignore all previous instructions/gi, "[REDACTED]");
}

/**
 * Builds the initial rich context block for the agent.
 */
export async function buildInitialContext(
	task: string,
	repoRoot: string,
	retrievedChunks: RetrievedChunk[] = [],
): Promise<InitialContext> {
	const [dirTree, gitStatus, recentCommits, currentBranch] = await Promise.all([
		Promise.resolve(
			safeExec(
				'find . -type f -not -path "./.git/*" -not -path "./node_modules/*" -not -path "./.goli_cli/*" | sort | head -100',
				repoRoot,
				5000,
			),
		),
		Promise.resolve(safeExec("git status --short", repoRoot, 3000)),
		Promise.resolve(safeExec("git log --oneline -10", repoRoot, 3000)),
		Promise.resolve(safeExec("git branch --show-current", repoRoot, 3000)),
	]);

	const goliCLIMd = readGoliCliMd(repoRoot);

	const startupBlock = `## Repository State (session start)
Working directory: ${repoRoot}
Platform: ${process.platform}/${process.arch}
Date: ${new Date().toISOString().slice(0, 10)}
Branch: ${currentBranch || "(detached)"}

### File structure (top 100)
\`\`\`
${dirTree || "(empty)"}
\`\`\`

### Git status
\`\`\`
${gitStatus || "(clean)"}
\`\`\`

### Recent commits
\`\`\`
${recentCommits || "(no commits)"}
\`\`\``;

	const systemPrompt = buildSystemPrompt({ goliCLIMd: goliCLIMd });

	const userMessage = [
		startupBlock,
		retrievedChunks.length > 0
			? `## Retrieved code context\n${formatChunksForContext(retrievedChunks, { maxChunks: 8 })}`
			: "",
		`## Your task\n${task}`,
	]
		.filter(Boolean)
		.join("\n\n");

	const estimatedTokens = Math.ceil(
		(systemPrompt.length + userMessage.length) / 4,
	);

	return {
		systemPrompt,
		userMessage,
		retrievedChunks,
		goliCLIMd,
		estimatedTokens,
	};
}
