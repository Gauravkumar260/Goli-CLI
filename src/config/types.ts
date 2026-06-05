import type { HITLManager } from "../agent/HITLManager.js";
import type { DiffManager } from "../diff/DiffManager.js";
import type { Embedder } from "../indexer/embedder.js";
import type { ModelProvider } from "../providers/ModelProvider.js";
import type { HybridRetriever } from "../retriever/search.js";
import type { ActionGate } from "../safety/ActionGate.js";
import type { SessionLogger } from "../telemetry/SessionLogger.js";
import type { ToolRegistry } from "../tools/ToolRegistry.js";

export interface ExecResult {
	exitCode: number;
	stdout: string;
	stderr: string;
	blockedReason?: string;
}

export interface RetrievedChunk {
	chunk_id: string;
	file_path: string;
	language: string;
	node_type: string;
	symbol_name: string;
	start_line: number;
	end_line: number;
	content: string;
	docstring: string;
	imports: string;
	last_modified: number | bigint;
	score?: number;
	repo_id?: string;
}

export interface ToolCall {
	id: string;
	name: string;
	input: Record<string, unknown>;
}

export interface ToolResult {
	id: string;
	success: boolean;
	output?: string;
	error?: string;
}

export interface AgentContext {
	systemPrompt: string;
	userMessage: string;
	retrievedChunks: RetrievedChunk[];
	goliCLIMd: string;
	estimatedTokens: number;
	messages: any[];
}

export interface AgentSession {
	sessionId: string;
	task: string;
	repoRoot: string;
	language: string;
	model: string;
	turns: number;
	costUsd: number;
	safetyDenialCount: number;
	goliCLIMd: string;
	logger: SessionLogger;
	model_provider: ModelProvider;
	actionGate: ActionGate;
	tools: ToolRegistry;
	hitl: HITLManager;
	sandbox: any;
	retriever: HybridRetriever;
	embedder: Embedder;
	compactModel: ModelProvider;
	diffManager: DiffManager;
	telemetry: any;
	role?: string;
}

export type Session = AgentSession;

export interface AgentResult {
	status: "done" | "failed";
	reason: StopReason;
	answer?: string;
	turns: number;
	costUsd: number;
	durationMs: number;
	context?: AgentContext;
}

export type StopReason =
	| "final_answer"
	| "max_turns"
	| "cost_cap"
	| "session_timeout"
	| "consecutive_errors"
	| "doom_loop"
	| "safety_denial_limit"
	| "human_denied"
	| "no_tool_calls_no_answer"
	| "model_error_threshold"
	| "empty_model_response"
	| "fatal_error"
	| "blast_radius_breach"
	| "limit_reached"
	| "multi_agent_failure";

export interface FeatureFlags {
	subagents: boolean;
	mcpServer: boolean;
	planningAlwaysOn: boolean;
	anonymousTelemetry: boolean;
	autoCommitMode: boolean;
	gitHubIntegration: boolean;
	rlaifFeedback: boolean;
}

export const DEFAULT_FLAGS: FeatureFlags = {
	subagents: false,
	mcpServer: true,
	planningAlwaysOn: false,
	anonymousTelemetry: false,
	autoCommitMode: false,
	gitHubIntegration: false,
	rlaifFeedback: false,
};

export interface AgentConfig {
	maxTurns: number;
	sessionTimeoutMs: number;
	sessionCostCapUsd: number;
	contextWindowTokens: number;
	compactionThreshold: number;
	consecutiveErrorLimit: number;
	safetyDenialLimit: number;
	autoApprove?: boolean;
	forcePlan?: boolean;
}

export const DEFAULT_CONFIG: AgentConfig = {
	maxTurns: 30,
	sessionTimeoutMs: 10 * 60 * 1000,
	sessionCostCapUsd: 0.5,
	contextWindowTokens: 200_000,
	compactionThreshold: 0.8,
	consecutiveErrorLimit: 3,
	safetyDenialLimit: 5,
};

export interface RunOptions {
	model?: string;
	plan?: boolean;
	auto?: boolean;
	apply?: boolean;
	mock?: boolean;
}

export interface PromptConfig {
	version: string;
	instructions: string[];
	capabilities: string[];
	constraints: string[];
}
