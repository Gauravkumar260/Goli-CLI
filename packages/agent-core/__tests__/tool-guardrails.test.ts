/**
 * Unit tests for the tool-call loop guardrails.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  ToolGuardrailController,
  DEFAULT_GUARDRAIL_CONFIG,
  IDEMPOTENT_TOOL_NAMES,
  MUTATING_TOOL_NAMES,
  isIdempotentTool,
  isMutatingTool,
} from '../src/tool-guardrails.js';

import type { ToolCall } from '../src/types.js';

function makeToolCall(name: string, args: Record<string, unknown> = {}): ToolCall {
  return {
    id: `tc-${Math.random().toString(36).slice(2)}`,
    name,
    arguments: JSON.stringify(args),
    argumentsParsed: args,
    status: 'pending',
  };
}

describe('DEFAULT_GUARDRAIL_CONFIG', () => {
  it('has Hermes defaults', () => {
    expect(DEFAULT_GUARDRAIL_CONFIG.exactFailureWarnAfter).toBe(2);
    expect(DEFAULT_GUARDRAIL_CONFIG.exactFailureBlockAfter).toBe(5);
    expect(DEFAULT_GUARDRAIL_CONFIG.sameToolFailureWarnAfter).toBe(3);
    expect(DEFAULT_GUARDRAIL_CONFIG.sameToolFailureHaltAfter).toBe(8);
    expect(DEFAULT_GUARDRAIL_CONFIG.noProgressWarnAfter).toBe(2);
    expect(DEFAULT_GUARDRAIL_CONFIG.noProgressBlockAfter).toBe(5);
  });
});

describe('IDEMPOTENT_TOOL_NAMES', () => {
  it('contains read-only tools', () => {
    expect(IDEMPOTENT_TOOL_NAMES.has('read_file')).toBe(true);
    expect(IDEMPOTENT_TOOL_NAMES.has('grep')).toBe(true);
    expect(IDEMPOTENT_TOOL_NAMES.has('list_directory')).toBe(true);
  });

  it('does not contain mutating tools', () => {
    expect(IDEMPOTENT_TOOL_NAMES.has('write_file')).toBe(false);
    expect(IDEMPOTENT_TOOL_NAMES.has('bash')).toBe(false);
  });
});

describe('MUTATING_TOOL_NAMES', () => {
  it('contains mutating tools', () => {
    expect(MUTATING_TOOL_NAMES.has('write_file')).toBe(true);
    expect(MUTATING_TOOL_NAMES.has('edit_file')).toBe(true);
    expect(MUTATING_TOOL_NAMES.has('bash')).toBe(true);
  });
});

describe('isIdempotentTool / isMutatingTool', () => {
  it('isIdempotentTool returns true for read-only tools', () => {
    expect(isIdempotentTool('read_file')).toBe(true);
    expect(isIdempotentTool('grep')).toBe(true);
  });

  it('isIdempotentTool returns false for mutating tools', () => {
    expect(isIdempotentTool('write_file')).toBe(false);
    expect(isIdempotentTool('bash')).toBe(false);
  });

  it('isMutatingTool returns true for mutating tools', () => {
    expect(isMutatingTool('write_file')).toBe(true);
    expect(isMutatingTool('bash')).toBe(true);
  });

  it('isMutatingTool returns false for read-only tools', () => {
    expect(isMutatingTool('read_file')).toBe(false);
  });
});

describe('ToolGuardrailController', () => {
  let controller: ToolGuardrailController;

  beforeEach(() => {
    controller = new ToolGuardrailController();
  });

  it('allows first call', () => {
    const result = controller.check(makeToolCall('read_file', { file_path: '/a' }), true);
    expect(result.action).toBe('allow');
    expect(result.loopType).toBe('none');
  });

  it('allows successful calls', () => {
    controller.check(makeToolCall('read_file', { file_path: '/a' }), true);
    controller.check(makeToolCall('read_file', { file_path: '/b' }), true);
    const result = controller.check(makeToolCall('read_file', { file_path: '/c' }), true);
    expect(result.action).toBe('allow');
  });

  it('warns after exact failure threshold (2)', () => {
    const tc = makeToolCall('write_file', { file_path: '/a', content: 'x' });
    controller.check(tc, false);
    const result = controller.check(tc, false);
    expect(result.action).toBe('warn');
    expect(result.loopType).toBe('exact_failure');
    expect(result.count).toBe(2);
    expect(result.threshold).toBe(2);
  });

  it('halts after exact failure block threshold (5)', () => {
    const tc = makeToolCall('write_file', { file_path: '/a', content: 'x' });
    for (let i = 0; i < 4; i++) {
      controller.check(tc, false);
    }
    const result = controller.check(tc, false);
    expect(result.action).toBe('halt');
    expect(result.loopType).toBe('exact_failure');
    expect(result.count).toBe(5);
    expect(result.threshold).toBe(5);
  });

  it('resets exact failure count on success', () => {
    const tc = makeToolCall('write_file', { file_path: '/a', content: 'x' });
    controller.check(tc, false);
    controller.check(tc, false); // warn (count=2)
    controller.check(tc, true);  // success → reset count to 0
    controller.check(tc, false); // count=1 → allow (below warn=2)
    const result = controller.check(tc, false); // count=2 → warn
    expect(result.action).toBe('warn');
    expect(result.count).toBe(2);
  });

  it('warns after same-tool failure threshold (3)', () => {
    // Different args, same tool, all failing
    controller.check(makeToolCall('write_file', { file_path: '/a' }), false);
    controller.check(makeToolCall('write_file', { file_path: '/b' }), false);
    const result = controller.check(makeToolCall('write_file', { file_path: '/c' }), false);
    expect(result.action).toBe('warn');
    expect(result.loopType).toBe('same_tool_failure');
    expect(result.count).toBe(3);
  });

  it('halts after same-tool failure halt threshold (8)', () => {
    for (let i = 0; i < 7; i++) {
      controller.check(makeToolCall('write_file', { file_path: `/file${i}` }), false);
    }
    const result = controller.check(makeToolCall('write_file', { file_path: '/file7' }), false);
    expect(result.action).toBe('halt');
    expect(result.loopType).toBe('same_tool_failure');
    expect(result.count).toBe(8);
  });

  it('detects no-progress for mutating tools', () => {
    const hash = 'abc123';
    controller.check(makeToolCall('write_file', { file_path: '/a' }), true, hash); // sets hash
    controller.check(makeToolCall('write_file', { file_path: '/b' }), true, hash); // noProgress=1
    const result = controller.check(makeToolCall('write_file', { file_path: '/c' }), true, hash); // noProgress=2 → warn
    expect(result.action).toBe('warn');
    expect(result.loopType).toBe('no_progress');
    expect(result.count).toBe(2);
  });

  it('injects synthetic result after no-progress block threshold (5)', () => {
    const hash = 'same';
    controller.check(makeToolCall('write_file', { file_path: '/f0' }), true, hash); // sets hash
    for (let i = 1; i < 5; i++) {
      controller.check(makeToolCall('write_file', { file_path: `/f${i}` }), true, hash); // noProgress 1-4
    }
    const result = controller.check(makeToolCall('write_file', { file_path: '/f5' }), true, hash); // noProgress=5 → inject
    expect(result.action).toBe('inject_result');
    expect(result.loopType).toBe('no_progress');
    expect(result.count).toBe(5);
    expect(result.syntheticResult).toBeDefined();
    expect(result.syntheticResult).toContain('did not change the workspace');
  });

  it('does not count no-progress for idempotent tools', () => {
    const hash = 'same';
    controller.check(makeToolCall('read_file', { file_path: '/a' }), true, hash);
    const result = controller.check(makeToolCall('read_file', { file_path: '/b' }), true, hash);
    expect(result.action).toBe('allow');
  });

  it('resets no-progress on working-tree change', () => {
    controller.check(makeToolCall('write_file', { file_path: '/a' }), true, 'hash1');
    controller.check(makeToolCall('write_file', { file_path: '/b' }), true, 'hash1'); // no-progress=1
    controller.check(makeToolCall('write_file', { file_path: '/c' }), true, 'hash2'); // tree changed → reset
    const result = controller.check(makeToolCall('write_file', { file_path: '/d' }), true, 'hash2'); // no-progress=1
    expect(result.action).toBe('allow'); // Only 1 no-progress, below warn threshold
  });

  it('reset() clears all state', () => {
    const tc = makeToolCall('write_file', { file_path: '/a' });
    controller.check(tc, false);
    controller.check(tc, false);
    controller.reset();
    const result = controller.check(tc, false);
    expect(result.action).toBe('allow'); // Fresh start
  });

  it('getSummary returns current state', () => {
    const tc = makeToolCall('write_file', { file_path: '/a' });
    controller.check(tc, false);
    controller.check(tc, false);
    controller.check(makeToolCall('read_file'), true);

    const summary = controller.getSummary();
    expect(summary.totalCalls).toBe(3);
    expect(summary.exactFailures).toHaveLength(1);
    expect(summary.exactFailures[0]!.count).toBe(2);
  });

  it('getConfig returns the config', () => {
    const config = controller.getConfig();
    expect(config.exactFailureWarnAfter).toBe(2);
    expect(config.exactFailureBlockAfter).toBe(5);
  });

  it('respects custom config', () => {
    const c = new ToolGuardrailController({
      config: { exactFailureWarnAfter: 1, exactFailureBlockAfter: 3 },
    });
    const tc = makeToolCall('write_file', { file_path: '/a' });
    const result = c.check(tc, false);
    expect(result.action).toBe('warn'); // 1 failure → warn (custom threshold)
  });

  it('treats same args in different order as identical', () => {
    const tc1 = makeToolCall('write_file', { file_path: '/a', content: 'x' });
    const tc2 = makeToolCall('write_file', { content: 'x', file_path: '/a' });
    controller.check(tc1, false);
    const result = controller.check(tc2, false);
    expect(result.action).toBe('warn'); // Same args (different order) → exact failure count=2
  });
});
