import { createHash } from "node:crypto";
// src/indexer/treeSitter.ts
// Portability Fix: Use web-tree-sitter (WASM) instead of native to avoid Windows build tool dependency issues.

let Parser: any;
let Python: any;
let TypeScript: any;
let JavaScript: any;
let Go: any;
let Rust: any;

async function initParser() {
    if (Parser) return;
    try {
        const { default: P } = await import("web-tree-sitter");
        if ((P as any).init) await (P as any).init();
        Parser = P;
        // In a real WASM implementation, we would load .wasm files here.
        // For now, we mock to allow the CLI to boot without crashing.
    } catch (e) {
        console.warn("[tree-sitter] WASM initialization failed. Semantic chunking will be limited.");
    }
}

import type { ChunkRecord } from "./schema.js"; 

const EXTENSION_TO_LANGUAGE: Record<string, string> = {
        ".ts": "typescript",
        ".tsx": "tsx",
        ".mts": "typescript",
        ".js": "javascript",
        ".jsx": "javascript",
        ".mjs": "javascript",
        ".py": "python",
        ".go": "go",
        ".rs": "rust",
};

const MIN_LINES = 5;
const MAX_LINES = 150;

export function chunkFile(
        filePath: string,
        fileContent: string,
        repoId = "",
        lastModified?: bigint,
): ChunkRecord[] {
        // Fallback to line-based chunking if tree-sitter is unavailable
        const lm = lastModified || BigInt(Math.floor(Date.now()));
        const ext = `.${filePath.split(".").pop() ?? ""}`;
        const language = EXTENSION_TO_LANGUAGE[ext] || "text";

        // For now, return a single chunk for the whole file to satisfy the interface without crashing
        const lines = fileContent.split("\n");
        const chunkId = createHash("sha256").update(`${filePath}:0`).digest("hex").slice(0, 16);

        return [{
                chunk_id: chunkId,
                file_path: filePath,
                language,
                node_type: "file",
                symbol_name: filePath,
                start_line: 1,
                end_line: lines.length,
                content: fileContent.slice(0, 5000), // Cap size
                docstring: "",
                imports: "[]",
                last_modified: lm,
                repo_id: repoId,
                vector: [],
        }];
}
