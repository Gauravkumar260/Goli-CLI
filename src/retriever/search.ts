// src/retriever/search.ts
import type * as lancedb from "@lancedb/lancedb";
import type { Embedder } from "../indexer/embedder.js";
import { initDatabase } from "../indexer/initDb.js";
import type { ChunkRecord } from "../indexer/schema.js";
import type { ModelProvider } from "../providers/ModelProvider.js";
import type { SessionLogger } from "../telemetry/SessionLogger.js";
import { expandQuery } from "./queryExpander.js";
import { rerank } from "./reranker.js";

export interface RetrieverConfig {
	indexPath: string;
	topKRecall: number;
	topKFinal: number;
	repoId?: string;
}

const DEFAULTS: RetrieverConfig = {
	indexPath: ".goli_cli/index",
	topKRecall: 20,
	topKFinal: 5,
};

export class HybridRetriever {
	private table: lancedb.Table | null = null;
	private config: RetrieverConfig;

	constructor(config?: Partial<RetrieverConfig>) {
		this.config = { ...DEFAULTS, ...config };
	}

	async init(): Promise<void> {
		if (this.table) return;
		this.table = await initDatabase(this.config.indexPath);
	}

	async search(
		task: string,
		topK?: number,
		modelProvider?: ModelProvider,
		embedder?: Embedder,
		logger?: SessionLogger,
	): Promise<ChunkRecord[]> {
		await this.init();
		if (!embedder) throw new Error("Embedder required for search");

		const finalK = topK ?? this.config.topKFinal;
		const recallK = Math.max(finalK * 4, this.config.topKRecall);

		const expandedQuery = modelProvider
			? await expandQuery(task, modelProvider).catch(() => task)
			: task;

		const queryVector = await embedder.embed(task);

		let query = (this.table! as any)
			.query()
			.fullTextSearch(expandedQuery)
			.nearestTo(queryVector)
			.limit(recallK);

		if (this.config.repoId) {
			query = query.where(`repo_id = '${this.config.repoId}'`);
		}

		const rows: any[] = await query.toArray().catch(async (err: any) => {
			process.stderr.write(
				`[goli] Hybrid search failed (${String(err).slice(0, 60)}), falling back to vector-only\n`,
			);
			return (this.table! as any)
				.vectorSearch(queryVector)
				.limit(recallK)
				.toArray();
		});

		const candidates: ChunkRecord[] = rows.map((r) => ({
			chunk_id: r.chunk_id,
			file_path: r.file_path,
			language: r.language,
			node_type: r.node_type,
			symbol_name: r.symbol_name,
			start_line: r.start_line,
			end_line: r.end_line,
			content: r.content,
			docstring: r.docstring ?? "",
			imports: r.imports ?? "[]",
			last_modified: r.last_modified ?? BigInt(0),
			repo_id: r.repo_id ?? "",
			vector: [],
			score: r._distance ?? 0,
		}));

		return rerank(task, candidates, finalK, logger);
	}
}
