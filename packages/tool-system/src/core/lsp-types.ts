/**
 * LSP types and client interface (H21).
 *
 * Defines the contract for a Language Server Protocol client. The
 * actual implementation (spawning language servers, JSON-RPC over
 * stdio) is provided by the agent loop or TUI; the tools in
 * `lsp-hover.ts`, `lsp-goto-definition.ts`, `lsp-references.ts`, and
 * `lsp-diagnostics.ts` consume this interface.
 *
 * ## Why an interface (not a concrete class)?
 *
 * - The tool layer cannot depend on a specific LSP client
 *   implementation (would couple core to `vscode-languageserver-protocol`).
 * - Tests can provide a mock client without spawning real servers.
 * - Multiple implementations are possible (real LSP, in-process TS
 *   Compiler API, etc.).
 *
 * ## Why LSP?
 *
 * ADR-0022 chose tree-sitter over LSP for the context engine (static
 * analysis). H21 adds LSP as a *complementary* tool for live
 * diagnostics, hover docs, and goto-definition — things tree-sitter
 * cannot provide. The two coexist: tree-sitter for the indexer,
 * LSP for interactive queries.
 *
 * @module tools/core/lsp-types
 */

/** A source location (file + line + column, 0-based per LSP convention). */
export interface LspLocation {
  /** Absolute file path. */
  filePath: string;
  /** 0-based line number. */
  line: number;
  /** 0-based column number (UTF-16 code units). */
  column: number;
  /** End line (for ranges). */
  endLine?: number;
  /** End column (for ranges). */
  endColumn?: number;
  /** The text content of the line (optional, for display). */
  text?: string;
}

/** The result of an LSP hover request. */
export interface LspHoverResult {
  /** The hover contents (markdown). */
  contents: string;
  /** The source range the hover applies to (optional). */
  range?: {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  };
}

/** The severity of an LSP diagnostic. */
export type LspSeverity = 'error' | 'warning' | 'info' | 'hint';

/** A single LSP diagnostic. */
export interface LspDiagnostic {
  /** 0-based line number. */
  line: number;
  /** 0-based column number. */
  column: number;
  /** End line (for ranges). */
  endLine?: number;
  /** End column (for ranges). */
  endColumn?: number;
  /** The severity. */
  severity: LspSeverity;
  /** The diagnostic message. */
  message: string;
  /** The source (e.g. 'typescript', 'eslint', 'pyright'). */
  source?: string;
  /** The diagnostic code (e.g. 'TS2304'). */
  code?: string;
}

/** The LSP client interface that tools consume. */
export interface LspClient {
  /**
   * Get hover documentation for a symbol at a position.
   *
   * @param filePath - Absolute file path.
   * @param line - 0-based line number.
   * @param column - 0-based column number.
   */
  hover(filePath: string, line: number, column: number): Promise<LspHoverResult | null>;

  /**
   * Go to the definition of the symbol at a position.
   *
   * @param filePath - Absolute file path.
   * @param line - 0-based line number.
   * @param column - 0-based column number.
   * @returns Array of locations (usually 1, but can be 0 or multiple).
   */
  gotoDefinition(filePath: string, line: number, column: number): Promise<LspLocation[]>;

  /**
   * Find all references to the symbol at a position.
   *
   * @param filePath - Absolute file path.
   * @param line - 0-based line number.
   * @param column - 0-based column number.
   * @returns Array of locations.
   */
  references(filePath: string, line: number, column: number): Promise<LspLocation[]>;

  /**
   * Get diagnostics for a file.
   *
   * @param filePath - Absolute file path.
   * @returns Array of diagnostics (errors, warnings, info, hints).
   */
  diagnostics(filePath: string): Promise<LspDiagnostic[]>;
}

/**
 * Format an `LspLocation` as a human-readable string.
 * @param loc
 */
export function formatLocation(loc: LspLocation): string {
  const range = loc.endLine !== undefined
    ? `:${loc.line + 1}:${loc.column + 1}-${loc.endLine + 1}:${(loc.endColumn ?? loc.column) + 1}`
    : `:${loc.line + 1}:${loc.column + 1}`;
  return `${loc.filePath}${range}`;
}

/**
 * Format an `LspDiagnostic` as a human-readable string.
 * @param diag
 */
export function formatDiagnostic(diag: LspDiagnostic): string {
  const severity = diag.severity.toUpperCase().padEnd(7);
  const source = diag.source ? `[${diag.source}${diag.code ? `:${diag.code}` : ''}] ` : '';
  const range = diag.endLine !== undefined
    ? `:${diag.line + 1}:${diag.column + 1}-${diag.endLine + 1}:${(diag.endColumn ?? diag.column) + 1}`
    : `:${diag.line + 1}:${diag.column + 1}`;
  return `  ${severity} ${source}${range}  ${diag.message}`;
}
