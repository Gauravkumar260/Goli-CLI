import {
	GoogleGenerativeAI,
	type GenerativeModel,
} from "@google/generative-ai";
import type {
	CompletionOptions,
	CompletionResponse,
	Message,
	ModelProvider,
} from "./ModelProvider.js";

// Gemini Flash pricing (June 2026)
const PRICING: Record<
	string,
	{ inputPer1M: number; outputPer1M: number; cachedPer1M: number }
> = {
	"gemini-2.0-flash": {
		inputPer1M: 0.1,
		outputPer1M: 0.4,
		cachedPer1M: 0.025,
	},
	"gemini-2.0-flash-lite": {
		inputPer1M: 0.075,
		outputPer1M: 0.3,
		cachedPer1M: 0.02,
	},
	"gemini-1.5-flash": {
		inputPer1M: 0.075,
		outputPer1M: 0.3,
		cachedPer1M: 0.0375,
	},
	"gemini-1.5-flash-8b": {
		inputPer1M: 0.0375,
		outputPer1M: 0.15,
		cachedPer1M: 0.01,
	},
};

export class GeminiProvider implements ModelProvider {
	readonly provider = "gemini" as const;
	readonly modelId: string;
	private client: GenerativeModel;
	private embedModel: any;

	constructor(apiKey: string, modelSpec = "gemini-1.5-flash") {
		const genai = new GoogleGenerativeAI(apiKey);
		this.modelId = modelSpec;
		this.client = genai.getGenerativeModel({ model: modelSpec });
		this.embedModel = genai.getGenerativeModel({
			model: "models/gemini-embedding-001",
		});
	}

	async complete(
		messages: Message[],
		systemPrompt?: string,
		options: CompletionOptions = {},
	): Promise<CompletionResponse> {
		const t0 = Date.now();
		const system =
			systemPrompt || messages.find((m) => m.role === "system")?.content;

		const config: Record<string, unknown> = {
			systemInstruction: system,
			generationConfig: {
				maxOutputTokens: options.maxTokens ?? 4096,
				temperature: options.temperature ?? 0,
			},
		};

		const chat = this.client.startChat(config as any);
		
		const history = messages
			.filter((m) => m.role !== "system")
			.slice(0, -1)
			.map((m) => ({
				role: m.role === "assistant" ? "model" : "user",
				parts: [{ text: m.content }],
			}));

		const lastMsg = messages.filter((m) => m.role !== "system").at(-1);
		if (!lastMsg) throw new Error("No messages to complete");

		const result = await this.withRetry(async () => {
			const res = await chat.sendMessage(lastMsg.content);
			return res.response;
		});

		const latencyMs = Date.now() - t0;
		const text = result.text();
		const usage = result.usageMetadata ?? {
			promptTokenCount: 0,
			candidatesTokenCount: 0,
			cachedContentTokenCount: 0,
		};

		const pricing = PRICING[this.modelId] ?? PRICING["gemini-1.5-flash"]!;
		const cacheCount = usage.cachedContentTokenCount ?? 0;
		const costUsd =
			(usage.promptTokenCount / 1_000_000) * pricing.inputPer1M +
			(usage.candidatesTokenCount / 1_000_000) * pricing.outputPer1M -
			(cacheCount / 1_000_000) *
				(pricing.inputPer1M - pricing.cachedPer1M);

		return {
			text,
			usage: {
				inputTokens: usage.promptTokenCount,
				outputTokens: usage.candidatesTokenCount,
				cacheRead: cacheCount,
				cacheWrite: 0,
			},
			costUsd,
			latencyMs,
		};
	}

	estimateCost(inputTokens: number, outputTokens: number): number {
		const p = PRICING[this.modelId] ?? PRICING["gemini-1.5-flash"]!;
		return (
			(inputTokens / 1_000_000) * p.inputPer1M +
			(outputTokens / 1_000_000) * p.outputPer1M
		);
	}

	async embed(text: string): Promise<number[]> {
		return this.withRetry(async () => {
			const result = await this.embedModel.embedContent(text);
			const values = result.embedding.values;
			if (values.length > 768) return values.slice(0, 768);
			return values;
		});
	}

	async embedBatch(texts: string[]): Promise<number[][]> {
		try {
			return await this.withRetry(async () => {
				const result = await this.embedModel.batchEmbedContents({
					requests: texts.map((text) => ({
						content: { parts: [{ text }] },
						taskType: "RETRIEVAL_DOCUMENT",
					})),
				});
				return result.embeddings.map((e: any) => {
					const values = e.values;
					return values.length > 768 ? values.slice(0, 768) : values;
				});
			});
		} catch (err: any) {
			if (err.message?.includes("429")) throw err;
			return Promise.all(texts.map((t) => this.embed(t)));
		}
	}

	private async withRetry<T>(fn: () => Promise<T>, retries = 5): Promise<T> {
		let lastError: any;
		let delay = 2000;
		for (let i = 0; i < retries; i++) {
			try {
				return await fn();
			} catch (e: any) {
				lastError = e;
				if (
					e.message?.includes("429") ||
					e.message?.includes("Too Many Requests")
				) {
					process.stderr.write(
						`\n⚠️  Gemini API Rate Limit (429). Retrying in ${delay / 1000}s... (Attempt ${i + 1}/${retries})\n`,
					);
					await new Promise((resolve) => setTimeout(resolve, delay));
					delay *= 2;
					continue;
				}
				throw e;
			}
		}
		throw lastError;
	}
}
