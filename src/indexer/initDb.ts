import * as fs from "node:fs";
import * as path from "node:path";
// src/indexer/initDb.ts
import * as lancedb from "@lancedb/lancedb";
import { CHUNK_SCHEMA } from "./schema.js";

export async function initDatabase(indexPath: string): Promise<lancedb.Table> {
	const dir = path.dirname(indexPath);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}

	const db = await lancedb.connect(indexPath);
	const tables = await db.tableNames();

	let table: lancedb.Table;
	if (tables.includes("chunks")) {
		table = await db.openTable("chunks");
	} else {
		table = await db.createEmptyTable("chunks", CHUNK_SCHEMA);
		console.log("[goli] Index created");
	}

	return table;
}

export async function buildIndexes(table: lancedb.Table): Promise<void> {
	// Vector index — IVF-PQ approximate nearest neighbor
	try {
		const rowCount = await table.countRows();
		if (rowCount > 0) {
			// Root Fix: Correct property names for LanceDB TS SDK
			await (table as any).createIndex("vector", {
				config: lancedb.Index.ivfPq({
					numPartitions: Math.max(1, Math.floor(Math.sqrt(rowCount))),
					numSubVectors: 16,
				}),
			});
		}
	} catch (e) {
		if (!String(e).includes("already exists"))
			console.warn("[goli] Vector index warning:", e);
	}

	// FTS index on text columns — BM25 for keyword/symbol search
	for (const col of ["content", "symbol_name", "docstring"]) {
		try {
			await (table as any).createIndex(col, {
				config: lancedb.Index.fts({
					withPosition: true,
					baseTokenizer: "simple",
				}),
			});
		} catch (e) {
			if (!String(e).includes("already exists"))
				console.warn(`[goli] FTS index ${col} warning:`, e);
		}
	}

	await table.optimize();
	console.log("[goli] Indexes built");
}
