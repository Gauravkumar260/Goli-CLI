/**
 * TodoWrite tool (Module 3, competitive gap #2).
 *
 * A user-visible planning tool that the model calls to create, update,
 * and mark off a structured task list. This mirrors Claude Code's
 * TodoWrite — called in 5-10% of all tool invocations, it's core UX.
 *
 * Unlike Goli's internal `planner.ts` (which is a black-box
 * decomposition step), TodoWrite is:
 *   - **Observable**: the user sees the checklist in the TUI.
 *   - **Interruptible**: the user can edit the list.
 *   - **Resumable**: the list persists in the conversation context.
 *
 * The tool accepts a full todo list replacement (same as Claude Code's
 * TodoWrite). Each item has: content, status (pending/in_progress/
 * completed), and priority (high/medium/low).
 *
 * Permission tier: T0 (no side effects outside the conversation).
 *
 * @module tools/core/todo-write
 */

import type { Tool, ToolResult, ToolContext } from '../types.js';

/**
 *
 */
export const TODO_WRITE_TOOL: Tool = {
  name: 'todo_write',
  description:
    'Create or update a visible task list (TODO). Use this to plan multi-step tasks before starting work, ' +
    'track progress during execution, and show the user what you\'re doing. ' +
    'Each call replaces the entire list. Only one item should be "in_progress" at a time.',
  inputSchema: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        description: 'The full todo list (replaces the previous list).',
        items: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description: 'The task description.',
            },
            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'completed'],
              description: 'The task status. Only one item should be "in_progress" at a time.',
            },
            priority: {
              type: 'string',
              enum: ['high', 'medium', 'low'],
              description: 'The task priority.',
            },
          },
          required: ['content', 'status', 'priority'],
        },
      },
    },
    required: ['todos'],
    additionalProperties: false,
  },
  handler: todoWriteHandler,
  tier: 'T0',
  readOnly: true, // No filesystem side effects — only conversation state.
};

/** The current todo list (shared across calls within a session). */
let currentTodos: TodoItem[] = [];

/**
 *
 */
export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority: 'high' | 'medium' | 'low';
}

async function todoWriteHandler(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const todosArg = args['todos'];

  if (!Array.isArray(todosArg)) {
    return {
      toolCallId: ctx.toolCallId,
      ok: false,
      content: '',
      error: 'todo_write requires a "todos" array.',
    };
  }

  // Validate each todo item.
  const todos: TodoItem[] = [];
  for (let i = 0; i < todosArg.length; i++) {
    const item = todosArg[i] as Record<string, unknown>;
    if (!item || typeof item !== 'object') {
      return {
        toolCallId: ctx.toolCallId,
        ok: false,
        content: '',
        error: `todo_write: item ${i} is not an object.`,
      };
    }
    const content = String(item['content'] ?? '');
    const status = String(item['status'] ?? '');
    const priority = String(item['priority'] ?? '');

    if (!content) {
      return {
        toolCallId: ctx.toolCallId,
        ok: false,
        content: '',
        error: `todo_write: item ${i} is missing "content".`,
      };
    }
    if (!['pending', 'in_progress', 'completed'].includes(status)) {
      return {
        toolCallId: ctx.toolCallId,
        ok: false,
        content: '',
        error: `todo_write: item ${i} has invalid status "${status}". Must be pending, in_progress, or completed.`,
      };
    }
    if (!['high', 'medium', 'low'].includes(priority)) {
      return {
        toolCallId: ctx.toolCallId,
        ok: false,
        content: '',
        error: `todo_write: item ${i} has invalid priority "${priority}". Must be high, medium, or low.`,
      };
    }

    todos.push({ content, status: status as TodoItem['status'], priority: priority as TodoItem['priority'] });
  }

  // Enforce: at most one in_progress at a time.
  const inProgressCount = todos.filter((t) => t.status === 'in_progress').length;
  if (inProgressCount > 1) {
    // Keep only the first in_progress, demote the rest to pending.
    let foundFirst = false;
    for (const todo of todos) {
      if (todo.status === 'in_progress') {
        if (foundFirst) todo.status = 'pending';
        foundFirst = true;
      }
    }
  }

  // Update the shared state.
  currentTodos = todos;

  // Format the response for the model (and the user, via the TUI).
  const summary = formatTodoList(todos);

  return {
    toolCallId: ctx.toolCallId,
    ok: true,
    content: summary,
  };
}

/** Get the current todo list (for external consumption, e.g. TUI display). */
export function getCurrentTodos(): TodoItem[] {
  return [...currentTodos];
}

/** Clear the todo list (for testing / session reset). */
export function clearTodos(): void {
  currentTodos = [];
}

/**
 * Format the todo list as a readable string.
 * @param todos
 */
function formatTodoList(todos: TodoItem[]): string {
  if (todos.length === 0) {
    return 'TODO list cleared.';
  }

  const lines: string[] = ['Current TODO list:'];
  for (const todo of todos) {
    const icon =
      todo.status === 'completed' ? '[x]' : todo.status === 'in_progress' ? '[~]' : '[ ]';
    const priority = todo.priority === 'high' ? '[HIGH]' : todo.priority === 'medium' ? '[MED]' : '[LOW]';
    lines.push(`  ${icon} ${priority} ${todo.content}`);
  }

  const completed = todos.filter((t) => t.status === 'completed').length;
  const inProgress = todos.find((t) => t.status === 'in_progress');
  lines.push(`\nProgress: ${completed}/${todos.length} completed`);
  if (inProgress) {
    lines.push(`In progress: ${inProgress.content}`);
  }

  return lines.join('\n');
}
