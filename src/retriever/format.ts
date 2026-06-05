// src/retriever/format.ts
import type { RetrievedChunk } from "../config/types.js";

export type { RetrievedChunk };

export function formatChunksForContext(
	chunks: RetrievedChunk[],
	opts: { maxChunks?: number; includeScores?: boolean } = {},
): string {
	const top = chunks
		.slice()
		.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
		.slice(0, opts.maxChunks ?? 20);

	if (top.length === 0) return "(no relevant code chunks found)";

	return top
		.map((c, idx) => {
			const parts = [
				`## [${idx + 1}/${top.length}] ${c.file_path}:${c.start_line}–${c.end_line}`,
				c.symbol_name ? `Symbol: ${c.symbol_name}` : null,
				opts.includeScores && c.score !== undefined
					? `Relevance: ${c.score.toFixed(3)}`
					: null,
			]
				.filter(Boolean)
				.join(" · ");

			return `${parts}\n\`\`\`${c.language}\n${c.content}\n\`\`\``;
		})
		.join("\n\n");
}
