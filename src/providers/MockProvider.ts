import type {
	CompletionResponse,
	Message,
	ModelProvider,
} from "./ModelProvider.js";

export class MockProvider implements ModelProvider {
	readonly modelId = "mock-model";
	readonly provider = "ollama"; // Mock behaves like local

	private responses: string[];
	private callCount = 0;

	constructor(responses: string[]) {
		this.responses = responses;
	}

	async complete(_messages: Message[]): Promise<CompletionResponse> {
		const response =
			this.responses[this.callCount % this.responses.length] || "DONE";
		this.callCount++;

		return {
			text: response,
			usage: {
				inputTokens: 100,
				outputTokens: 50,
				cacheRead: 0,
				cacheWrite: 0,
			},
			costUsd: 0.0001,
			latencyMs: 100,
		};
	}

	estimateCost(): number {
		return 0;
	}

	async embed(_text: string): Promise<number[]> {
		return new Array(768).fill(0);
	}

	async embedBatch(texts: string[]): Promise<number[][]> {
		return texts.map(() => new Array(768).fill(0));
	}
}
