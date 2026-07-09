/**
 * Unit tests for the JSON repair / defensive parser.
 */

import { describe, it, expect } from 'vitest';

import { repairJson, parseToolCallArgs } from '../../packages/core/src/agent/json-repair.js';

describe('repairJson', () => {
  it('parses valid JSON as-is', () => {
    expect(repairJson('{"a": 1}')).toEqual({ a: 1 });
    expect(repairJson('[1, 2, 3]')).toEqual([1, 2, 3]);
  });

  it('strips markdown code fences', () => {
    expect(repairJson('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(repairJson('```\n{"a": 1}\n```')).toEqual({ a: 1 });
  });

  it('extracts JSON from prose wrapper', () => {
    expect(repairJson('Here are the arguments: {"file_path": "/tmp/test.ts"}')).toEqual({
      file_path: '/tmp/test.ts',
    });
  });

  it('removes trailing commas', () => {
    expect(repairJson('{"a": 1, "b": 2,}')).toEqual({ a: 1, b: 2 });
    expect(repairJson('[1, 2, 3,]')).toEqual([1, 2, 3]);
  });

  it('escapes literal newlines in strings', () => {
    const result = repairJson('{"path": "foo\nbar"}') as { path: string };
    expect(result.path).toBe('foo\nbar');
  });

  it('adds missing closing braces', () => {
    expect(repairJson('{"a": 1')).toEqual({ a: 1 });
    expect(repairJson('{"a": {"b": 2')).toEqual({ a: { b: 2 } });
  });

  it('adds missing closing brackets', () => {
    expect(repairJson('[1, 2, 3')).toEqual([1, 2, 3]);
  });

  it('returns undefined for empty input', () => {
    expect(repairJson('')).toBeUndefined();
    expect(repairJson('   ')).toBeUndefined();
  });

  it('returns undefined for non-JSON garbage', () => {
    expect(repairJson('hello world this is not json at all')).toBeUndefined();
  });
});

describe('parseToolCallArgs', () => {
  it('returns ok for valid JSON objects', () => {
    const result = parseToolCallArgs('{"file_path": "/tmp/test.ts"}');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ file_path: '/tmp/test.ts' });
    }
  });

  it('returns error for non-object JSON', () => {
    const result = parseToolCallArgs('"just a string"');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Expected JSON object');
    }
  });

  it('returns error for arrays', () => {
    const result = parseToolCallArgs('[1, 2, 3]');
    expect(result.ok).toBe(false);
  });

  it('repairs malformed JSON and succeeds', () => {
    const result = parseToolCallArgs('{"file_path": "/tmp/test.ts",}');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ file_path: '/tmp/test.ts' });
    }
  });

  it('returns error for unrepairable input', () => {
    const result = parseToolCallArgs('total garbage');
    expect(result.ok).toBe(false);
  });
});
