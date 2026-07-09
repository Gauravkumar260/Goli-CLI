/**
 * Unit tests for H18: Tool-Result Streaming.
 *
 * Verifies:
 *   - createChunkEmitter emits chunks with correct metadata
 *   - createChunkEmitter handles null (end-of-stream) sentinel
 *   - createChunkEmitter is a no-op when callback is undefined
 *   - splitIntoChunks splits content at line boundaries near chunkSize
 *   - splitIntoLines preserves trailing newlines
 *   - ToolResultChunk shape is correct
 */

import { describe, it, expect } from 'vitest';

import {
  createChunkEmitter,
  splitIntoChunks,
  splitIntoLines,
  type ToolResultChunk,
} from '../../packages/core/src/tools/core/tool-streaming.js';

describe('H18 createChunkEmitter', () => {
  it('emits chunks with correct metadata', () => {
    const chunks: ToolResultChunk[] = [];
    const emit = createChunkEmitter('tc-1', 'read_file', (c) => chunks.push(c));
    emit('hello ');
    emit('world');
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.toolCallId).toBe('tc-1');
    expect(chunks[0]!.toolName).toBe('read_file');
    expect(chunks[0]!.chunk).toBe('hello ');
    expect(chunks[0]!.isFinal).toBe(false);
    expect(chunks[0]!.timestamp).toBeDefined();
    expect(chunks[1]!.chunk).toBe('world');
    expect(chunks[1]!.isFinal).toBe(false);
  });

  it('emits a final chunk when called with null', () => {
    const chunks: ToolResultChunk[] = [];
    const emit = createChunkEmitter('tc-2', 'bash', (c) => chunks.push(c));
    emit('output line\n');
    emit(null);
    expect(chunks).toHaveLength(2);
    expect(chunks[1]!.isFinal).toBe(true);
    expect(chunks[1]!.chunk).toBe('');
  });

  it('is a no-op when callback is undefined', () => {
    const emit = createChunkEmitter('tc-3', 'read_file', undefined);
    // Should not throw
    emit('hello');
    emit(null);
  });

  it('does not emit empty chunks', () => {
    const chunks: ToolResultChunk[] = [];
    const emit = createChunkEmitter('tc-4', 'bash', (c) => chunks.push(c));
    emit(''); // empty — should be skipped
    emit('real content');
    emit(''); // empty — should be skipped
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.chunk).toBe('real content');
  });
});

describe('H18 splitIntoChunks', () => {
  it('returns empty array for empty content', () => {
    expect(splitIntoChunks('')).toEqual([]);
  });

  it('returns single chunk for content smaller than chunkSize', () => {
    expect(splitIntoChunks('hello', 4096)).toEqual(['hello']);
  });

  it('splits content at line boundaries near chunkSize', () => {
    // 3 lines of ~100 chars each, chunkSize=150 → should split at line 1 or 2
    const line1 = 'a'.repeat(100) + '\n';
    const line2 = 'b'.repeat(100) + '\n';
    const line3 = 'c'.repeat(100) + '\n';
    const content = line1 + line2 + line3;
    const chunks = splitIntoChunks(content, 150);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // Each chunk should end at a line boundary (or be the last chunk)
    for (let i = 0; i < chunks.length - 1; i++) {
      expect(chunks[i]!.endsWith('\n')).toBe(true);
    }
    // Concatenation should equal the original
    expect(chunks.join('')).toBe(content);
  });

  it('handles content with no newlines (splits at chunkSize)', () => {
    const content = 'x'.repeat(1000);
    const chunks = splitIntoChunks(content, 400);
    expect(chunks.length).toBe(3); // 400 + 400 + 200
    expect(chunks.join('')).toBe(content);
  });
});

describe('H18 splitIntoLines', () => {
  it('returns empty array for empty content', () => {
    expect(splitIntoLines('')).toEqual([]);
  });

  it('splits content into lines preserving trailing newlines', () => {
    const lines = splitIntoLines('line1\nline2\nline3\n');
    expect(lines).toEqual(['line1\n', 'line2\n', 'line3\n']);
  });

  it('handles content without trailing newline', () => {
    const lines = splitIntoLines('line1\nline2');
    expect(lines).toEqual(['line1\n', 'line2']);
  });

  it('handles single line with newline', () => {
    expect(splitIntoLines('only line\n')).toEqual(['only line\n']);
  });

  it('handles single line without newline', () => {
    expect(splitIntoLines('only line')).toEqual(['only line']);
  });
});

describe('H18 ToolResultChunk shape', () => {
  it('has all required fields', () => {
    const chunks: ToolResultChunk[] = [];
    const emit = createChunkEmitter('tc-shape', 'read_file', (c) => chunks.push(c));
    emit('data');
    emit(null);
    expect(chunks).toHaveLength(2);
    for (const chunk of chunks) {
      expect(chunk.toolCallId).toBe('tc-shape');
      expect(chunk.toolName).toBe('read_file');
      expect(typeof chunk.chunk).toBe('string');
      expect(typeof chunk.isFinal).toBe('boolean');
      expect(typeof chunk.timestamp).toBe('string');
    }
    // The final chunk should have isFinal=true
    expect(chunks[1]!.isFinal).toBe(true);
  });
});
