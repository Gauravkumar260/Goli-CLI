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

  // Read the notebook.
  let notebook: Notebook;
  try {
    const raw = readFileSync(resolvedPath, 'utf-8');
    notebook = JSON.parse(raw) as Notebook;
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
      notebook.cells[cellIndex]!.source = sourceLines;
      if (cellType === 'code') {
        notebook.cells[cellIndex]!.outputs = [];
        notebook.cells[cellIndex]!.execution_count = null;
      }
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
