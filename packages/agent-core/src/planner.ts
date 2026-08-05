/**
 * TODO/planner engine (Module 1).
 *
 * Implements the `plan_task` tool — Claude Code's TodoWrite pattern —
 * which lets the model decompose multi-step tasks into tracked TODOs.
 *
 * ## Rules (from the upstream Module 1 spec)
 *
 * - **One `in_progress` at a time.** The planner enforces this: setting
 *   a TODO to `in_progress` automatically sets all others to `pending`
 *   (or keeps `completed` ones as completed).
 * - **Inject current TODO into the system prompt every iteration.** The
 *   SystemPromptAssembler reads the planner's TODO list and surfaces the
 *   in-progress item.
 * - **TODOs are editable.** The model can add, remove, reorder, and
 *   update TODOs across iterations as it learns more.
 *
 * @module agent/planner
 */

import type { Todo, TodoStatus, TodoPriority } from './types.js';

/** The `plan_task` tool definition (OpenAI function-calling format). */
export const PLAN_TASK_TOOL = {
  type: 'function' as const,
  function: {
    name: 'plan_task',
    description:
      'Decompose a complex task into tracked TODOs. Use this when the task has 3+ steps. ' +
      'Only ONE todo can be in_progress at a time. You can call this tool again to update ' +
      'the list (add, remove, reorder, or change status).',
    parameters: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          description: 'The full TODO list (replaces the previous list).',
          items: {
            type: 'object',
            properties: {
              content: {
                type: 'string',
                description: 'The task description (imperative, e.g. "Fix the off-by-one error in parser.ts").',
              },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed'],
                description: 'Current status. Only ONE todo should be in_progress at a time.',
              },
              priority: {
                type: 'string',
                enum: ['high', 'medium', 'low'],
                description: 'Priority level (affects suggested ordering).',
              },
            },
            required: ['content', 'status', 'priority'],
          },
        },
      },
      required: ['todos'],
    },
  },
};

/**
 * Planner — manages the TODO list and enforces the one-in-progress rule.
 *
 * @module agent/planner
 */
export class Planner {
  private todos: Todo[] = [];
  // Hoisted out of `getNextTodo()` — the previous implementation
  // created a new `priorityOrder` object on every call (the
  // `getNextTodo` hot path is called every iteration). Object
  // literals are cheap but this still allocates a new object per
  // call; hoisting avoids that.
  private static readonly PRIORITY_ORDER: Record<TodoPriority, number> = { high: 0, medium: 1, low: 2 };

  /**
   * Get the current TODO list (immutable copy).
   */
  getTodos(): Todo[] {
    return this.todos.map((t) => ({ ...t }));
  }

  /**
   * Replace the TODO list with a new one.
   *
   * Enforces:
   * - At most one `in_progress` TODO (if multiple, keeps the first).
   * - Valid status and priority values.
   *
   * @param newTodos - The new TODO list.
   */
  updateTodos(newTodos: Todo[]): void {
    // Validate
    for (const todo of newTodos) {
      if (!todo.content || typeof todo.content !== 'string') {
        throw new Error(`Invalid TODO: content must be a non-empty string (got: ${JSON.stringify(todo)})`);
      }
      if (!['pending', 'in_progress', 'completed'].includes(todo.status)) {
        throw new Error(`Invalid TODO status: ${todo.status}`);
      }
      if (!['high', 'medium', 'low'].includes(todo.priority)) {
        throw new Error(`Invalid TODO priority: ${todo.priority}`);
      }
    }

    // Enforce one in_progress
    let foundInProgress = false;
    this.todos = newTodos.map((t) => {
      if (t.status === 'in_progress') {
        if (foundInProgress) {
          return { ...t, status: 'pending' as TodoStatus };
        }
        foundInProgress = true;
      }
      return { ...t };
    });
  }

  /**
   * Mark a TODO as completed by index.
   *
   * @param index - The 0-based index into the TODO list.
   */
  completeTodo(index: number): void {
    if (index < 0 || index >= this.todos.length) {
      throw new Error(`TODO index out of range: ${index}`);
    }
    // `index` is bounds-checked above, so `this.todos[index]` is
    // guaranteed non-undefined. The previous implementation had
    // `if (todo)` here which was dead code after the bounds check.
    const todo = this.todos[index]!;
    todo.status = 'completed';
  }

  /**
   * Get the current in-progress TODO (or null if none).
   */
  getCurrentTodo(): Todo | null {
    return this.todos.find((t) => t.status === 'in_progress') ?? null;
  }

  /**
   * Get the next pending TODO (highest priority first).
   *
   * @returns The next TODO to work on, or null if all are done.
   */
  getNextTodo(): Todo | null {
    const pending = this.todos.filter((t) => t.status === 'pending');
    if (pending.length === 0) return null;
    pending.sort((a, b) => Planner.PRIORITY_ORDER[a.priority] - Planner.PRIORITY_ORDER[b.priority]);
    return pending[0] ?? null;
  }

  /**
   * Summary string for logging / display.
   */
  summarize(): string {
    if (this.todos.length === 0) return '(no TODOs)';
    const completed = this.todos.filter((t) => t.status === 'completed').length;
    const inProgress = this.todos.filter((t) => t.status === 'in_progress').length;
    const pending = this.todos.filter((t) => t.status === 'pending').length;
    return `${completed}/${this.todos.length} completed, ${inProgress} in-progress, ${pending} pending`;
  }
}
