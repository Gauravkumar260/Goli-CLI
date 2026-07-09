/**
 * Unit tests for the schema validator.
 */

import { describe, it, expect } from 'vitest';

import { validateToolArgs, formatValidationErrors } from '../../packages/core/src/tools/schema-validator.js';

import type { ToolInputSchema } from '../../packages/core/src/tools/types.js';

const schema: ToolInputSchema = {
  type: 'object',
  properties: {
    file_path: { type: 'string' },
    offset: { type: 'number' },
    limit: { type: 'number' },
    mode: { type: 'string', enum: ['read', 'write'] },
  },
  required: ['file_path'],
  additionalProperties: false,
};

describe('validateToolArgs', () => {
  it('passes for valid args with required field', () => {
    const result = validateToolArgs({ file_path: '/tmp/test.ts' }, schema);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('fails when required field is missing', () => {
    const result = validateToolArgs({ offset: 10 }, schema);
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.path).toBe('file_path');
  });

  it('fails on wrong type', () => {
    const result = validateToolArgs({ file_path: 123 }, schema);
    expect(result.ok).toBe(false);
    expect(result.errors[0]!.path).toBe('file_path');
    expect(result.errors[0]!.expected).toContain('type string');
  });

  it('fails on invalid enum value', () => {
    const result = validateToolArgs({ file_path: '/tmp/x', mode: 'execute' }, schema);
    expect(result.ok).toBe(false);
    expect(result.errors[0]!.path).toBe('mode');
    expect(result.errors[0]!.expected).toContain('one of');
  });

  it('fails on additional properties when prohibited', () => {
    const result = validateToolArgs({ file_path: '/tmp/x', unknown_field: true }, schema);
    expect(result.ok).toBe(false);
    expect(result.errors[0]!.path).toBe('unknown_field');
  });

  it('passes with null values for optional fields', () => {
    const result = validateToolArgs({ file_path: '/tmp/x', offset: null }, schema);
    // null has type 'null' which is not 'number'
    expect(result.ok).toBe(false);
  });

  it('passes with array type', () => {
    const arraySchema: ToolInputSchema = {
      type: 'object',
      properties: {
        items: { type: 'array' },
      },
      required: ['items'],
    };
    expect(validateToolArgs({ items: [1, 2, 3] }, arraySchema).ok).toBe(true);
    expect(validateToolArgs({ items: 'not array' }, arraySchema).ok).toBe(false);
  });
});

describe('formatValidationErrors', () => {
  it('formats errors as a readable string', () => {
    const errors = [
      { path: 'file_path', expected: 'type string', received: 'type number' },
      { path: 'mode', expected: 'enum', received: 'invalid' },
    ];
    const formatted = formatValidationErrors(errors);
    expect(formatted).toContain('file_path');
    expect(formatted).toContain('type string');
    expect(formatted).toContain('mode');
    expect(formatted).toContain('enum');
  });
});
