// src/mcp/server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { HybridRetriever } from "../retriever/search.js";
import { formatChunksForContext } from "../retriever/format.js";
import * as lancedb from "@lancedb/lancedb";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";

const VERSION = "0.1.0";

const server = new McpServer({
	name: "goli-cli",
	version: VERSION,
});

// ── Tool: search_code ──────────────────────────────────────────
server.registerTool(
	"search_code",
	{
		description: [
			"Hybrid semantic search (BM25 + vector + reranker) over the indexed codebase.",
			'Use for conceptual queries: "auth middleware", "rate limiter", "database connection".',
			"Use grep for exact string searches.",
			"Returns top-K code chunks with file paths, line numbers, and relevance scores.",
		].join(" "),
		inputSchema: {
			query: z
				.string()
				.describe("Natural language query describing the code you are looking for"),
			top_k: z.number().int().min(1).max(20).optional().default(5),
			file_filter: z
				.string()
				.optional()
				.describe('Optional glob to filter results (e.g. "src/auth/**")'),
			workspace: z
				.string()
				.optional()
				.describe("Optional workspace name for cross-repo search"),
		} as any,
	},
	async ({ query, top_k, file_filter, workspace }: any) => {
		const indexPath = workspace
			? path.join(os.homedir(), ".goli", "workspaces", workspace)
			: findIndexPath();

		if (!indexPath)
			return {
				isError: true,
				content: [
					{
						type: "text" as const,
						text: "[goli-mcp] No index found. Run `goli init` in your project root.",
					},
				],
			};

		const retriever = new HybridRetriever({ indexPath, topKFinal: top_k });
		let chunks = await retriever.search(query).catch((err) => {
			throw new Error(`Search failed: ${err}`);
		});

		if (file_filter) {
			const { minimatch } = await import("minimatch");
			chunks = chunks.filter((c) => (minimatch as any)(c.file_path, file_filter));
		}

		if (chunks.length === 0)
			return {
				content: [{ type: "text" as const, text: `No results for: "${query}"` }],
			};

		return {
			content: [{ type: "text" as const, text: formatChunksForContext(chunks as any) }],
		};
	},
);

// ── Tool: list_indexed_files ──────────────────────────────────────────
server.registerTool(
	"list_indexed_files",
	{
		description:
			"List all files in the Goli-CLI index. Use to understand what is searchable.",
		inputSchema: {
			pattern: z.string().optional().describe('Glob filter (e.g. "src/**/*.ts")'),
			workspace: z.string().optional(),
		} as any,
	},
	async ({ pattern, workspace }: any) => {
		const indexPath = workspace
			? path.join(os.homedir(), ".goli", "workspaces", workspace)
			: findIndexPath();

		if (!indexPath)
			return {
				isError: true,
				content: [{ type: "text" as const, text: "[goli-mcp] No index found." }],
			};

		const db = await lancedb.connect(indexPath);
		const table = await db.openTable("chunks");
		const rows = (await (table as any).query().select(["file_path"]).toArray()) as Array<{
			file_path: string;
		}>;
		let files = [...new Set(rows.map((r) => r.file_path))].sort();

		if (pattern) {
			const { minimatch } = await import("minimatch");
			files = files.filter((f) => (minimatch as any)(f, pattern));
		}

		return {
			content: [
				{
					type: "text" as const,
					text:
						files.length > 0
							? `${files.length} files:\n${files.join("\n")}`
							: "No files found.",
				},
			],
		};
	},
);

// ── Tool: index_status ──────────────────────────────────────────
server.registerTool(
	"index_status",
	{
		description:
			"Check Goli-CLI index health: chunk count, last indexed timestamp, index path.",
		inputSchema: {} as any,
	},
	async () => {
		const indexPath = findIndexPath();
		if (!indexPath)
			return {
				content: [
					{ type: "text" as const, text: "No index. Run `goli init` at repo root." },
				],
			};

		const db = await lancedb.connect(indexPath);
		const table = await db.openTable("chunks");
		const count = await table.countRows();
		const rows = (await (table as any)
			.query()
			.select(["last_modified"])
			.limit(1)
			.toArray()) as Array<{ last_modified: bigint }>;

		const lastMs = rows[0]?.last_modified ? Number(rows[0].last_modified) : 0;
		const lastStr = lastMs > 0 ? new Date(lastMs).toISOString() : "unknown";

		return {
			content: [
				{
					type: "text" as const,
					text: `Index path: ${indexPath}\nChunks: ${count}\nLast indexed: ${lastStr}`,
				},
			],
		};
	},
);

// ── Utility ──────────────────────────────────────────
function findIndexPath(): string | null {
	let dir = process.cwd();
	for (let i = 0; i < 5; i++) {
		const candidate = path.join(dir, ".goli_cli", "index");
		if (fs.existsSync(candidate)) return candidate;
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

// ── Entry point ──────────────────────────────────────────
async function main() {
	const transport = new StdioServerTransport();
	await server.connect(transport);
	process.stderr.write("[goli-mcp] MCP server running on stdio\n");
}

main().catch((err) => {
	process.stderr.write(`[goli-mcp] Fatal: ${err}\n`);
	process.exit(1);
});
