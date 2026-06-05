import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPromptBlocks } from "../agent/SystemPrompt.js";
import type {
	CompletionOptions,
	CompletionResponse,
	Message,
	ModelProvider,
} from "./ModelProvider.js";

const PRICING: Record<
	string,
	{ input: number; output: number; cacheWrite: number; cacheRead: number }
> = {
	"claude-3-5-sonnet-latest": {
		input: 3.0,
		output: 15.0,
		cacheWrite: 3.75,
		cacheRead: 0.3,
	},
	"claude-3-5-haiku-latest": {
		input: 0.8,
		output: 4.0,
		cacheWrite: 1.0,
		cacheRead: 0.08,
	},
	"claude-3-opus-latest": {
		input: 15.0,
		output: 75.0,
		cacheWrite: 18.75,
		cacheRead: 1.5,
	},
};

export class ClaudeProvider implements ModelProvider {
	readonly provider = "anthropic" as const;
	readonly modelId: string;
	private client: Anthropic;

	constructor(apiKey: string, modelSpec = "claude-3-5-sonnet-latest") {
		this.client = new Anthropic({ apiKey });
		this.modelId = modelSpec;
	}

	async complete(
		messages: Message[],
		systemPrompt?: string,
		options: CompletionOptions = {},
	): Promise<CompletionResponse> {
		const t0 = Date.now();

		// H4 fix: Use cache_control blocks for sonnet/opus
		// Extract goliCLIMd if possible for building blocks
		let systemBlocks: any = systemPrompt || "";
		if (systemPrompt && this.modelId.includes("sonnet")) {
			const goliCLIMdStart = systemPrompt.indexOf(
				"\n\n---\n## Project-Specific",
			);
			const goliCLIMd =
				goliCLIMdStart > 0 ? systemPrompt.slice(goliCLIMdStart + 7) : "";
			systemBlocks = buildSystemPromptBlocks({ goliCLIMd });
		}

		const response = await this.client.messages.create({
			model: this.modelId,
			max_tokens: options.maxTokens ?? 4096,
			temperature: options.temperature ?? 0,
			system: systemBlocks,
			messages: messages
				.filter((m) => m.role !== "system")
				.map((m) => ({
					role:
						m.role === "assistant" ? ("assistant" as const) : ("user" as const),
					content: m.content,
				})),
		});

		const latencyMs = Date.now() - t0;
		const usage = response.usage;
		const text = response.content
			.filter((b) => b.type === "text")
			.map((b) => (b as any).text)
			.join("");

		const p = PRICING[this.modelId] ?? PRICING["claude-3-5-sonnet-latest"]!;
		const costUsd =
			(usage.input_tokens / 1_000_000) * p.input +
			(usage.output_tokens / 1_000_000) * p.output +
			((usage as any).cache_creation_input_tokens / 1_000_000) * p.cacheWrite +
			((usage as any).cache_read_input_tokens / 1_000_000) * p.cacheRead;

		return {
			text,
			usage: {
				inputTokens: usage.input_tokens,
				outputTokens: usage.output_tokens,
				cacheWrite: (usage as any).cache_creation_input_tokens ?? 0,
				cacheRead: (usage as any).cache_read_input_tokens ?? 0,
			},
			costUsd,
			latencyMs,
		};
	}

	estimateCost(inputTokens: number, outputTokens: number): number {
		const p = PRICING[this.modelId] ?? PRICING["claude-3-5-sonnet-latest"]!;
		return (
			(inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output
		);
	}

	async embed(text: string): Promise<number[]> {
		throw new Error(
			"ClaudeProvider does not support embeddings. Use GeminiProvider or Ollama.",
		);
	}

	async embedBatch(texts: string[]): Promise<number[][]> {
		throw new Error(
			"ClaudeProvider does not support embeddings. Use GeminiProvider or Ollama.",
		);
	}
}
