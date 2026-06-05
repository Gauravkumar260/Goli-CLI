// src/retriever/reranker.ts
import type { ChunkRecord } from "../indexer/schema.js";
import type { SessionLogger } from "../telemetry/SessionLogger.js";

let ollamaAvailableCache: boolean | null = null;
let ollamaLastChecked = 0;

async function isOllamaAvailable(): Promise<boolean> {
	const now = Date.now();
	if (now - ollamaLastChecked < 10_000 && ollamaAvailableCache !== null) {
		return ollamaAvailableCache;
	}
	try {
		const res = await fetch("http://localhost:11434/api/tags", {
			signal: AbortSignal.timeout(2000),
		});
		ollamaAvailableCache = res.ok;
	} catch {
		ollamaAvailableCache = false;
	}
	ollamaLastChecked = now;
	return ollamaAvailableCache ?? false;
}

export async function rerank(
	query: string,
	candidates: ChunkRecord[],
	topK = 5,
	_logger?: SessionLogger,
): Promise<ChunkRecord[]> {
	if (candidates.length <= topK) return candidates;
	if (candidates.length === 0) return [];

	const available = await isOllamaAvailable();
	if (!available) {
		process.stderr.write(
			`[goli] ⚠  Reranker unavailable (Ollama not running). Using RRF top-${topK}.\n`,
		);
		return candidates.slice(0, topK);
	}

	try {
		const scored = await Promise.all(
			candidates.map(
				async (chunk): Promise<{ chunk: ChunkRecord; score: number }> => {
					try {
						const res = await fetch("http://localhost:11434/api/rerank", {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({
								model: "bge-reranker",
								query,
								documents: [chunk.content.slice(0, 1000)],
							}),
							signal: AbortSignal.timeout(3_000),
						});
						if (!res.ok) return { chunk, score: 0 };
						const data = (await res.json()) as {
							results: Array<{ relevance_score: number }>;
						};
						return { chunk, score: data.results?.[0]?.relevance_score ?? 0 };
					} catch {
						return { chunk, score: 0 };
					}
				},
			),
		);

		return scored
			.sort((a, b) => b.score - a.score)
			.slice(0, topK)
			.map((s) => ({ ...s.chunk, score: s.score }));
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err);
		process.stderr.write(
			`[goli] ⚠  Reranker error (${reason.slice(0, 60)}). Falling back to RRF.\n`,
		);
		return candidates.slice(0, topK);
	}
}
