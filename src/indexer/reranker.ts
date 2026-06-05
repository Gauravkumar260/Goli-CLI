export class Reranker {
	private ollamaUrl: string;
	private model: string;
	private defaultTimeoutMs: number;

	constructor(
		model = "bbjson/bge-reranker-base",
		ollamaUrl = "http://localhost:11434",
		timeoutMs = 10000,
	) {
		this.model = model;
		this.ollamaUrl = ollamaUrl;
		this.defaultTimeoutMs = timeoutMs;
	}

	async rerank(query: string, documents: string[]): Promise<number[]> {
		if (!query || documents.length === 0) {
			return new Array(documents.length).fill(0);
		}

		const scores: number[] = [];
		for (let i = 0; i < documents.length; i++) {
			const doc = documents[i];
			if (!doc) {
				scores.push(0);
				continue;
			}
			try {
				const score = await this.scorePair(query, doc);
				scores.push(score);
			} catch (err) {
				console.warn(`Reranking failed for document ${i}:`, err);
				scores.push(0);
			}
		}
		return scores;
	}

	private async scorePair(query: string, document: string): Promise<number> {
		const controller = new AbortController();
		const timeoutId = setTimeout(
			() => controller.abort(),
			this.defaultTimeoutMs,
		);

		try {
			const response = await fetch(`${this.ollamaUrl}/api/generate`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					model: this.model,
					prompt: `Query: ${query}\nDocument: ${document}\nScore the relevance from 0 to 1 (only output the number):`,
					stream: false,
				}),
				signal: controller.signal,
			});

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}

			const json: any = await response.json();
			const raw = json.response?.trim() || "";
			const score = Number.parseFloat(raw);
			return Number.isNaN(score) ? 0 : Math.min(1, Math.max(0, score));
		} finally {
			clearTimeout(timeoutId);
		}
	}

	async rerankWithThreshold(
		query: string,
		documents: string[],
		threshold = 0.5,
	): Promise<{ score: number; document: string }[]> {
		const scores = await this.rerank(query, documents);
		// Root Fix: Ensure score is not undefined and handle sorting safely
		const paired = documents.map((doc, idx) => ({
			score: scores[idx] ?? 0,
			document: doc,
		}));
		return paired
			.filter((p) => p.score >= threshold)
			.sort((a, b) => b.score - a.score);
	}
}
