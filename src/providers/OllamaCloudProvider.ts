import type {
	CompletionOptions,
	CompletionResponse,
	Message,
	ModelProvider,
} from "./ModelProvider.js";

/**
 * OllamaCloudProvider (V5)
 *
 * Uses Ollama's cloud models (e.g., gpt-oss:120b) via direct REST API.
 *
 * Host: https://ollama.com
 * Auth: OLLAMA_API_KEY (Bearer token)
 */
export class OllamaCloudProvider implements ModelProvider {
	readonly provider = "ollama" as const;
	readonly modelId: string;

	constructor(private apiKey: string, modelSpec = "gpt-oss:120b") {
		this.modelId = modelSpec;
	}

	async complete(
		messages: Message[],
		systemPrompt?: string,
		options: CompletionOptions = {},
	): Promise<CompletionResponse> {
		const t0 = Date.now();
		const system =
			systemPrompt || messages.find((m) => m.role === "system")?.content;
		const filteredMessages = messages.filter((m) => m.role !== "system");

		const res = await fetch("https://ollama.com/api/chat", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.apiKey}`,
			},
			body: JSON.stringify({
				model: this.modelId,
				messages: [
					...(system ? [{ role: "system", content: system }] : []),
					...filteredMessages.map((m) => ({
						role: m.role === "user" || m.role === "tool" ? "user" : "assistant",
						content: m.content,
					})),
				],
				stream: false,
			}),
		});

		if (!res.ok) {
			throw new Error(
				`Ollama Cloud API failed: ${res.status} ${await res.text()}`,
			);
		}

		const latencyMs = Date.now() - t0;
		const data = (await res.json()) as any;
		const text = data.message?.content || "";

		// Ollama Cloud pricing (hypothetical for free tier/dev)
		// We'll estimate tokens as charCount / 4
		const inputTokens = Math.ceil(JSON.stringify(messages).length / 4);
		const outputTokens = Math.ceil(text.length / 4);

		return {
			text,
			usage: {
				inputTokens,
				outputTokens,
				cacheRead: 0,
				cacheWrite: 0,
			},
			costUsd: 0, // currently free
			latencyMs,
		};
	}

	estimateCost(): number {
		return 0;
	}

	async embed(text: string): Promise<number[]> {
		throw new Error(
			"Ollama Cloud does not support embeddings. Falling back to local/other providers.",
		);
	}

	async embedBatch(texts: string[]): Promise<number[][]> {
		throw new Error(
			"Ollama Cloud does not support embeddings. Falling back to local/other providers.",
		);
	}
}
