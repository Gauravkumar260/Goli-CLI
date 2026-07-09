/**
 * Unit tests for H21: LSP Integration.
 *
 * Uses a mock LSP client to verify the four LSP tools:
 *   - lsp_hover returns hover contents
 *   - lsp_hover returns "no hover" message when client returns null
 *   - lsp_goto_definition returns formatted locations
 *   - lsp_references returns formatted locations with numbering
 *   - lsp_diagnostics returns formatted diagnostics with summary
 *   - All tools throw when no lspClient is set
 *   - All tools convert 1-based line/column to 0-based
 *   - All tools validate line/column >= 1
 *   - formatLocation and formatDiagnostic produce correct output
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  LSP_HOVER_TOOL,
  LSP_GOTO_DEFINITION_TOOL,
  LSP_REFERENCES_TOOL,
  LSP_DIAGNOSTICS_TOOL,
} from '../../packages/core/src/tools/core/lsp-tools.js';
import {
  formatLocation,
  formatDiagnostic,
  type LspClient,
  type LspLocation,
  type LspHoverResult,
  type LspDiagnostic,
} from '../../packages/core/src/tools/core/lsp-types.js';

import type { ToolContext } from '../../packages/core/src/tools/types.js';

function makeMockLspClient(overrides: Partial<LspClient> = {}): LspClient {
  return {
    hover: async (): Promise<LspHoverResult | null> => ({
      contents: '```typescript\nfunction foo(): void\n```\n\nDoes foo things.',
    }),
    gotoDefinition: async (): Promise<LspLocation[]> => [
      { filePath: '/tmp/repo/src/foo.ts', line: 10, column: 5 },
    ],
    references: async (): Promise<LspLocation[]> => [
      { filePath: '/tmp/repo/src/a.ts', line: 1, column: 0 },
      { filePath: '/tmp/repo/src/b.ts', line: 20, column: 10 },
    ],
    diagnostics: async (): Promise<LspDiagnostic[]> => [
      { line: 5, column: 0, severity: 'error', message: 'Cannot find name foo', source: 'typescript', code: 'TS2304' },
      { line: 10, column: 5, severity: 'warning', message: 'Unused variable', source: 'typescript' },
    ],
    ...overrides,
  };
}

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    toolCallId: 'test-tc',
    workspaceRoot: '/tmp/test-workspace',
    readFiles: new Set(),
    godMode: false,
    autoMode: false,
    sandboxMode: 'workspace-write',
    lspClient: makeMockLspClient(),
    ...overrides,
  };
}

describe('H21 formatLocation', () => {
  it('formats a single-point location', () => {
    const loc: LspLocation = { filePath: '/foo.ts', line: 5, column: 10 };
    expect(formatLocation(loc)).toBe('/foo.ts:6:11');
  });

  it('formats a range location', () => {
    const loc: LspLocation = { filePath: '/foo.ts', line: 5, column: 10, endLine: 6, endColumn: 15 };
    expect(formatLocation(loc)).toBe('/foo.ts:6:11-7:16');
  });
});

describe('H21 formatDiagnostic', () => {
  it('formats a diagnostic with source and code', () => {
    const diag: LspDiagnostic = {
      line: 5,
      column: 0,
      severity: 'error',
      message: 'Cannot find name foo',
      source: 'typescript',
      code: 'TS2304',
    };
    const str = formatDiagnostic(diag);
    expect(str).toContain('ERROR');
    expect(str).toContain('[typescript:TS2304]');
    expect(str).toContain('Cannot find name foo');
    expect(str).toContain(':6:1');
  });

  it('formats a diagnostic without source', () => {
    const diag: LspDiagnostic = {
      line: 10,
      column: 5,
      severity: 'warning',
      message: 'Unused variable',
    };
    const str = formatDiagnostic(diag);
    expect(str).toContain('WARNING');
    expect(str).toContain('Unused variable');
  });
});

describe('H21 lsp_hover', () => {
  let workspace: string;
  let filePath: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'goli-h21-hover-'));
    filePath = join(workspace, 'test.ts');
    writeFileSync(filePath, 'const x = 1;\n', 'utf-8');
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('returns hover contents', async () => {
    const ctx = makeContext({ workspaceRoot: workspace });
    const result = await LSP_HOVER_TOOL.handler(
      { file_path: filePath, line: 1, column: 1 },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(result.content).toContain('function foo(): void');
  });

  it('returns "no hover" message when client returns null', async () => {
    const ctx = makeContext({
      workspaceRoot: workspace,
      lspClient: makeMockLspClient({ hover: async () => null }),
    });
    const result = await LSP_HOVER_TOOL.handler(
      { file_path: filePath, line: 1, column: 1 },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(result.content).toContain('No hover information');
  });

  it('converts 1-based to 0-based coordinates', async () => {
    let capturedLine: number | undefined;
    let capturedCol: number | undefined;
    const ctx = makeContext({
      workspaceRoot: workspace,
      lspClient: makeMockLspClient({
        hover: async (_p, line, col) => {
          capturedLine = line;
          capturedCol = col;
          return { contents: 'hover' };
        },
      }),
    });
    await LSP_HOVER_TOOL.handler(
      { file_path: filePath, line: 5, column: 10 },
      ctx,
    );
    // 1-based (5, 10) → 0-based (4, 9)
    expect(capturedLine).toBe(4);
    expect(capturedCol).toBe(9);
  });

  it('validates line/column >= 1', async () => {
    const ctx = makeContext({ workspaceRoot: workspace });
    await expect(
      LSP_HOVER_TOOL.handler(
        { file_path: filePath, line: 0, column: 1 },
        ctx,
      ),
    ).rejects.toThrow('>= 1');
  });
});

describe('H21 lsp_goto_definition', () => {
  let workspace: string;
  let filePath: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'goli-h21-goto-'));
    filePath = join(workspace, 'test.ts');
    writeFileSync(filePath, 'const x = 1;\n', 'utf-8');
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('returns formatted locations', async () => {
    const ctx = makeContext({ workspaceRoot: workspace });
    const result = await LSP_GOTO_DEFINITION_TOOL.handler(
      { file_path: filePath, line: 1, column: 1 },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(result.content).toContain('Definition');
    expect(result.content).toContain('/tmp/repo/src/foo.ts');
  });

  it('returns "no definition" message when client returns empty array', async () => {
    const ctx = makeContext({
      workspaceRoot: workspace,
      lspClient: makeMockLspClient({ gotoDefinition: async () => [] }),
    });
    const result = await LSP_GOTO_DEFINITION_TOOL.handler(
      { file_path: filePath, line: 1, column: 1 },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(result.content).toContain('No definition found');
  });
});

describe('H21 lsp_references', () => {
  let workspace: string;
  let filePath: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'goli-h21-refs-'));
    filePath = join(workspace, 'test.ts');
    writeFileSync(filePath, 'const x = 1;\n', 'utf-8');
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('returns numbered references', async () => {
    const ctx = makeContext({ workspaceRoot: workspace });
    const result = await LSP_REFERENCES_TOOL.handler(
      { file_path: filePath, line: 1, column: 1 },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(result.content).toContain('References (2)');
    expect(result.content).toContain('1.');
    expect(result.content).toContain('2.');
  });

  it('returns "no references" message when client returns empty array', async () => {
    const ctx = makeContext({
      workspaceRoot: workspace,
      lspClient: makeMockLspClient({ references: async () => [] }),
    });
    const result = await LSP_REFERENCES_TOOL.handler(
      { file_path: filePath, line: 1, column: 1 },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(result.content).toContain('No references found');
  });
});

describe('H21 lsp_diagnostics', () => {
  let workspace: string;
  let filePath: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'goli-h21-diag-'));
    filePath = join(workspace, 'test.ts');
    writeFileSync(filePath, 'const x = 1;\n', 'utf-8');
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('returns diagnostics with summary', async () => {
    const ctx = makeContext({ workspaceRoot: workspace });
    const result = await LSP_DIAGNOSTICS_TOOL.handler(
      { file_path: filePath },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(result.content).toContain('1 error(s)');
    expect(result.content).toContain('1 warning(s)');
    expect(result.content).toContain('Cannot find name foo');
    expect(result.content).toContain('Unused variable');
  });

  it('returns "no diagnostics" message when client returns empty array', async () => {
    const ctx = makeContext({
      workspaceRoot: workspace,
      lspClient: makeMockLspClient({ diagnostics: async () => [] }),
    });
    const result = await LSP_DIAGNOSTICS_TOOL.handler(
      { file_path: filePath },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(result.content).toContain('No diagnostics');
  });
});

describe('H21 LSP tools without a client', () => {
  let workspace: string;
  let filePath: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'goli-h21-noclient-'));
    filePath = join(workspace, 'test.ts');
    writeFileSync(filePath, 'const x = 1;\n', 'utf-8');
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('lsp_hover throws when no client is set', async () => {
    const ctx = makeContext({ workspaceRoot: workspace, lspClient: undefined });
    await expect(
      LSP_HOVER_TOOL.handler({ file_path: filePath, line: 1, column: 1 }, ctx),
    ).rejects.toThrow('LSP tools are not available');
  });

  it('lsp_goto_definition throws when no client is set', async () => {
    const ctx = makeContext({ workspaceRoot: workspace, lspClient: undefined });
    await expect(
      LSP_GOTO_DEFINITION_TOOL.handler({ file_path: filePath, line: 1, column: 1 }, ctx),
    ).rejects.toThrow('LSP tools are not available');
  });

  it('lsp_references throws when no client is set', async () => {
    const ctx = makeContext({ workspaceRoot: workspace, lspClient: undefined });
    await expect(
      LSP_REFERENCES_TOOL.handler({ file_path: filePath, line: 1, column: 1 }, ctx),
    ).rejects.toThrow('LSP tools are not available');
  });

  it('lsp_diagnostics throws when no client is set', async () => {
    const ctx = makeContext({ workspaceRoot: workspace, lspClient: undefined });
    await expect(
      LSP_DIAGNOSTICS_TOOL.handler({ file_path: filePath }, ctx),
    ).rejects.toThrow('LSP tools are not available');
  });
});
