/**
 * Real tree-sitter adapter (H22).
 *
 * Wraps the `tree-sitter` and `tree-sitter-language-pack` npm packages
 * to provide AST-based symbol extraction. When the packages are not
 * installed (or fail to load), `isAvailable()` returns false and the
 * caller falls back to the regex-based extractor in `tree-sitter.ts`.
 *
 * ## Why an adapter (not a rewrite)?
 *
 * - The existing `TreeSitterIndexer` interface and `SemanticChunk`
 *   shape are unchanged — callers see no difference.
 * - The native packages are optional dependencies (not everyone needs
 *   tree-sitter; the regex fallback is sufficient for many users).
 * - The adapter isolates the dynamic import + native binding loading
 *   from the rest of the codebase.
 *
 * ## Why dynamic import?
 *
 * `tree-sitter` uses N-API native bindings. If the bindings are
 * missing (e.g., wrong platform, missing prebuilt binary), a static
 * `import` would crash the whole module. Dynamic `import()` lets us
 * catch the error and fall back gracefully.
 *
 * @module context/indexer/real-tree-sitter
 */

import { createHash } from 'node:crypto';

import { extractDocstringFromTree } from './docstring-utils.js';

import type { SemanticChunk, SymbolType } from '../types.js';

/** Cached availability check result. */
let availabilityCache: boolean | null = null;

/** Cached language pack (lazy-loaded). */
let languagePackCache: Record<string, unknown> | null = null;

/** Cached parser instances (one per language). */
const parserCache = new Map<string, unknown>();

/**
 * Check whether the `tree-sitter` and `tree-sitter-language-pack`
 * packages are installed and loadable.
 *
 * Caches the result after the first call.
 */
export async function isRealTreeSitterAvailable(): Promise<boolean> {
  if (availabilityCache !== null) return availabilityCache;
  try {
    // Dynamic import — if the packages aren't installed, this throws.
    const ts = await import('tree-sitter');
    const pack = await import('tree-sitter-language-pack');
    // Verify the exports are what we expect.
    if (typeof ts.default?.Parser !== 'function' && typeof ts.Parser !== 'function') {
      throw new Error('tree-sitter package missing Parser export');
    }
    if (!pack || typeof pack !== 'object') {
      throw new Error('tree-sitter-language-pack package is not an object');
    }
    languagePackCache = pack as Record<string, unknown>;
    availabilityCache = true;
    return true;
  } catch {
    availabilityCache = false;
    return false;
  }
}

/**
 * Get the parser for a language (cached).
 *
 * @param language - The tree-sitter language name (e.g. 'typescript', 'python').
 * @returns The parser instance, or null if unavailable.
 */
async function getParser(language: string): Promise<unknown | null> {
  if (!languagePackCache) return null;
  const cached = parserCache.get(language);
  if (cached) return cached;

  try {
    const ts = await import('tree-sitter');
    const Parser = ts.default?.Parser ?? ts.Parser;
    const Language = (languagePackCache as Record<string, unknown>)[language];
    if (!Language) return null;

    const parser = new Parser();
    // setLanguage is the standard tree-sitter API.
    type ParserWithSetLanguage = { setLanguage: (lang: unknown) => void };
    (parser as unknown as ParserWithSetLanguage).setLanguage(Language);
    parserCache.set(language, parser);
    return parser;
  } catch {
    return null;
  }
}

/** Tree-sitter node types that map to each SymbolType. */
const NODE_TYPE_MAP: Record<string, { symbolType: SymbolType; nameField: string }> = {
  // TypeScript / JavaScript
  function_declaration: { symbolType: 'function', nameField: 'name' },
  method_definition: { symbolType: 'method', nameField: 'name' },
  class_declaration: { symbolType: 'class', nameField: 'name' },
  interface_declaration: { symbolType: 'interface', nameField: 'name' },
  type_alias_declaration: { symbolType: 'type', nameField: 'name' },
  // Python
  function_definition: { symbolType: 'function', nameField: 'name' },
  class_definition: { symbolType: 'class', nameField: 'name' },
  // Rust
  function_item: { symbolType: 'function', nameField: 'name' },
  struct_item: { symbolType: 'class', nameField: 'name' },
  impl_item: { symbolType: 'class', nameField: 'name' },
  trait_item: { symbolType: 'interface', nameField: 'name' },
  // Go
  method_declaration: { symbolType: 'method', nameField: 'name' },
  type_declaration: { symbolType: 'type', nameField: 'name' },
};

/**
 * Extract semantic chunks from file content using real tree-sitter.
 *
 * @param filePath - The absolute file path.
 * @param content - The file content.
 * @param language - The tree-sitter language name.
 * @returns Array of semantic chunks (empty if parsing failed or unavailable).
 */
export async function extractChunksWithTreeSitter(
  filePath: string,
  content: string,
  language: string,
): Promise<SemanticChunk[]> {
  if (!(await isRealTreeSitterAvailable())) return [];

  const parser = await getParser(language);
  if (!parser) return [];

  try {
    type ParserWithParse = { parse: (input: string) => { rootNode: TreeNode } };
    const tree = (parser as unknown as ParserWithParse).parse(content);
    const root = tree.rootNode;
    const lines = content.split('\n');
    const chunks: SemanticChunk[] = [];

    walkTree(root, (node) => {
      const mapping = NODE_TYPE_MAP[node.type];
      if (!mapping) return;

      const nameNode = node.childForFieldName?.(mapping.nameField) ??
        node.children?.find((c) => c.type === 'identifier');
      const symbolName = nameNode?.text ?? '(anonymous)';

      // Tree-sitter uses 0-based rows; convert to 1-based for our convention.
      const startLine = (node.startPosition?.row ?? 0) + 1;
      const endLine = (node.endPosition?.row ?? startLine) + 1;
      const code = lines.slice(startLine - 1, endLine).join('\n');
      const docstring = extractDocstringFromTree(lines, startLine - 1, language);

      chunks.push({
        id: `${filePath}:${startLine}:${symbolName}`,
        filePath,
        language,
        lineRange: { start: startLine, end: endLine },
        code,
        symbolName,
        symbolType: mapping.symbolType,
        docstring,
        contentHash: createHash('sha256').update(code).digest('hex'),
      });
    });

    return chunks.sort((a, b) => a.lineRange.start - b.lineRange.start);
  } catch {
    return [];
  }
}

/** A minimal tree-sitter node interface (avoids coupling to the tree-sitter package). */
interface TreeNode {
  type: string;
  text?: string;
  startPosition?: { row: number; column: number };
  endPosition?: { row: number; column: number };
  childForFieldName?: (name: string) => TreeNode | null;
  children?: TreeNode[];
  childCount?: number;
}

/**
 * Walk a tree-sitter AST depth-first, calling the visitor for each node.
 * @param node
 * @param visitor
 */
function walkTree(node: TreeNode, visitor: (node: TreeNode) => void): void {
  visitor(node);
  if (node.children) {
    for (const child of node.children) {
      walkTree(child, visitor);
    }
  } else if (node.childCount && node.childCount > 0) {
    // Some tree-sitter bindings use child(i) instead of children[].
    // We handle both for compatibility.
    for (let i = 0; i < node.childCount; i++) {
      const child = (node as unknown as { child: (i: number) => TreeNode | null }).child(i);
      if (child) walkTree(child, visitor);
    }
  }
}

/**
 * Reset the availability cache (for tests).
 */
export function _resetTreeSitterCache(): void {
  availabilityCache = null;
  languagePackCache = null;
  parserCache.clear();
}
