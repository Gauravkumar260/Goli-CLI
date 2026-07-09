/**
 * Tree-sitter AST indexer (Module 2).
 *
 * Parses source files into semantic chunks (functions, classes, methods)
 * using tree-sitter. Features:
 *
 * - **Incremental parsing**: only re-parses files that changed (content-hash dedup)
 * - **Semantic chunking**: extracts function/class/method definitions with
 *   their docstrings
 * - **Multi-language**: supports TypeScript, JavaScript, Python, Rust, Go
 *   via the tree-sitter-language-pack
 * - **File-incremental updates**: tracks content hashes to skip unchanged files
 *
 * ## Why tree-sitter over LSP?
 *
 * LSP varies across implementations/versions; tree-sitter is deterministic,
 * complete, and cacheable. (ADR-0022)
 *
 * @module context/indexer/tree-sitter
 */

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { extname } from 'node:path';

import { extractDocstringFromTree } from './docstring-utils.js';
import { isRealTreeSitterAvailable, extractChunksWithTreeSitter } from './real-tree-sitter.js';

import type { SemanticChunk, SymbolType } from '../types.js';

/** Map file extensions to tree-sitter language names. */
const EXTENSION_MAP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'jsx',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.c': 'c',
  '.cpp': 'cpp',
  '.rb': 'ruby',
};

/** Query patterns for each language (simplified — tree-sitter queries in practice). */
const SYMBOL_PATTERNS: Record<string, Array<{ type: string; symbolType: SymbolType; nameField: string }>> = {
  typescript: [
    { type: 'function_declaration', symbolType: 'function', nameField: 'name' },
    { type: 'method_definition', symbolType: 'method', nameField: 'name' },
    { type: 'class_declaration', symbolType: 'class', nameField: 'name' },
    { type: 'interface_declaration', symbolType: 'interface', nameField: 'name' },
    { type: 'type_alias_declaration', symbolType: 'type', nameField: 'name' },
    { type: 'import_statement', symbolType: 'import', nameField: '' },
    { type: 'export_statement', symbolType: 'export', nameField: '' },
  ],
  tsx: [
    { type: 'function_declaration', symbolType: 'function', nameField: 'name' },
    { type: 'method_definition', symbolType: 'method', nameField: 'name' },
    { type: 'class_declaration', symbolType: 'class', nameField: 'name' },
    { type: 'interface_declaration', symbolType: 'interface', nameField: 'name' },
  ],
  javascript: [
    { type: 'function_declaration', symbolType: 'function', nameField: 'name' },
    { type: 'method_definition', symbolType: 'method', nameField: 'name' },
    { type: 'class_declaration', symbolType: 'class', nameField: 'name' },
  ],
  python: [
    { type: 'function_definition', symbolType: 'function', nameField: 'name' },
    { type: 'class_definition', symbolType: 'class', nameField: 'name' },
  ],
  rust: [
    { type: 'function_item', symbolType: 'function', nameField: 'name' },
    { type: 'struct_item', symbolType: 'class', nameField: 'name' },
    { type: 'impl_item', symbolType: 'class', nameField: 'name' },
    { type: 'trait_item', symbolType: 'interface', nameField: 'name' },
  ],
  go: [
    { type: 'function_declaration', symbolType: 'function', nameField: 'name' },
    { type: 'method_declaration', symbolType: 'method', nameField: 'name' },
    { type: 'type_declaration', symbolType: 'type', nameField: 'name' },
  ],
};

/**
 * Tree-sitter AST indexer.
 *
 * Phase 7 implementation: uses a regex-based fallback for symbol extraction
 * when tree-sitter native bindings aren't available. The interface is
 * designed to swap in real tree-sitter parsing (via `tree-sitter`
 * + `tree-sitter-language-pack` npm packages) without changing callers.
 *
 * @module context/indexer/tree-sitter
 */
export class TreeSitterIndexer {
  private readonly fileHashes = new Map<string, string>();
  private readonly chunks = new Map<string, SemanticChunk[]>();

  /**
   * Index a file. Only re-parses if the content hash changed.
   *
   * This is the sync version — uses the regex-based extractor. For
   * AST-based extraction via real tree-sitter native bindings, use
   * {@link indexFileAsync} instead (preferred when tree-sitter is
   * installed).
   *
   * @param filePath - The absolute file path.
   * @returns The semantic chunks extracted from the file (empty if unchanged).
   */
  indexFile(filePath: string): SemanticChunk[] {
    if (!existsSync(filePath)) {
      return [];
    }

    const content = readFileSync(filePath, 'utf-8');
    const hash = createHash('sha256').update(content).digest('hex');

    // Skip if unchanged
    if (this.fileHashes.get(filePath) === hash) {
      return this.chunks.get(filePath) ?? [];
    }

    this.fileHashes.set(filePath, hash);
    const language = this.detectLanguage(filePath);
    if (!language) {
      return [];
    }

    const chunks = this.extractChunks(filePath, content, language);
    this.chunks.set(filePath, chunks);
    return chunks;
  }

  /**
   * Index a file asynchronously, using real tree-sitter when available.
   *
   * Tries the native tree-sitter bindings first (AST-based extraction).
   * If the `tree-sitter` and `tree-sitter-language-pack` packages are
   * not installed (or fail to load), falls back to the regex-based
   * extractor. The result is cached just like {@link indexFile}.
   *
   * **H22 (ADR-0046):** This is the preferred method when tree-sitter
   * is installed. The sync {@link indexFile} remains for backward
   * compatibility.
   *
   * @param filePath - The absolute file path.
   * @returns The semantic chunks extracted from the file (empty if unchanged).
   */
  async indexFileAsync(filePath: string): Promise<SemanticChunk[]> {
    if (!existsSync(filePath)) {
      return [];
    }

    const content = readFileSync(filePath, 'utf-8');
    const hash = createHash('sha256').update(content).digest('hex');

    // Skip if unchanged
    if (this.fileHashes.get(filePath) === hash) {
      return this.chunks.get(filePath) ?? [];
    }

    this.fileHashes.set(filePath, hash);
    const language = this.detectLanguage(filePath);
    if (!language) {
      return [];
    }

    // Try real tree-sitter first (H22).
    let chunks: SemanticChunk[] = [];
    if (await isRealTreeSitterAvailable()) {
      chunks = await extractChunksWithTreeSitter(filePath, content, language);
    }
    // Fall back to regex-based extraction.
    if (chunks.length === 0) {
      chunks = this.extractChunks(filePath, content, language);
    }

    this.chunks.set(filePath, chunks);
    return chunks;
  }

  /**
   * Index multiple files asynchronously (H22).
   *
   * Uses {@link indexFileAsync} for each file. Files are processed
   * sequentially to avoid spawning too many tree-sitter parsers
   * concurrently (each parser holds native memory).
   *
   * @param filePaths - Array of absolute file paths.
   * @returns All semantic chunks from all files.
   */
  async indexFilesAsync(filePaths: string[]): Promise<SemanticChunk[]> {
    const allChunks: SemanticChunk[] = [];
    for (const fp of filePaths) {
      const chunks = await this.indexFileAsync(fp);
      allChunks.push(...chunks);
    }
    return allChunks;
  }

  /**
   * Check whether real tree-sitter native bindings are available.
   *
   * When true, {@link indexFileAsync} uses AST-based extraction.
   * When false, it falls back to the regex-based extractor.
   */
  async isUsingRealTreeSitter(): Promise<boolean> {
    return isRealTreeSitterAvailable();
  }

  /**
   * Index multiple files.
   *
   * @param filePaths - Array of absolute file paths.
   * @returns All semantic chunks from all files.
   */
  indexFiles(filePaths: string[]): SemanticChunk[] {
    return filePaths.flatMap((fp) => this.indexFile(fp));
  }

  /**
   * Get all indexed chunks.
   */
  getAllChunks(): SemanticChunk[] {
    return [...this.chunks.values()].flat();
  }

  /**
   * Get chunks for a specific file.
   * @param filePath
   */
  getChunksForFile(filePath: string): SemanticChunk[] {
    return this.chunks.get(filePath) ?? [];
  }

  /**
   * Remove a file from the index.
   * @param filePath
   */
  removeFile(filePath: string): void {
    this.fileHashes.delete(filePath);
    this.chunks.delete(filePath);
  }

  /**
   * Detect the language from the file extension.
   * @param filePath
   */
  detectLanguage(filePath: string): string | undefined {
    const ext = extname(filePath).toLowerCase();
    return EXTENSION_MAP[ext];
  }

  /**
   * Extract semantic chunks from file content.
   *
   * Phase 7 uses regex-based extraction as a practical fallback. The
   * real tree-sitter integration (via `tree-sitter` npm package) will
   * replace this with AST-based extraction in a later iteration.
   * @param filePath
   * @param content
   * @param language
   */
  private extractChunks(
    filePath: string,
    content: string,
    language: string,
  ): SemanticChunk[] {
    const patterns = SYMBOL_PATTERNS[language];
    if (!patterns) return [];

    const lines = content.split('\n');
    const chunks: SemanticChunk[] = [];

    // Regex-based symbol extraction (language-specific)
    const symbolRegexes = this.getSymbolRegexes(language);

    for (const { regex, symbolType } of symbolRegexes) {
      let match;
      while ((match = regex.exec(content)) !== null) {
        const symbolName = match[1] ?? match[2] ?? '(anonymous)';
        const startLine = content.slice(0, match.index).split('\n').length;
        const endLine = this.findSymbolEnd(lines, startLine - 1, language);
        const code = lines.slice(startLine - 1, endLine).join('\n');
        const docstring = extractDocstringFromTree(lines, startLine - 1, language);

        chunks.push({
          id: this.chunkId(filePath, startLine, symbolName),
          filePath,
          language,
          lineRange: { start: startLine, end: endLine },
          code,
          symbolName,
          symbolType,
          docstring,
          contentHash: createHash('sha256').update(code).digest('hex'),
        });
      }
    }

    return chunks.sort((a, b) => a.lineRange.start - b.lineRange.start);
  }

  /**
   * Get language-specific symbol regexes.
   * @param language
   */
  private getSymbolRegexes(language: string): Array<{ regex: RegExp; symbolType: SymbolType }> {
    switch (language) {
      case 'typescript':
      case 'tsx':
      case 'javascript':
      case 'jsx':
        return [
          { regex: /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g, symbolType: 'function' },
          { regex: /(?:export\s+)?class\s+(\w+)/g, symbolType: 'class' },
          { regex: /(?:export\s+)?interface\s+(\w+)/g, symbolType: 'interface' },
          { regex: /(?:export\s+)?type\s+(\w+)\s*=/g, symbolType: 'type' },
          { regex: /(?:\w+\s*:\s*)?(?:async\s+)?(\w+)\s*\([^)]*\)\s*:/g, symbolType: 'method' },
        ];
      case 'python':
        return [
          { regex: /def\s+(\w+)/g, symbolType: 'function' },
          { regex: /class\s+(\w+)/g, symbolType: 'class' },
        ];
      case 'rust':
        return [
          { regex: /fn\s+(\w+)/g, symbolType: 'function' },
          { regex: /struct\s+(\w+)/g, symbolType: 'class' },
          { regex: /trait\s+(\w+)/g, symbolType: 'interface' },
          { regex: /impl\s+(\w+)/g, symbolType: 'class' },
        ];
      case 'go':
        return [
          { regex: /func\s+(?:\([^)]*\)\s+)?(\w+)\s*\(/g, symbolType: 'function' },
          { regex: /type\s+(\w+)\s/g, symbolType: 'type' },
        ];
      default:
        return [];
    }
  }

  /**
   * Find the end line of a symbol (heuristic: next symbol at same or lower indentation).
   * @param lines
   * @param startIdx
   * @param _language
   */
  private findSymbolEnd(lines: string[], startIdx: number, _language: string): number {
    if (startIdx >= lines.length) return startIdx + 1;
    const startIndent = lines[startIdx]?.match(/^\s*/)?.[0].length ?? 0;
    let endIdx = startIdx + 1;

    while (endIdx < lines.length) {
      const line = lines[endIdx] ?? '';
      if (line.trim().length === 0) {
        endIdx++;
        continue;
      }
      const indent = line.match(/^\s*/)?.[0].length ?? 0;
      if (indent <= startIndent && line.trim().length > 0) {
        break;
      }
      endIdx++;
    }

    return endIdx;
  }

  /**
   * Generate a unique chunk ID.
   * @param filePath
   * @param line
   * @param symbolName
   */
  private chunkId(filePath: string, line: number, symbolName: string): string {
    return `${filePath}:${line}:${symbolName}`;
  }

  /** Get the number of indexed files. */
  get fileCount(): number {
    return this.fileHashes.size;
  }

  /** Get all indexed file paths. */
  getIndexedFiles(): string[] {
    return [...this.fileHashes.keys()];
  }
}
