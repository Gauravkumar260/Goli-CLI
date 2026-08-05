/**
 * Unit tests for the planner / TODO engine.
 */

import { describe, it, expect } from 'vitest';

import { Planner, PLAN_TASK_TOOL } from '../src/planner.js';

import type { Todo } from '../src/types.js';

function makeTodo(overrides: Partial<Todo> = {}): Todo {
  return {
    content: 'Test task',
    status: 'pending',
    priority: 'medium',
    ...overrides,
  };
}

describe('PLAN_TASK_TOOL', () => {
  it('has the correct tool definition', () => {
    expect(PLAN_TASK_TOOL.type).toBe('function');
    expect(PLAN_TASK_TOOL.function.name).toBe('plan_task');
    expect(PLAN_TASK_TOOL.function.parameters).toBeDefined();
  });
});

describe('Planner', () => {
  it('starts with an empty TODO list', () => {
    const planner = new Planner();
    expect(planner.getTodos()).toEqual([]);
    expect(planner.getCurrentTodo()).toBeNull();
    expect(planner.getNextTodo()).toBeNull();
  });

  it('accepts a valid TODO list', () => {
    const planner = new Planner();
    planner.updateTodos([
      makeTodo({ content: 'Read file', status: 'in_progress', priority: 'high' }),
      makeTodo({ content: 'Edit file', status: 'pending', priority: 'medium' }),
    ]);
    expect(planner.getTodos()).toHaveLength(2);
    expect(planner.getCurrentTodo()?.content).toBe('Read file');
  });

  it('enforces one in_progress at a time', () => {
    const planner = new Planner();
    planner.updateTodos([
      makeTodo({ content: 'Task A', status: 'in_progress' }),
      makeTodo({ content: 'Task B', status: 'in_progress' }),
    ]);
    const todos = planner.getTodos();
    expect(todos[0]!.status).toBe('in_progress');
    expect(todos[1]!.status).toBe('pending'); // demoted
  });

  it('throws on invalid status', () => {
    const planner = new Planner();
    expect(() =>
      planner.updateTodos([makeTodo({ status: 'invalid' as Todo['status'] })]),
    ).toThrow(/Invalid TODO status/);
  });

  it('throws on invalid priority', () => {
    const planner = new Planner();
    expect(() =>
      planner.updateTodos([makeTodo({ priority: 'urgent' as Todo['priority'] })]),
    ).toThrow(/Invalid TODO priority/);
  });

  it('throws on empty content', () => {
    const planner = new Planner();
    expect(() => planner.updateTodos([makeTodo({ content: '' })])).toThrow();
  });

  it('completeTodo marks a TODO as completed', () => {
    const planner = new Planner();
    planner.updateTodos([
      makeTodo({ content: 'Task A', status: 'in_progress' }),
      makeTodo({ content: 'Task B', status: 'pending' }),
    ]);
    planner.completeTodo(0);
    expect(planner.getTodos()[0]!.status).toBe('completed');
  });

  it('completeTodo throws on out-of-range index', () => {
    const planner = new Planner();
    planner.updateTodos([makeTodo()]);
    expect(() => planner.completeTodo(5)).toThrow(/out of range/);
    expect(() => planner.completeTodo(-1)).toThrow(/out of range/);
  });

  it('getNextTodo returns highest-priority pending TODO', () => {
    const planner = new Planner();
    planner.updateTodos([
      makeTodo({ content: 'Low', status: 'pending', priority: 'low' }),
      makeTodo({ content: 'High', status: 'pending', priority: 'high' }),
      makeTodo({ content: 'Medium', status: 'pending', priority: 'medium' }),
    ]);
    expect(planner.getNextTodo()?.content).toBe('High');
  });

  it('getNextTodo returns null when all are done', () => {
    const planner = new Planner();
    planner.updateTodos([
      makeTodo({ content: 'Done', status: 'completed' }),
    ]);
    expect(planner.getNextTodo()).toBeNull();
  });

  it('summarize produces a readable summary', () => {
    const planner = new Planner();
    planner.updateTodos([
      makeTodo({ content: 'A', status: 'completed' }),
      makeTodo({ content: 'B', status: 'in_progress' }),
      makeTodo({ content: 'C', status: 'pending' }),
    ]);
    const summary = planner.summarize();
    expect(summary).toContain('1/3 completed');
    expect(summary).toContain('1 in-progress');
    expect(summary).toContain('1 pending');
  });

  it('getTodos returns a copy (immutable)', () => {
    const planner = new Planner();
    planner.updateTodos([makeTodo({ content: 'Original' })]);
    const todos = planner.getTodos();
    todos[0]!.content = 'Mutated';
    expect(planner.getTodos()[0]!.content).toBe('Original');
  });
});
