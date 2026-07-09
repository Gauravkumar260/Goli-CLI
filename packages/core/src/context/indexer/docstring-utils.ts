/**
 * Shared docstring extraction used by both the regex-based and the
 * native tree-sitter indexers.
 *
 * Extracted during dedup loop iteration 1 from previously-duplicated
 * implementations in `tree-sitter.ts` (private method) and
 * `real-tree-sitter.ts` (free function). Behavior is identical to
 * both originals.
 *
 * @module context/indexer
 */

/**
 * Extract the docstring/JSDoc comment above (or, for Python, immediately
 * after) a symbol identified by its line index.
 *
 * Recognized forms:
 *   - JSDoc block comments ending in a star-slash (walked backwards to the opening)
 *   - Python triple-quoted docstrings (`"""..."""` or `'''...'''`) that begin
 *     on the line immediately after the symbol definition
 *   - Single-line `//` or `#` comments sitting directly above the symbol
 *
 * Returns `undefined` when no docstring can be found.
 *
 * @param lines - Source file split into lines.
 * @param symbolIdx - 0-based index of the symbol's defining line.
 * @param language - Lower-case language id (`python`, `typescript`, …).
 */
export function extractDocstringFromTree(
  lines: string[],
  symbolIdx: number,
  language: string,
): string | undefined {
  let idx = symbolIdx - 1;
  while (idx >= 0 && (lines[idx]?.trim() ?? '') === '') idx--;
  if (idx < 0) return undefined;

  const line = lines[idx] ?? '';
  // JSDoc: ends with */
  if (line.trim().endsWith('*/')) {
    const docLines: string[] = [];
    while (idx >= 0 && !(lines[idx]?.includes('/**') ?? false)) {
      docLines.unshift(lines[idx] ?? '');
      idx--;
    }
    if (idx >= 0) docLines.unshift(lines[idx] ?? '');
    return docLines.join('\n');
  }
  // Python docstring: starts with """ or '''
  if (language === 'python') {
    // Check if the line after the def/class starts a docstring
    const afterSymbol = lines[symbolIdx + 1]?.trim() ?? '';
    if (afterSymbol.startsWith('"""') || afterSymbol.startsWith("'''")) {
      const quote = afterSymbol.startsWith('"""') ? '"""' : "'''";
      if (afterSymbol.endsWith(quote) && afterSymbol.length > 3) {
        return afterSymbol;
      }
      const docLines: string[] = [afterSymbol];
      let i = symbolIdx + 2;
      while (i < lines.length && !(lines[i]?.includes(quote) ?? false)) {
        docLines.push(lines[i] ?? '');
        i++;
      }
      if (i < lines.length) docLines.push(lines[i] ?? '');
      return docLines.join('\n');
    }
  }
  // Single-line comment: // or #
  if (line.trim().startsWith('//') || line.trim().startsWith('#')) {
    return line.trim();
  }
  return undefined;
}
