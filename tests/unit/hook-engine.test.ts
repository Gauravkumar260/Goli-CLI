/**
 * Unit tests for the hook engine.
 */

import { describe, it, expect } from 'vitest';

import { HookEngine } from '../../packages/core/src/tools/hooks/engine.js';

import type { Hook, HookContext, PreToolUseHookResult, PostToolUseHookResult } from '../../packages/core/src/tools/hooks/types.js';

function makeCtx(overrides: Partial<HookContext> = {}): HookContext {
  return {
    toolName: 'test_tool',
    args: {},
    workspaceRoot: '/tmp/test',
    godMode: false,
    ...overrides,
  };
}

describe('HookEngine', () => {
  it('registers and lists hooks', () => {
    const engine = new HookEngine();
    const hook: Hook = {
      name: 'test_hook',
      event: 'PreToolUse',
      handler: () => ({ decision: 'allow' }),
    };
    engine.register(hook);
    expect(engine.list()).toHaveLength(1);
  });

  it('runs PreToolUse hooks in priority order', async () => {
    const engine = new HookEngine();
    const order: string[] = [];

    engine.register({
      name: 'second',
      event: 'PreToolUse',
      priority: 20,
      handler: () => {
        order.push('second');
        return { decision: 'allow' };
      },
    });
    engine.register({
      name: 'first',
      event: 'PreToolUse',
      priority: 10,
      handler: () => {
        order.push('first');
        return { decision: 'allow' };
      },
    });

    await engine.runPreToolUse(makeCtx());
    expect(order).toEqual(['first', 'second']);
  });

  it('short-circuits on deny', async () => {
    const engine = new HookEngine();
    const order: string[] = [];

    engine.register({
      name: 'deny_hook',
      event: 'PreToolUse',
      priority: 10,
      handler: () => {
        order.push('deny');
        return { decision: 'deny', reason: 'blocked' };
      },
    });
    engine.register({
      name: 'never_runs',
      event: 'PreToolUse',
      priority: 20,
      handler: () => {
        order.push('never');
        return { decision: 'allow' };
      },
    });

    const result = await engine.runPreToolUse(makeCtx());
    expect(result.decision).toBe('deny');
    expect(result.reason).toBe('blocked');
    expect(order).toEqual(['deny']);
  });

  it('returns ask if any hook asks (and none deny)', async () => {
    const engine = new HookEngine();

    engine.register({
      name: 'allow_hook',
      event: 'PreToolUse',
      priority: 10,
      handler: () => ({ decision: 'allow' }),
    });
    engine.register({
      name: 'ask_hook',
      event: 'PreToolUse',
      priority: 20,
      handler: () => ({ decision: 'ask', reason: 'needs approval' }),
    });

    const result = await engine.runPreToolUse(makeCtx());
    expect(result.decision).toBe('ask');
    expect(result.reason).toBe('needs approval');
  });

  it('passes modified input to next hook', async () => {
    const engine = new HookEngine();
    let receivedArgs: Record<string, unknown> = {};

    engine.register({
      name: 'modifier',
      event: 'PreToolUse',
      priority: 10,
      handler: (ctx) => {
        return { decision: 'allow', modifiedInput: { ...ctx.args, modified: true } };
      },
    });
    engine.register({
      name: 'receiver',
      event: 'PreToolUse',
      priority: 20,
      handler: (ctx) => {
        receivedArgs = { ...ctx.args };
        return { decision: 'allow' };
      },
    });

    const result = await engine.runPreToolUse(makeCtx({ args: { original: true } }));
    expect(result.modifiedInput).toEqual({ original: true, modified: true });
    expect(receivedArgs).toEqual({ original: true, modified: true });
  });

  it('treats crashed PreToolUse hooks as deny (fail-safe)', async () => {
    const engine = new HookEngine();

    engine.register({
      name: 'crashing',
      event: 'PreToolUse',
      handler: () => {
        throw new Error('hook crashed');
      },
    });

    const result = await engine.runPreToolUse(makeCtx());
    expect(result.decision).toBe('deny');
    expect(result.reason).toContain('crashed');
  });

  it('runs all PostToolUse hooks (no short-circuit)', async () => {
    const engine = new HookEngine();
    const order: string[] = [];

    engine.register({
      name: 'first',
      event: 'PostToolUse',
      priority: 10,
      handler: () => {
        order.push('first');
        return { feedback: 'feedback 1' };
      },
    });
    engine.register({
      name: 'second',
      event: 'PostToolUse',
      priority: 20,
      handler: () => {
        order.push('second');
        return { feedback: 'feedback 2' };
      },
    });

    const result = await engine.runPostToolUse(makeCtx({ result: { toolCallId: 'x', ok: true, content: 'test' } }));
    expect(order).toEqual(['first', 'second']);
    expect(result.feedback).toHaveLength(2);
    expect(result.feedback[0]).toContain('feedback 1');
    expect(result.feedback[1]).toContain('feedback 2');
  });

  it('PostToolUse crashes are non-fatal', async () => {
    const engine = new HookEngine();

    engine.register({
      name: 'crashing',
      event: 'PostToolUse',
      handler: () => {
        throw new Error('post crash');
      },
    });
    engine.register({
      name: 'survives',
      event: 'PostToolUse',
      handler: () => ({ feedback: 'survived' }),
    });

    const result = await engine.runPostToolUse(makeCtx({ result: { toolCallId: 'x', ok: true, content: 'test' } }));
    expect(result.feedback.some((f) => f.includes('survived'))).toBe(true);
  });

  it('filters hooks by tool match', async () => {
    const engine = new HookEngine();
    let ran = false;

    engine.register({
      name: 'bash_only',
      event: 'PreToolUse',
      toolMatch: ['bash'],
      handler: () => {
        ran = true;
        return { decision: 'allow' };
      },
    });

    // Should not run for read_file
    await engine.runPreToolUse(makeCtx({ toolName: 'read_file' }));
    expect(ran).toBe(false);

    // Should run for bash
    await engine.runPreToolUse(makeCtx({ toolName: 'bash' }));
    expect(ran).toBe(true);
  });

  it('unregister removes disableable hooks', () => {
    const engine = new HookEngine();
    engine.register({
      name: 'removable',
      event: 'PreToolUse',
      disableable: true,
      handler: () => ({ decision: 'allow' }),
    });
    expect(engine.list()).toHaveLength(1);
    expect(engine.unregister('removable')).toBe(true);
    expect(engine.list()).toHaveLength(0);
  });

  it('unregister refuses non-disableable hooks', () => {
    const engine = new HookEngine();
    engine.register({
      name: 'permanent',
      event: 'PreToolUse',
      disableable: false,
      handler: () => ({ decision: 'allow' }),
    });
    expect(engine.unregister('permanent')).toBe(false);
    expect(engine.list()).toHaveLength(1);
  });
});
