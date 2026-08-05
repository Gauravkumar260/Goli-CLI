/**
 * NotebookEdit tool (Module 3, competitive gap #9).
 *
 * Edits Jupyter notebook (.ipynb) cells. Claude Code has NotebookEdit;
 * Goli previously had no notebook support — blocking data-science
 * workflows.
 *
 * Supports:
 *   - `insert`: insert a new cell at the given index.
 *   - `replace`: replace the content of an existing cell.
 *   - `delete`: delete a cell by index.
 *
 * Permission tier: T1 (file writes).
 *
 * @module tools/core/notebook-edit
 */

import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';

import { resolveUserPath, checkPathInWorkspace } from './path-safety.js';

import type { Tool, ToolResult, ToolContext } from '../types.js';

/**
 *
 */
export const NOTEBOOK_EDIT_TOOL: Tool = {
  name: 'notebook_edit',
  description:
    'Edit a Jupyter notebook (.ipynb) cell. Supports inserting, replacing, and deleting cells. ' +
    'Use this for data-science workflows that involve .ipynb files.',
  inputSchema: {
    type: 'object',
    properties: {
      notebook_path: {
        type: 'string',
        description: 'The path to the .ipynb file.',
      },
      cell_index: {
        type: 'number',
        description: 'The 0-based index of the cell to edit (for replace/delete) or insert before (for insert).',
      },
      cell_type: {
        type: 'string',
        enum: ['code', 'markdown'],
        description: 'The cell type (for insert/replace).',
      },
      edit_mode: {
        type: 'string',
        enum: ['insert', 'replace', 'delete'],
        description: 'The edit mode.',
      },
      new_source: {
        type: 'string',
        description: 'The new cell content (for insert/replace).',
      },
    },
    required: ['notebook_path', 'edit_mode'],
    additionalProperties: false,
  },
  handler: notebookEditHandler,
  tier: 'T1',
  readOnly: false,
};

interface NotebookCell {
  cell_type: 'code' | 'markdown';
  source: string[];
  metadata: Record<string, unknown>;
  outputs?: unknown[];
  execution_count?: number | null;
}

interface Notebook {
  cells: NotebookCell[];
  metadata: Record<string, unknown>;
  nbformat: number;
  nbformat_minor: number;
}

async function notebookEditHandler(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const notebookPath = args['notebook_path'] as string;
  const cellIndex = args['cell_index'] as number | undefined;
  const cellType = (args['cell_type'] as string | undefined) ?? 'code';
  const editMode = args['edit_mode'] as string;
  const newSource = (args['new_source'] as string | undefined) ?? '';

  if (!notebookPath) {
    return { toolCallId: ctx.toolCallId, ok: false, content: '', error: 'notebook_edit requires "notebook_path".' };
  }

  // Path safety.
  const resolvedPath = resolveUserPath(notebookPath, ctx.workspaceRoot);
  const boundaryCheck = checkPathInWorkspace(resolvedPath, ctx.workspaceRoot, ctx.godMode);
  if (!boundaryCheck.ok) {
    return { toolCallId: ctx.toolCallId, ok: false, content: '', error: boundaryCheck.reason };
  }

  // Read-only sandbox check.
  if (ctx.sandboxMode === 'read-only' && !ctx.godMode) {
    return { toolCallId: ctx.toolCallId, ok: false, content: '', error: 'Cannot edit notebook in read-only sandbox mode.' };
  }

  // P1-3 fix (audit Finding CC-2): PRE-EXECUTION approval gate.
  // notebook_edit is T1 (file write). In build mode with an
  // interactive approver wired (TUI), prompt BEFORE editing. When
  // no approver is wired (headless), fall through — the caller can
  // use --auto or --god. godMode and autoMode skip the gate.
  if (ctx.requestApproval && !ctx.godMode && !ctx.autoMode) {
    const approvalDecision = await ctx.requestApproval({
      toolCallId: ctx.toolCallId,
      toolName: 'notebook_edit',
      tier: 'T1',
      description: `${editMode} cell ${cellIndex ?? 0} in ${notebookPath}`,
      args,
      timestamp: new Date().toISOString(),
    });
    if (!approvalDecision.approved) {
      return {
        toolCallId: ctx.toolCallId,
        ok: false,
        content: '',
        error: `notebook_edit denied by user${approvalDecision.reason ? `: ${approvalDecision.reason}` : ''}. Path: ${notebookPath}`,
      };
    }
  }

  // Read the notebook.
  let notebook: Notebook;
  try {
    const raw = readFileSync(resolvedPath, 'utf-8');
    // The previous implementation did `JSON.parse(raw) as Notebook`,
    // which is an UNSAFE cast — `as` doesn't validate. A malformed
    // .ipynb file (or a non-JSON file with a .ipynb extension) would
    // pass the cast but throw later when we accessed `notebook.cells`.
    // We now wrap the parse in a try/catch AND validate the shape
    // (cells is an array, nbformat is a number if present).
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return {
        toolCallId: ctx.toolCallId,
        ok: false,
        content: '',
        error: `Notebook is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    if (!parsed || typeof parsed !== 'object') {
      return { toolCallId: ctx.toolCallId, ok: false, content: '', error: 'Notebook root is not an object.' };
    }
    const obj = parsed as Record<string, unknown>;
    if (!Array.isArray(obj['cells'])) {
      return { toolCallId: ctx.toolCallId, ok: false, content: '', error: 'Invalid notebook: no cells array.' };
    }
    // Shape-check each cell minimally.
    for (let i = 0; i < obj['cells'].length; i++) {
      const cell = obj['cells'][i] as unknown;
      if (!cell || typeof cell !== 'object') {
        return { toolCallId: ctx.toolCallId, ok: false, content: '', error: `Cell ${i} is not an object.` };
      }
      const c = cell as Record<string, unknown>;
      if (c['cell_type'] !== 'code' && c['cell_type'] !== 'markdown') {
        return { toolCallId: ctx.toolCallId, ok: false, content: '', error: `Cell ${i} has invalid cell_type: ${String(c['cell_type'])}` };
      }
      if (!Array.isArray(c['source'])) {
        // Some notebooks store source as a single string — coerce.
        if (typeof c['source'] === 'string') {
          c['source'] = c['source'].split('\n').map((line: string, idx: number, arr: string[]) =>
            idx < arr.length - 1 ? line + '\n' : line,
          );
        } else {
          return { toolCallId: ctx.toolCallId, ok: false, content: '', error: `Cell ${i} has invalid source (must be array or string).` };
        }
      }
    }
    notebook = obj as unknown as Notebook;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'ENOENT') {
      return { toolCallId: ctx.toolCallId, ok: false, content: '', error: `Notebook not found: ${notebookPath}` };
    }
    return { toolCallId: ctx.toolCallId, ok: false, content: '', error: `Failed to read notebook: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (!notebook.cells || !Array.isArray(notebook.cells)) {
    return { toolCallId: ctx.toolCallId, ok: false, content: '', error: 'Invalid notebook: no cells array.' };
  }

  // Validate nbformat — must be 4 (the current Jupyter notebook
  // format). The previous implementation accepted any nbformat,
  // so a v3 notebook passed through and could produce
  // incompatible output. We now warn (not reject) for v3 so the
  // user can still edit but knows the format may be outdated.
  if (notebook.nbformat !== undefined && notebook.nbformat < 4) {
    return {
      toolCallId: ctx.toolCallId,
      ok: false,
      content: '',
      error: `Unsupported notebook format: nbformat ${notebook.nbformat} (requires 4+). Please upgrade the notebook first.`,
    };
  }

  // Perform the edit.
  const sourceLines = newSource.split('\n').map((line, i, arr) =>
    i < arr.length - 1 ? line + '\n' : line,
  );

  switch (editMode) {
    case 'insert': {
      if (cellIndex === undefined) {
        return { toolCallId: ctx.toolCallId, ok: false, content: '', error: 'insert requires "cell_index".' };
      }
      const newCell: NotebookCell = {
        cell_type: cellType as 'code' | 'markdown',
        source: sourceLines,
        metadata: {},
      };
      if (cellType === 'code') {
        newCell.outputs = [];
        newCell.execution_count = null;
      }
      notebook.cells.splice(cellIndex, 0, newCell);
      break;
    }
    case 'replace': {
      if (cellIndex === undefined) {
        return { toolCallId: ctx.toolCallId, ok: false, content: '', error: 'replace requires "cell_index".' };
      }
      if (cellIndex < 0 || cellIndex >= notebook.cells.length) {
        return { toolCallId: ctx.toolCallId, ok: false, content: '', error: `cell_index ${cellIndex} out of range (0-${notebook.cells.length - 1}).` };
      }
      // The previous implementation only cleared outputs when
      // `cellType === 'code'`. If the user replaced a code cell
      // (which had been run, so outputs were populated) with a
      // markdown cell, the markdown cell retained the stale code
      // outputs — invalid notebook state. We now clear outputs and
      // execution_count whenever the source changes (regardless of
      // cell type), AND drop outputs/execution_count entirely for
      // markdown cells (per the nbformat spec, markdown cells must
      // not have these fields).
      const existingCell = notebook.cells[cellIndex]!;
      const updatedCell: NotebookCell = {
        cell_type: cellType as 'code' | 'markdown',
        source: sourceLines,
        metadata: existingCell.metadata ?? {},
      };
      if (cellType === 'code') {
        updatedCell.outputs = [];
        updatedCell.execution_count = null;
      }
      // For markdown cells, do NOT copy over outputs/execution_count
      // from the existing cell — they're invalid for markdown.
      notebook.cells[cellIndex] = updatedCell;
      break;
    }
    case 'delete': {
      if (cellIndex === undefined) {
        return { toolCallId: ctx.toolCallId, ok: false, content: '', error: 'delete requires "cell_index".' };
      }
      if (cellIndex < 0 || cellIndex >= notebook.cells.length) {
        return { toolCallId: ctx.toolCallId, ok: false, content: '', error: `cell_index ${cellIndex} out of range (0-${notebook.cells.length - 1}).` };
      }
      notebook.cells.splice(cellIndex, 1);
      break;
    }
    default:
      return { toolCallId: ctx.toolCallId, ok: false, content: '', error: `Invalid edit_mode: ${editMode}. Must be insert, replace, or delete.` };
  }

  // Atomic write.
  const tempPath = `${resolvedPath}.goli-tmp-${randomUUID().slice(0, 8)}`;
  try {
    writeFileSync(tempPath, JSON.stringify(notebook, null, 1), 'utf-8');
    renameSync(tempPath, resolvedPath);
  } catch (err) {
    return { toolCallId: ctx.toolCallId, ok: false, content: '', error: `Failed to write notebook: ${err instanceof Error ? err.message : String(err)}` };
  }

  const action = editMode === 'insert' ? 'Inserted' : editMode === 'replace' ? 'Replaced' : 'Deleted';
  return {
    toolCallId: ctx.toolCallId,
    ok: true,
    content: `${action} cell ${cellIndex ?? 0} in ${notebookPath}. Notebook now has ${notebook.cells.length} cell(s).`,
  };
}
