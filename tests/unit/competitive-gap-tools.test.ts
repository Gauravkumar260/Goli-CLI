/**
 * Unit tests for the competitive-gap tools (web search, web fetch,
 * todo_write, background shell, ask_user, notebook_edit).
 */

import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';


import { startBackgroundShell, cleanupAllShells, getActiveShells, hasShell } from '../../packages/core/src/tools/core/background-shell.js';
import { TODO_WRITE_TOOL, getCurrentTodos, clearTodos } from '../../packages/core/src/tools/core/todo-write.js';
import { createDefaultToolRegistry } from '../../packages/core/src/tools/index.js';
import { type ToolRegistry } from '../../packages/core/src/tools/registry.js';

import type { ToolCall } from '../../packages/core/src/agent/types.js';
import type { ToolContext } from '../../packages/core/src/tools/types.js';

let workspace: string;
let registry: ToolRegistry;
let ctx: ToolContext;

function makeToolCall(name: string, args: Record<string, unknown>): ToolCall {
  return {
    id: `tc-${Math.random().toString(36).slice(2)}`,
    name,
    arguments: JSON.stringify(args),
    argumentsParsed: args,
    status: 'pending',
  };
}

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'goli-gap-tools-'));
  registry = createDefaultToolRegistry();
  ctx = {
    toolCallId: 'test',
    workspaceRoot: workspace,
    readFiles: new Set(),
    godMode: false,
    autoMode: false,
    sandboxMode: 'workspace-write',
  };
  clearTodos();
  cleanupAllShells();
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function removeWorkspaceDir(): Promise<void> {
  // On Windows a just-killed child process may still hold the workspace
  // dir as its CWD; the OS releases the handle asynchronously. Retry a
  // few times with a short delay before giving up.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(workspace, { recursive: true, force: true });
      return;
    } catch {
      await sleep(25);
    }
  }
  rmSync(workspace, { recursive: true, force: true });
}

afterEach(async () => {
  // Kill any live shells BEFORE removing the workspace dir — on Windows a
  // spawned child holding the dir as its CWD makes rmSync throw EPERM.
  cleanupAllShells();
  await removeWorkspaceDir();
  clearTodos();
});

describe('Competitive gap tools registered', () => {
  it('registers all expected tools (core + gap + spec + lsp + subagent)', () => {
    const tools = registry.list();
    // 13 original (6 core + 7 gap) + 3 spec + 1 spawn_subagent + 4 LSP = 21
    expect(tools).toHaveLength(21);
  });

  it('includes web_search', () => {
    expect(registry.list().some((t) => t.name === 'web_search')).toBe(true);
  });

  it('includes web_fetch', () => {
    expect(registry.list().some((t) => t.name === 'web_fetch')).toBe(true);
  });

  it('includes todo_write', () => {
    expect(registry.list().some((t) => t.name === 'todo_write')).toBe(true);
  });

  it('includes bash_output', () => {
    expect(registry.list().some((t) => t.name === 'bash_output')).toBe(true);
  });

  it('includes kill_shell', () => {
    expect(registry.list().some((t) => t.name === 'kill_shell')).toBe(true);
  });

  it('includes ask_user', () => {
    expect(registry.list().some((t) => t.name === 'ask_user')).toBe(true);
  });

  it('includes notebook_edit', () => {
    expect(registry.list().some((t) => t.name === 'notebook_edit')).toBe(true);
  });
});

describe('TodoWrite tool', () => {
  it('creates a todo list', async () => {
    const result = await registry.dispatch(
      makeToolCall('todo_write', {
        todos: [
          { content: 'Read the file', status: 'pending', priority: 'high' },
          { content: 'Edit the file', status: 'pending', priority: 'medium' },
          { content: 'Run tests', status: 'pending', priority: 'low' },
        ],
      }),
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(result.content).toContain('Read the file');
    expect(result.content).toContain('[ ]');
    expect(result.content).toContain('[HIGH]');
  });

  it('marks one item as in_progress', async () => {
    await registry.dispatch(
      makeToolCall('todo_write', {
        todos: [
          { content: 'Task 1', status: 'completed', priority: 'high' },
          { content: 'Task 2', status: 'in_progress', priority: 'high' },
          { content: 'Task 3', status: 'pending', priority: 'low' },
        ],
      }),
      ctx,
    );
    const todos = getCurrentTodos();
    expect(todos).toHaveLength(3);
    expect(todos[1]!.status).toBe('in_progress');
  });

  it('enforces at most one in_progress (demotes extras)', async () => {
    await registry.dispatch(
      makeToolCall('todo_write', {
        todos: [
          { content: 'Task 1', status: 'in_progress', priority: 'high' },
          { content: 'Task 2', status: 'in_progress', priority: 'high' },
        ],
      }),
      ctx,
    );
    const todos = getCurrentTodos();
    const inProgress = todos.filter((t) => t.status === 'in_progress');
    expect(inProgress).toHaveLength(1);
    expect(todos[1]!.status).toBe('pending'); // demoted
  });

  it('shows progress summary', async () => {
    const result = await registry.dispatch(
      makeToolCall('todo_write', {
        todos: [
          { content: 'Done', status: 'completed', priority: 'high' },
          { content: 'Todo', status: 'pending', priority: 'low' },
        ],
      }),
      ctx,
    );
    expect(result.content).toContain('1/2 completed');
  });

  it('rejects missing content', async () => {
    const result = await registry.dispatch(
      makeToolCall('todo_write', { todos: [{ status: 'pending', priority: 'high' }] }),
      ctx,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('content');
  });

  it('rejects invalid status', async () => {
    const result = await registry.dispatch(
      makeToolCall('todo_write', {
        todos: [{ content: 'x', status: 'invalid', priority: 'high' }],
      }),
      ctx,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('status');
  });
});

describe('Background shell management', () => {
  it('starts a background shell and assigns an ID', () => {
    const id = startBackgroundShell('echo hello', workspace);
    expect(id).toMatch(/^shell-\d+$/);
    expect(hasShell(id)).toBe(true);
    expect(getActiveShells()).toContain(id);
  });

  it('reads output from a background shell', async () => {
    const id = startBackgroundShell('echo "test output"', workspace);
    // Wait for the process to produce output.
    await new Promise((resolve) => setTimeout(resolve, 500));

    const result = await registry.dispatch(
      makeToolCall('bash_output', { shell_id: id }),
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(result.content).toContain('test output');
  });

  it('kills a background shell', async () => {
    const id = startBackgroundShell('sleep 60', workspace);
    expect(hasShell(id)).toBe(true);

    const result = await registry.dispatch(
      makeToolCall('kill_shell', { shell_id: id }),
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(result.content).toContain('terminated');
  });

  it('returns error for non-existent shell', async () => {
    const result = await registry.dispatch(
      makeToolCall('bash_output', { shell_id: 'nonexistent' }),
      ctx,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('No background shell');
  });
});

describe('AskUserQuestion tool', () => {
  it('returns the question as content (interactive mode)', async () => {
    const result = await registry.dispatch(
      makeToolCall('ask_user', { question: 'Which framework should I use?' }),
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(result.content).toContain('Which framework');
  });

  it('includes options when provided', async () => {
    const result = await registry.dispatch(
      makeToolCall('ask_user', {
        question: 'Pick one',
        options: ['React', 'Vue', 'Svelte'],
      }),
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(result.content).toContain('React');
    expect(result.content).toContain('Vue');
    expect(result.content).toContain('Svelte');
  });

  it('auto-answers in headless mode', async () => {
    process.env['GOLI_HEADLESS'] = '1';
    const result = await registry.dispatch(
      makeToolCall('ask_user', {
        question: 'Pick one',
        options: ['A', 'B'],
      }),
      ctx,
    );
    delete process.env['GOLI_HEADLESS'];
    expect(result.ok).toBe(true);
    expect(result.content).toContain('headless');
    expect(result.content).toContain('A');
  });
});

describe('NotebookEdit tool', () => {
  it('inserts a cell into a notebook', async () => {
    const nbPath = join(workspace, 'test.ipynb');
    // Create a minimal notebook.
    writeFileSync(nbPath, JSON.stringify({
      cells: [],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    }));

    const result = await registry.dispatch(
      makeToolCall('notebook_edit', {
        notebook_path: nbPath,
        edit_mode: 'insert',
        cell_index: 0,
        cell_type: 'code',
        new_source: 'print("hello")',
      }),
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(result.content).toContain('Inserted');

    // Verify the cell was added.
    const nb = JSON.parse(readFileSync(nbPath, 'utf-8'));
    expect(nb.cells).toHaveLength(1);
    expect(nb.cells[0].source.join('')).toContain('print');
  });

  it('deletes a cell from a notebook', async () => {
    const nbPath = join(workspace, 'test.ipynb');
    writeFileSync(nbPath, JSON.stringify({
      cells: [
        { cell_type: 'code', source: ['print("a")'], metadata: {}, outputs: [], execution_count: null },
        { cell_type: 'code', source: ['print("b")'], metadata: {}, outputs: [], execution_count: null },
      ],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    }));

    const result = await registry.dispatch(
      makeToolCall('notebook_edit', {
        notebook_path: nbPath,
        edit_mode: 'delete',
        cell_index: 0,
      }),
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(result.content).toContain('Deleted');

    const nb = JSON.parse(readFileSync(nbPath, 'utf-8'));
    expect(nb.cells).toHaveLength(1);
    expect(nb.cells[0].source.join('')).toContain('b');
  });

  it('rejects non-existent notebook', async () => {
    const result = await registry.dispatch(
      makeToolCall('notebook_edit', {
        notebook_path: join(workspace, 'nope.ipynb'),
        edit_mode: 'insert',
        cell_index: 0,
        cell_type: 'code',
        new_source: 'x',
      }),
      ctx,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not found');
  });
});

describe('WebSearch / WebFetch tools', () => {
  it('web_search returns error without SDK (graceful degradation)', async () => {
    const result = await registry.dispatch(
      makeToolCall('web_search', { query: 'test query' }),
      ctx,
    );
    // Without the SDK installed, we expect a graceful error.
    expect(result.ok).toBe(false);
    expect(result.error).toContain('z-ai-web-dev-sdk');
  });

  it('web_fetch validates URL', async () => {
    const result = await registry.dispatch(
      makeToolCall('web_fetch', { url: 'not-a-url' }),
      ctx,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Invalid URL');
  });

  it('web_fetch rejects non-http protocols', async () => {
    const result = await registry.dispatch(
      makeToolCall('web_fetch', { url: 'file:///etc/passwd' }),
      ctx,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('http/https');
  });
});
