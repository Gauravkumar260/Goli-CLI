/**
 * LSP tools (H21 — LSP Integration).
 *
 * Four tools that wrap the LSP client interface for the model to use:
 *
 * - `lsp_hover` — get hover docs for a symbol
 * - `lsp_goto_definition` — jump to a symbol's definition
 * - `lsp_references` — find all references to a symbol
 * - `lsp_diagnostics` — get errors/warnings for a file
 *
 * All four delegate to `ctx.lspClient` (provided by the agent loop).
 * When no client is set, they throw with a helpful message.
 *
 * ## Line/column convention
 *
 * The model sees 1-based line numbers (human-readable) in file output
 * from `read_file`. The tools convert to 0-based internally (LSP
 * convention) before calling the client.
 *
 * Permission tier: T0 (read-only — LSP queries don't modify state).
 *
 * @module tools/core/lsp-tools
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { ToolExecutionError } from '../../utils/errors.js';

import {
  formatLocation,
  formatDiagnostic,
  type LspClient,
  type LspLocation,
  type LspDiagnostic,
  type LspHoverResult,
} from './lsp-types.js';
import { resolveUserPath, checkPathInWorkspace } from './path-safety.js';

import type { Tool, ToolResult, ToolContext } from '../types.js';

// ─── Shared helpers ────────────────────────────────────────────

function assertLspClient(ctx: ToolContext): LspClient {
  if (!ctx.lspClient) {
    throw new ToolExecutionError(
      'LSP tools are not available in this context (no lspClient on ToolContext). ' +
        'This likely means no language server is running for this workspace. ' +
        'Start a language server (e.g. typescript-language-server) and pass it to AgentLoopOptions.lspClient.',
      'lsp',
    );
  }
  return ctx.lspClient;
}

function resolveAndCheckFile(filePath: string, ctx: ToolContext): string {
  const resolvedPath = resolveUserPath(filePath, ctx.workspaceRoot);
  // The previous implementation only checked existence — it did NOT
  // verify the file was inside the workspace. A model could pass
  // `/etc/passwd` and the LSP would happily index it. We now route
  // through the shared `checkPathInWorkspace` helper so the same
  // boundary check (realpath-resolved, symlink-aware) applies.
  if (!existsSync(resolvedPath)) {
    throw new ToolExecutionError(`File not found: ${filePath}`, 'lsp');
  }
  if (!ctx.godMode) {
    const boundaryCheck = checkPathInWorkspace(resolvedPath, ctx.workspaceRoot, ctx.godMode);
    if (!boundaryCheck.ok) {
      throw new ToolExecutionError(boundaryCheck.reason, 'lsp');
    }
  }
  return resolvedPath;
}

function toAbsolute(locations: LspLocation[], workspaceRoot: string): LspLocation[] {
  return locations.map((loc) => ({
    ...loc,
    filePath: loc.filePath.startsWith('/')
      ? loc.filePath
      : resolve(workspaceRoot, loc.filePath),
  }));
}

// ─── lsp_hover ─────────────────────────────────────────────────

/** lsp_hover tool — get hover documentation for a symbol. */
export const LSP_HOVER_TOOL: Tool = {
  name: 'lsp_hover',
  description:
    'Get hover documentation for a symbol at a specific position in a file. Returns markdown ' +
    'content (type signature, JSDoc, docstring). Requires a running language server. ' +
    'Line and column are 1-based (matching read_file output).',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Absolute or workspace-relative file path.' },
      line: { type: 'integer', description: '1-based line number.' },
      column: { type: 'integer', description: '1-based column number.' },
    },
    required: ['file_path', 'line', 'column'],
    additionalProperties: false,
  },
  handler: async (args, ctx): Promise<ToolResult> => {
    const client = assertLspClient(ctx);
    const filePath = resolveAndCheckFile(args['file_path'] as string, ctx);
    const line = (args['line'] as number) - 1; // 1-based → 0-based
    const column = (args['column'] as number) - 1;
    if (line < 0 || column < 0) {
      throw new ToolExecutionError('line and column must be >= 1', 'lsp_hover');
    }
    const result: LspHoverResult | null = await client.hover(filePath, line, column);
    if (!result) {
      return {
        toolCallId: ctx.toolCallId,
        ok: true,
        content: `No hover information available at ${filePath}:${line + 1}:${column + 1}.`,
      };
    }
    return {
      toolCallId: ctx.toolCallId,
      ok: true,
      content: result.contents,
    };
  },
  tier: 'T0',
  readOnly: true,
};

// ─── lsp_goto_definition ───────────────────────────────────────

/** lsp_goto_definition tool — jump to a symbol's definition. */
export const LSP_GOTO_DEFINITION_TOOL: Tool = {
  name: 'lsp_goto_definition',
  description:
    'Find the definition of the symbol at a specific position. Returns one or more locations ' +
    '(file:line:column). Requires a running language server. Line and column are 1-based.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Absolute or workspace-relative file path.' },
      line: { type: 'integer', description: '1-based line number.' },
      column: { type: 'integer', description: '1-based column number.' },
    },
    required: ['file_path', 'line', 'column'],
    additionalProperties: false,
  },
  handler: async (args, ctx): Promise<ToolResult> => {
    const client = assertLspClient(ctx);
    const filePath = resolveAndCheckFile(args['file_path'] as string, ctx);
    const line = (args['line'] as number) - 1;
    const column = (args['column'] as number) - 1;
    if (line < 0 || column < 0) {
      throw new ToolExecutionError('line and column must be >= 1', 'lsp_goto_definition');
    }
    const locations = await client.gotoDefinition(filePath, line, column);
    const absLocations = toAbsolute(locations, ctx.workspaceRoot);
    if (absLocations.length === 0) {
      return {
        toolCallId: ctx.toolCallId,
        ok: true,
        content: `No definition found for symbol at ${filePath}:${line + 1}:${column + 1}.`,
      };
    }
    const formatted = absLocations.map(formatLocation).join('\n');
    return {
      toolCallId: ctx.toolCallId,
      ok: true,
      content: `Definition (${absLocations.length} location(s)):\n${formatted}`,
    };
  },
  tier: 'T0',
  readOnly: true,
};

// ─── lsp_references ───────────────────────────────────────────

/** lsp_references tool — find all references to a symbol. */
export const LSP_REFERENCES_TOOL: Tool = {
  name: 'lsp_references',
  description:
    'Find all references to the symbol at a specific position. Returns locations across the ' +
    'workspace. Requires a running language server. Line and column are 1-based.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Absolute or workspace-relative file path.' },
      line: { type: 'integer', description: '1-based line number.' },
      column: { type: 'integer', description: '1-based column number.' },
    },
    required: ['file_path', 'line', 'column'],
    additionalProperties: false,
  },
  handler: async (args, ctx): Promise<ToolResult> => {
    const client = assertLspClient(ctx);
    const filePath = resolveAndCheckFile(args['file_path'] as string, ctx);
    const line = (args['line'] as number) - 1;
    const column = (args['column'] as number) - 1;
    if (line < 0 || column < 0) {
      throw new ToolExecutionError('line and column must be >= 1', 'lsp_references');
    }
    const locations = await client.references(filePath, line, column);
    const absLocations = toAbsolute(locations, ctx.workspaceRoot);
    if (absLocations.length === 0) {
      return {
        toolCallId: ctx.toolCallId,
        ok: true,
        content: `No references found for symbol at ${filePath}:${line + 1}:${column + 1}.`,
      };
    }
    const formatted = absLocations.map((l, i) => `  ${i + 1}. ${formatLocation(l)}`).join('\n');
    return {
      toolCallId: ctx.toolCallId,
      ok: true,
      content: `References (${absLocations.length}):\n${formatted}`,
    };
  },
  tier: 'T0',
  readOnly: true,
};

// ─── lsp_diagnostics ──────────────────────────────────────────

/** lsp_diagnostics tool — get errors/warnings for a file. */
export const LSP_DIAGNOSTICS_TOOL: Tool = {
  name: 'lsp_diagnostics',
  description:
    'Get all diagnostics (errors, warnings, info, hints) for a file. Requires a running ' +
    'language server. Use this after editing a file to verify it has no type errors or lint issues.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Absolute or workspace-relative file path.' },
    },
    required: ['file_path'],
    additionalProperties: false,
  },
  handler: async (args, ctx): Promise<ToolResult> => {
    const client = assertLspClient(ctx);
    const filePath = resolveAndCheckFile(args['file_path'] as string, ctx);
    const diags: LspDiagnostic[] = await client.diagnostics(filePath);
    if (diags.length === 0) {
      return {
        toolCallId: ctx.toolCallId,
        ok: true,
        content: `No diagnostics for ${filePath}.`,
      };
    }
    const errors = diags.filter((d) => d.severity === 'error');
    const warnings = diags.filter((d) => d.severity === 'warning');
    const others = diags.filter((d) => d.severity === 'info' || d.severity === 'hint');
    const summary = `Diagnostics for ${filePath}: ${errors.length} error(s), ${warnings.length} warning(s), ${others.length} info/hint(s)`;
    const details = diags.map(formatDiagnostic).join('\n');
    return {
      toolCallId: ctx.toolCallId,
      ok: true,
      content: `${summary}\n${details}`,
    };
  },
  tier: 'T0',
  readOnly: true,
};

/** All four LSP tools, for convenient registration. */
export const LSP_TOOLS: Tool[] = [
  LSP_HOVER_TOOL,
  LSP_GOTO_DEFINITION_TOOL,
  LSP_REFERENCES_TOOL,
  LSP_DIAGNOSTICS_TOOL,
];

// ─── P1-19: Multi-language LSP router ──────────────────────────────────

/**
 * P1-19 fix (remediation plan Phase 19): map a file extension to its
 * LSP language ID. Used by `getClientForFile()` to route LSP queries
 * to the correct language server.
 *
 * The mapping covers the languages the codebase currently has LSP
 * clients for (TypeScript/JavaScript) plus stubs for Python and Rust
 * (registered via `registerLspClient()`). When a language has no
 * registered client, `getClientForFile()` throws with a helpful
 * message instead of silently falling back to the TypeScript client.
 */
export const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.pyw': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.kt': 'kotlin',
  '.rb': 'ruby',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.c': 'c',
  '.h': 'cpp',
  '.hpp': 'cpp',
};

/**
 * P1-19: registry of language-specific LSP clients. The TypeScript
 * client is the only one wired in by default; Python, Rust, etc.
 * are registered by callers via `registerLspClient()`.
 *
 * Each entry maps a language ID (e.g. `'python'`) to a `LspClient`
 * instance. The router in `getClientForFile()` looks up the language
 * by file extension, then looks up the client by language.
 */
const lspClientRegistry = new Map<string, LspClient>();

/**
 * P1-19: register an LSP client for a language.
 *
 * Callers (e.g. the CLI startup) construct an `LspClient` instance
 * for each language they want to support and register it here. The
 * `AgentLoop` then has access to all registered clients via
 * `getClientForFile()` — no need to plumb each one through
 * `AgentLoopOptions.lspClient` individually.
 *
 * @param language - The language ID (e.g. `'typescript'`, `'python'`).
 * @param client - The LSP client instance.
 */
export function registerLspClient(language: string, client: LspClient): void {
  lspClientRegistry.set(language, client);
}

/**
 * P1-19: get the LSP client for a given file path.
 *
 * Routes by file extension → language ID → registered client. When
 * the language has no registered client, returns `undefined` (the
 * caller should fall back to `ctx.lspClient` or throw).
 *
 * @param filePath - The file path to route on.
 * @returns The registered LSP client, or `undefined` when no client
 *   is registered for the file's language.
 */
export function getClientForFile(filePath: string): LspClient | undefined {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  const language = EXTENSION_TO_LANGUAGE[ext];
  if (!language) return undefined;
  return lspClientRegistry.get(language);
}

/**
 * P1-19: clear the LSP client registry. Mainly useful for tests.
 */
export function clearLspClientRegistry(): void {
  lspClientRegistry.clear();
}
