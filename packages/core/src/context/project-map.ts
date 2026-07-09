/**
 * Project map generator (Module 2, next-gen context layer).
 *
 * Generates a compressed, ranked map of the project's structure —
 * the Aider "Repo Map" pattern. Uses tree-sitter to extract symbols
 * (functions, classes, methods) from every file, ranks them by
 * importance (PageRank-style via the symbol graph), and produces a
 * compact text representation that fits in the system prompt.
 *
 * This gives the agent global context about the project without
 * burning the context window. The agent knows "the auth module is
 * in src/auth/, it has a JWT class, and it depends on src/db/" —
 * without having to read every file.
 *
 * ## Integration
 *
 * The `ProjectMapGenerator` is called once per session (or when the
 * workspace changes). The map is injected into the system prompt as
 * a "Project Structure" section, giving the model a bird's-eye view.
 *
 * @module context/project-map
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

import type { Logger } from '../utils/logger.js';

/** Options for the ProjectMapGenerator. */
export interface ProjectMapGeneratorOptions {
  /** The workspace root. */
  workspaceRoot: string;
  /** Logger instance. */
  logger?: Logger;
  /** Maximum tokens for the map (default: 2048). */
  maxTokens?: number;
  /** Directories to skip. */
  skipDirs?: string[];
  /** File extensions to index. */
  extensions?: string[];
}

interface FileEntry {
  path: string;
  symbols: string[];
  importance: number;
}

/** Chars per token estimate. */
const CHARS_PER_TOKEN = 4;

/** Default directories to skip. */
const DEFAULT_SKIP_DIRS = ['node_modules', '.git', 'dist', 'build', '__pycache__', '.next', '.cache', 'coverage'];

/** Default file extensions to index. */
const DEFAULT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.rb', '.swift', '.kt'];

/**
 * Generates a compressed, ranked project map.
 *
 * Usage:
 * ```ts
 * const gen = new ProjectMapGenerator({ workspaceRoot: '/project' });
 * const map = gen.generate();
 * // map = "src/auth/jwt.ts\n  class JWTVerifier\n  function verifyToken\n..."
 * ```
 */
export class ProjectMapGenerator {
  private readonly workspaceRoot: string;
  
  private readonly maxTokens: number;
  private readonly skipDirs: Set<string>;
  private readonly extensions: Set<string>;

  constructor(opts: ProjectMapGeneratorOptions) {
    this.workspaceRoot = opts.workspaceRoot;
    this.maxTokens = opts.maxTokens ?? 2048;
    this.skipDirs = new Set(opts.skipDirs ?? DEFAULT_SKIP_DIRS);
    this.extensions = new Set(opts.extensions ?? DEFAULT_EXTENSIONS);
  }

  /**
   * Generate the project map.
   *
   * @returns A compressed text representation of the project structure.
   */
  generate(): string {
    const files = this.collectFiles();
    const entries = this.extractSymbols(files);
    this.rankByImportance(entries);

    // Format into a compact map, respecting the token budget.
    const maxChars = this.maxTokens * CHARS_PER_TOKEN;
    const lines: string[] = ['## Project Structure'];
    let charCount = 0;

    for (const entry of entries) {
      const relPath = relative(this.workspaceRoot, entry.path);
      const line = `${relPath}`;
      const symLines = entry.symbols.slice(0, 5).map((s) => `  ${s}`);
      const block = [line, ...symLines].join('\n');

      if (charCount + block.length > maxChars) break;
      lines.push(block);
      charCount += block.length;
    }

    if (entries.length === 0) {
      lines.push('(No source files found in workspace.)');
    }

    return lines.join('\n');
  }

  /**
   * Collect all source files in the workspace.
   *
   * Walks the directory tree, skipping node_modules, .git, etc.
   */
  private collectFiles(): string[] {
    const files: string[] = [];
    this.walk(this.workspaceRoot, files);
    return files;
  }

  /**
   * Recursively walk the directory tree.
   * @param dir
   * @param files
   */
  private walk(dir: string, files: string[]): void {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.goli') continue;
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (this.skipDirs.has(entry.name)) continue;
        this.walk(fullPath, files);
      } else if (entry.isFile()) {
        const ext = extname(entry.name);
        if (this.extensions.has(ext)) {
          files.push(fullPath);
        }
      }
    }
  }

  /**
   * Extract symbols from files using regex-based heuristics.
   *
   * For production, this should use tree-sitter. For now, we use
   * lightweight regex patterns that work across languages.
   * @param files
   */
  private extractSymbols(files: string[]): FileEntry[] {
    const entries: FileEntry[] = [];

    for (const file of files) {
      try {
        const content = readFileSync(file, 'utf-8');
        const symbols = this.extractSymbolsFromContent(content, extname(file));
        if (symbols.length > 0 || content.length < 5000) {
          entries.push({
            path: file,
            symbols,
            importance: 0,
          });
        }
      } catch {
        // Skip unreadable files.
      }
    }

    return entries;
  }

  /**
   * Extract symbols from file content using regex heuristics.
   *
   * These patterns are language-agnostic approximations. The real
   * implementation would use tree-sitter (which we already have
   * in context/indexer/tree-sitter.ts), but this fallback works
   * without the tree-sitter native dependency.
   * @param content
   * @param _ext
   */
  private extractSymbolsFromContent(content: string, _ext: string): string[] {
    const symbols: string[] = [];

    // Functions/methods: `function name(`, `def name(`, `fn name(`, `func name(`
    const funcMatches = content.matchAll(/\b(?:function|def|fn|func|fun)\s+(\w+)\s*\(/g);
    for (const m of funcMatches) {
      if (m[1]) symbols.push(`fn ${m[1]}`);
    }

    // Classes: `class Name`
    const classMatches = content.matchAll(/\bclass\s+(\w+)/g);
    for (const m of classMatches) {
      if (m[1]) symbols.push(`class ${m[1]}`);
    }

    // Interfaces/Types: `interface Name`, `type Name =`
    const typeMatches = content.matchAll(/\b(?:interface|type)\s+(\w+)/g);
    for (const m of typeMatches) {
      if (m[1]) symbols.push(`type ${m[1]}`);
    }

    // Exports: `export const name`, `export function name`
    const exportMatches = content.matchAll(/\bexport\s+(?:const|let|var|function|class)\s+(\w+)/g);
    for (const m of exportMatches) {
      if (m[1] && !symbols.some((s) => s.includes(m[1]!))) {
        symbols.push(`export ${m[1]}`);
      }
    }

    // Dedupe and cap at 10 symbols per file.
    return [...new Set(symbols)].slice(0, 10);
  }

  /**
   * Rank files by importance using a simple heuristic.
   *
   * Files are ranked by:
   *   1. Number of symbols (more = more important).
   *   2. Number of imports (files imported by many others = important).
   *   3. File name significance (index.ts, main.ts, app.ts get boosts).
   * @param entries
   */
  private rankByImportance(entries: FileEntry[]): void {
    // Build an import count map.
    const importCounts = new Map<string, number>();
    for (const entry of entries) {
      try {
        const content = readFileSync(entry.path, 'utf-8');
        const importMatches = content.matchAll(/(?:import|require|from)\s+['"]([^'"]+)['"]/g);
        for (const m of importMatches) {
          const imported = m[1] ?? '';
          // Count how many times each file is imported.
          for (const other of entries) {
            const relPath = relative(this.workspaceRoot, other.path);
            if (imported.includes(relPath.replace(extname(relPath), ''))) {
              importCounts.set(other.path, (importCounts.get(other.path) ?? 0) + 1);
            }
          }
        }
      } catch {
        // Skip.
      }
    }

    // Score each file.
    for (const entry of entries) {
      const symbolScore = entry.symbols.length;
      const importScore = importCounts.get(entry.path) ?? 0;
      const nameBoost = this.getNameBoost(entry.path);
      entry.importance = symbolScore * 2 + importScore * 5 + nameBoost;
    }

    // Sort by importance (descending).
    entries.sort((a, b) => b.importance - a.importance);
  }

  /**
   * Get a name-based importance boost.
   *
   * Files named index.ts, main.ts, app.ts, etc. are typically more
   * important than utility files.
   * @param path
   */
  private getNameBoost(path: string): number {
    const name = path.split('/').pop() ?? '';
    if (['index.ts', 'index.js', 'main.ts', 'main.js', 'app.ts', 'app.js', 'server.ts', 'server.js'].includes(name)) {
      return 10;
    }
    if (name.includes('config') || name.includes('setup') || name.includes('init')) {
      return 5;
    }
    return 0;
  }
}
