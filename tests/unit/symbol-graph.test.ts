/**
 * Unit tests for the SQLite symbol graph.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { SymbolGraph } from '../../packages/core/src/context/symbol-graph/sqlite.js';

import type { SymbolNode, SymbolEdge } from '../../packages/core/src/context/types.js';

let graph: SymbolGraph;

beforeEach(() => {
  graph = new SymbolGraph({ inMemory: true });
});

afterEach(() => {
  graph.close();
});

function makeNode(id: string, name: string, type: SymbolNode['type'], file: string, line: number): SymbolNode {
  return { id, name, type, filePath: file, line, endLine: line + 10, language: 'typescript' };
}

describe('SymbolGraph', () => {
  it('inserts and finds symbols by name', () => {
    graph.upsertSymbol(makeNode('f1', 'foo', 'function', '/src/a.ts', 1));
    const results = graph.findByName('foo');
    expect(results).toHaveLength(1);
    expect(results[0]!.name).toBe('foo');
    expect(results[0]!.filePath).toBe('/src/a.ts');
  });

  it('finds symbols by name prefix', () => {
    graph.upsertSymbol(makeNode('f1', 'getUser', 'function', '/src/a.ts', 1));
    graph.upsertSymbol(makeNode('f2', 'getUserById', 'function', '/src/b.ts', 1));
    graph.upsertSymbol(makeNode('f3', 'getUserName', 'function', '/src/c.ts', 1));
    graph.upsertSymbol(makeNode('f4', 'setUser', 'function', '/src/d.ts', 1));

    const results = graph.findByNamePrefix('getUser');
    expect(results).toHaveLength(3);
    expect(results.map((r) => r.name).sort()).toEqual(['getUser', 'getUserById', 'getUserName']);
  });

  it('inserts and traverses call edges (findCallers)', () => {
    graph.upsertSymbol(makeNode('f1', 'foo', 'function', '/src/a.ts', 1));
    graph.upsertSymbol(makeNode('f2', 'bar', 'function', '/src/b.ts', 1));
    graph.upsertSymbol(makeNode('f3', 'baz', 'function', '/src/c.ts', 1));

    // bar calls foo, baz calls foo
    graph.upsertEdge({ source: 'f2', target: 'f1', type: 'calls' });
    graph.upsertEdge({ source: 'f3', target: 'f1', type: 'calls' });

    const callers = graph.findCallers('f1');
    expect(callers).toHaveLength(2);
    expect(callers.map((c) => c.name).sort()).toEqual(['bar', 'baz']);
  });

  it('finds callees (what does X call?)', () => {
    graph.upsertSymbol(makeNode('f1', 'main', 'function', '/src/a.ts', 1));
    graph.upsertSymbol(makeNode('f2', 'helper1', 'function', '/src/b.ts', 1));
    graph.upsertSymbol(makeNode('f3', 'helper2', 'function', '/src/c.ts', 1));

    graph.upsertEdge({ source: 'f1', target: 'f2', type: 'calls' });
    graph.upsertEdge({ source: 'f1', target: 'f3', type: 'calls' });

    const callees = graph.findCallees('f1');
    expect(callees).toHaveLength(2);
    expect(callees.map((c) => c.name).sort()).toEqual(['helper1', 'helper2']);
  });

  it('finds imports', () => {
    graph.upsertSymbol(makeNode('m1', 'myModule', 'module', '/src/mod.ts', 1));
    graph.upsertSymbol(makeNode('f1', 'user', 'function', '/src/a.ts', 1));

    graph.upsertEdge({ source: 'f1', target: 'm1', type: 'imports' });

    const imports = graph.findImports('f1');
    expect(imports).toHaveLength(1);
    expect(imports[0]!.name).toBe('myModule');
  });

  it('finds symbols by file', () => {
    graph.upsertSymbol(makeNode('f1', 'foo', 'function', '/src/a.ts', 1));
    graph.upsertSymbol(makeNode('f2', 'bar', 'function', '/src/a.ts', 10));
    graph.upsertSymbol(makeNode('f3', 'baz', 'function', '/src/b.ts', 1));

    const results = graph.findByFile('/src/a.ts');
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.name).sort()).toEqual(['bar', 'foo']);
  });

  it('removes all symbols and edges for a file', () => {
    graph.upsertSymbol(makeNode('f1', 'foo', 'function', '/src/a.ts', 1));
    graph.upsertSymbol(makeNode('f2', 'bar', 'function', '/src/b.ts', 1));
    graph.upsertEdge({ source: 'f2', target: 'f1', type: 'calls' });

    graph.removeFile('/src/a.ts');

    expect(graph.findByName('foo')).toHaveLength(0);
    expect(graph.findByName('bar')).toHaveLength(1);
    // The edge should be gone too (target was removed)
    expect(graph.findCallers('f1')).toHaveLength(0);
  });

  it('counts symbols and edges', () => {
    graph.upsertSymbol(makeNode('f1', 'foo', 'function', '/src/a.ts', 1));
    graph.upsertSymbol(makeNode('f2', 'bar', 'function', '/src/b.ts', 1));
    graph.upsertEdge({ source: 'f1', target: 'f2', type: 'calls' });

    expect(graph.symbolCount).toBe(2);
    expect(graph.edgeCount).toBe(1);
  });

  it('upsert is idempotent (no duplicates)', () => {
    const node = makeNode('f1', 'foo', 'function', '/src/a.ts', 1);
    graph.upsertSymbol(node);
    graph.upsertSymbol(node);
    expect(graph.symbolCount).toBe(1);
  });

  it('edge upsert is idempotent', () => {
    const edge: SymbolEdge = { source: 'f1', target: 'f2', type: 'calls' };
    graph.upsertEdge(edge);
    graph.upsertEdge(edge);
    expect(graph.edgeCount).toBe(1);
  });
});
