import * as fs from "node:fs";
import * as path from "node:path";
import type * as lancedb from "@lancedb/lancedb";
import type { Embedder } from "./embedder.js";
import { buildIndexes, initDatabase } from "./initDb.js";
import type { ChunkRecord } from "./schema.js";
import { chunkFile } from "./treeSitter.js";

export interface IndexResult {
	chunksIndexed: number;
	filesProcessed: number;
	durationMs: number;
	errors: string[];
}

export class Indexer {
	private table: lancedb.Table | null = null;

	constructor(
		private repoPath: string,
		private indexPath: string,
		private embedder: Embedder,
		private repoId = "",
	) {}

	private async getTable(): Promise<lancedb.Table> {
		if (this.table) return this.table;
		this.table = await initDatabase(this.indexPath);
		return this.table;
	}

	/** Full re-index — used by `goli init` */
	async indexFull(): Promise<IndexResult> {
		const t0 = Date.now();
		const errors: string[] = [];

		const files = this.getIndexableFiles();
		let chunksTotal = 0;

		const table = await this.getTable();
		// Root fix: the previous empty `catch {}` swallowed every failure
		// from `table.delete("1=1")`, hiding real errors (corrupt LanceDB
		// file, permission denied on the index dir). The only "expected"
		// failure is "no rows match" — which LanceDB does not raise. If
		// the table is missing, the subsequent add-batch would also fail
		// loudly, so we let the error propagate. Log the error so the
		// cause is recoverable from the session log even when the
		// exception bubbles up.
		try {
			await table.delete("1=1");
		} catch (e: any) {
			console.error(
				`[goli] Failed to clear existing index: ${e?.message ?? String(e)}`,
			);
			throw e;
		}

		const BATCH = 20;
		for (let i = 0; i < files.length; i += BATCH) {
			const batch = files.slice(i, i + BATCH);
			const chunks = this.parseFiles(batch, errors);
			if (chunks.length === 0) continue;

			const vectors = await this.embedder.embedBatch(
				chunks.map((c) => c.content),
			);
			const rows = chunks.map((c, idx) => ({ ...c, vector: vectors[idx]! }));

			await table.add(rows);
			chunksTotal += rows.length;
			process.stdout.write(
				`\r[goli] Indexed ${chunksTotal} chunks from ${i + batch.length}/${files.length} files...`,
			);
		}

		console.log("");
		await buildIndexes(table);

		return {
			chunksIndexed: chunksTotal,
			filesProcessed: files.length,
			durationMs: Date.now() - t0,
			errors,
		};
	}

	/** Incremental update */
	async indexIncremental(changedFiles: string[]): Promise<IndexResult> {
		const t0 = Date.now();
		const errors: string[] = [];

		const chunks = this.parseFiles(changedFiles, errors);
		if (chunks.length === 0)
			return {
				chunksIndexed: 0,
				filesProcessed: changedFiles.length,
				durationMs: 0,
				errors,
			};

		const vectors = await this.embedder.embedBatch(
			chunks.map((c) => c.content),
		);
		const rows = chunks.map((c, i) => ({ ...c, vector: vectors[i]! }));

		const table = await this.getTable();
		for (const chunk of chunks) {
			await table.delete(`file_path = '${chunk.file_path}'`);
		}

		await table.add(rows);
		await table.optimize();

		return {
			chunksIndexed: rows.length,
			filesProcessed: changedFiles.length,
			durationMs: Date.now() - t0,
			errors,
		};
	}

	private getIndexableFiles(): string[] {
		const SKIP = [
			"node_modules",
			".git",
			// Canonical metadata directory only — the hyphen variant was a legacy
			// rename artifact and was removed in the root-fix pass.
			".goli_cli",
			"dist",
			"build",
			"__pycache__",
			".venv",
		];
		const EXTS = new Set([
			".ts",
			".tsx",
			".js",
			".jsx",
			".py",
			".go",
			".rs",
			".mts",
			".mjs",
		]);

		const allFiles: string[] = [];
		const walk = (dir: string) => {
			let entries: fs.Dirent[];
			try {
				entries = fs.readdirSync(dir, { withFileTypes: true });
			} catch {
				return;
			}
			for (const e of entries) {
				if (SKIP.some((s) => e.name === s || e.name.startsWith("."))) continue;
				const full = path.join(dir, e.name);
				if (e.isDirectory()) walk(full);
				else if (e.isFile() && EXTS.has(path.extname(e.name)))
					allFiles.push(full);
			}
		};
		walk(this.repoPath);
		return allFiles;
	}

	private parseFiles(files: string[], errors: string[]): ChunkRecord[] {
		const all: ChunkRecord[] = [];
		for (const file of files) {
			try {
				const content = fs.readFileSync(file, "utf8");
				const rel = path.relative(this.repoPath, file).replace(/\\/g, "/");
				const stats = fs.statSync(file);
				// Root Fix: BigInt from Date object is safer than mtimeMs which can be float
				const mtime = BigInt(new Date(stats.mtime).getTime());
				const chunks = chunkFile(rel, content, this.repoId, mtime);
				all.push(...chunks);
			} catch (e: any) {
				errors.push(`${file}: ${e.message}`);
			}
		}
		return all;
	}
}
