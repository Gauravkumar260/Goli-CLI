import type {
	CompletionOptions,
	CompletionResponse,
	Message,
	ModelProvider,
} from "./ModelProvider.js";

export class OllamaProvider implements ModelProvider {
	readonly provider = "ollama" as const;
	readonly modelId: string;
	private baseUrl: string;

	constructor(modelSpec: string, baseUrl = "http://localhost:11434") {
		this.modelId = modelSpec;
		this.baseUrl = baseUrl;
	}

	async complete(
		messages: Message[],
		systemPrompt?: string,
		options: CompletionOptions = {},
	): Promise<CompletionResponse> {
		const t0 = Date.now();
		const body = {
			model: this.modelId,
			stream: false,
			options: {
				temperature: options.temperature ?? 0,
				num_predict: options.maxTokens ?? 4096,
			},
			messages: [
				...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
				...messages.map((m) => ({
					role: m.role === "tool" ? "user" : m.role,
					content: m.content,
				})),
			],
		};

		const res = await fetch(`${this.baseUrl}/api/chat`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(120_000),
		});

		if (!res.ok)
			throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);

		const data = (await res.json()) as any;
		const text = data.message.content;

		return {
			text,
			usage: {
				inputTokens: data.prompt_eval_count ?? 0,
				outputTokens: data.eval_count ?? 0,
				cacheRead: 0,
				cacheWrite: 0,
			},
			costUsd: 0,
			latencyMs: Date.now() - t0,
		};
	}

	estimateCost(): number {
		return 0;
	}

	async embed(text: string): Promise<number[]> {
		const res = await fetch(`${this.baseUrl}/api/embeddings`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ model: "manutic/nomic-embed-code", prompt: text }),
		});
		if (!res.ok) throw new Error("Ollama Embed failed");
		const data = (await res.json()) as any;
		return data.embedding;
	}

	async embedBatch(texts: string[]): Promise<number[][]> {
		return Promise.all(texts.map((t) => this.embed(t)));
	}
}
