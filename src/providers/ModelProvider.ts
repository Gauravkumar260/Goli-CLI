/**
 * ModelProvider Interface (V2)
 *
 * Defines the contract for all LLM providers in Goli-CLI.
 * Enforces ADR-010: No SDK leakage outside providers.
 */

export interface Message {
	role: "user" | "assistant" | "tool" | "system";
	content: string;
}

export interface CompletionOptions {
	maxTokens?: number; // default: 4096
	temperature?: number; // default: 0 (deterministic)
	stream?: boolean;
}

export interface Usage {
	inputTokens: number;
	outputTokens: number;
	cacheRead: number;
	cacheWrite: number;
}

export interface CompletionResponse {
	text: string;
	usage: Usage;
	costUsd: number;
	latencyMs: number;
}

export interface ModelProvider {
	readonly modelId: string;
	readonly provider: "gemini" | "anthropic" | "openai" | "ollama";

	complete(
		messages: Message[],
		systemPrompt?: string,
		options?: CompletionOptions,
	): Promise<CompletionResponse>;

	/** Cost estimate for a hypothetical request (used by router before calling) */
	estimateCost(inputTokens: number, outputTokens: number): number;

	/** Embedding support */
	embed(text: string): Promise<number[]>;
	embedBatch(texts: string[]): Promise<number[][]>;
}
