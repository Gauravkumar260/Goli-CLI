// src/indexer/schema.ts
import * as arrow from "apache-arrow";

export const VECTOR_DIM = 768; // nomic-embed-code output dimension

export const CHUNK_SCHEMA = new arrow.Schema([
	new arrow.Field("chunk_id", new arrow.Utf8(), false), // sha256(file+line)[:16]
	new arrow.Field("file_path", new arrow.Utf8(), false), // relative from repo root
	new arrow.Field("language", new arrow.Utf8(), false),
	new arrow.Field("node_type", new arrow.Utf8(), false), // function_declaration, etc.
	new arrow.Field("symbol_name", new arrow.Utf8(), false), // AuthService.validateToken
	new arrow.Field("start_line", new arrow.Int32(), false),
	new arrow.Field("end_line", new arrow.Int32(), false),
	new arrow.Field("content", new arrow.Utf8(), false), // indexed for BM25
	new arrow.Field("docstring", new arrow.Utf8(), true), // indexed for BM25
	new arrow.Field("imports", new arrow.Utf8(), true), // JSON array
	new arrow.Field("last_modified", new arrow.Int64(), true), // ms since epoch
	new arrow.Field("repo_id", new arrow.Utf8(), true), // S4: multi-repo
	new arrow.Field(
		"vector",
		new arrow.FixedSizeList(
			VECTOR_DIM,
			new arrow.Field("item", new arrow.Float32()),
		),
		false,
	),
]);

export interface ChunkRecord {
	chunk_id: string;
	file_path: string;
	language: string;
	node_type: string;
	symbol_name: string;
	start_line: number;
	end_line: number;
	content: string;
	docstring: string;
	imports: string; // JSON.stringify(string[])
	last_modified: bigint;
	repo_id: string; // '' for single-repo
	vector: number[];
	score?: number; // set by retriever, not stored
}
