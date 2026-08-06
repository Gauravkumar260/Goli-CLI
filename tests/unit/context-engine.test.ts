/**
 * Unit tests for the hybrid retriever and compaction engine.
 */

import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { CompactionEngine } from '../../packages/context-engine/src/compaction/engine.js';
import { TreeSitterIndexer } from '../../packages/context-engine/src/indexer/tree-sitter.js';
import { HybridRetriever } from '../../packages/context-engine/src/retriever/hybrid.js';
import { SubagentIsolator, SUBAGENT_CONFIGS } from '../../packages/orchestration/src/isolation.js';
import { SymbolGraph } from '../../packages/context-engine/src/symbol-graph/sqlite.js';

import type { SymbolNode } from '../../packages/context-engine/src/types.js';

let workspace: string;
let indexer: TreeSitterIndexer;
let graph: SymbolGraph;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'goli-retriever-test-'));
  indexer = new TreeSitterIndexer();
  graph = new SymbolGraph({ inMemory: true });
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
  graph.close();
});

describe('HybridRetriever', () => {
  it('classifies structural queries correctly', () => {
    const retriever = new HybridRetriever({ workspaceRoot: workspace, symbolGraph: graph, indexer });
    expect(retriever.classifyQuery('who calls foo')).toBe('structural');
    expect(retriever.classifyQuery('callers of bar')).toBe('structural');
    expect(retriever.classifyQuery('where is baz defined')).toBe('structural');
    expect(retriever.classifyQuery('what does foo call')).toBe('structural');
  });

  it('classifies lexical queries correctly', () => {
    const retriever = new HybridRetriever({ workspaceRoot: workspace, symbolGraph: graph, indexer });
    expect(retriever.classifyQuery('find all uses of foo')).toBe('lexical');
    expect(retriever.classifyQuery('grep foo')).toBe('lexical');
    expect(retriever.classifyQuery('search for errorMessage')).toBe('lexical');
  });

  it('classifies semantic queries correctly', () => {
    const retriever = new HybridRetriever({ workspaceRoot: workspace, symbolGraph: graph, indexer });
    expect(retriever.classifyQuery('how does the auth module work')).toBe('semantic');
    expect(retriever.classifyQuery('explain the parser')).toBe('semantic');
    expect(retriever.classifyQuery('docs for read_file')).toBe('semantic');
  });

  it('defaults to hybrid for unclassified queries', () => {
    const retriever = new HybridRetriever({ workspaceRoot: workspace, symbolGraph: graph, indexer });
    expect(retriever.classifyQuery('foo bar baz')).toBe('hybrid');
  });

  it('retrieves structural results for "where is X defined"', () => {
    const node: SymbolNode = {
      id: 'f1', name: 'myFunc', type: 'function',
      filePath: '/src/a.ts', line: 1, endLine: 10, language: 'typescript',
    };
    graph.upsertSymbol(node);

    const retriever = new HybridRetriever({ workspaceRoot: workspace, symbolGraph: graph, indexer });
    const results = retriever.retrieve('where is myFunc defined');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.symbol?.name).toBe('myFunc');
    expect(results[0]!.strategy).toBe('structural');
  });

  it('retrieves semantic results from indexed chunks', () => {
    const filePath = join(workspace, 'auth.ts');
    writeFileSync(filePath, [
      '/** Authenticate a user against the database */',
      'function authenticateUser(username: string, password: string): boolean {',
      '  return true;',
      '}',
    ].join('\n'));

    indexer.indexFile(filePath);

    const retriever = new HybridRetriever({ workspaceRoot: workspace, symbolGraph: graph, indexer });
    const results = retriever.retrieve('how does authenticate work', 'semantic');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.strategy).toBe('semantic');
    expect(results[0]!.chunk?.symbolName).toBe('authenticateUser');
  });
});

describe('CompactionEngine', () => {
  it('triggers at 70% of context window', () => {
    const engine = new CompactionEngine({ maxContextTokens: 1_000_000, triggerRatio: 0.7 });
    expect(engine.shouldCompact(600_000)).toBe(false);
    expect(engine.shouldCompact(700_000)).toBe(true);
    expect(engine.shouldCompact(900_000)).toBe(true);
  });

  it('getState returns correct ratio', () => {
    const engine = new CompactionEngine({ maxContextTokens: 1_000_000, triggerRatio: 0.7 });
    const state = engine.getState(500_000);
    expect(state.ratio).toBe(0.5);
    expect(state.needed).toBe(false);
  });

  it('compact produces a summary without GLM (fallback)', async () => {
    const engine = new CompactionEngine({ maxContextTokens: 1_000_000, triggerRatio: 0.7 });
    const messages = [
      { role: 'user' as const, content: 'Fix the bug in parser.ts', timestamp: new Date().toISOString() },
      { role: 'assistant' as const, content: 'I found the bug and fixed it.', timestamp: new Date().toISOString() },
    ];

    const result = await engine.compact(messages, []);
    expect(result.summary).toBeDefined();
    expect(result.summary.length).toBeGreaterThan(0);
    expect(result.messages.length).toBeGreaterThan(0);
    expect(result.tokensSaved).toBeGreaterThanOrEqual(0);
  });

  it('compact includes recent files in the new context', async () => {
    const engine = new CompactionEngine({ maxContextTokens: 1_000_000, triggerRatio: 0.7 });
    const messages = [
      { role: 'user' as const, content: 'test', timestamp: new Date().toISOString() },
    ];
    const recentFiles = [
      { path: 'src/a.ts', content: 'const a = 1;' },
      { path: 'src/b.ts', content: 'const b = 2;' },
    ];

    const result = await engine.compact(messages, recentFiles);
    // The compacted messages should include the recent files
    const allContent = result.messages.map((m) => m.content).join('\n');
    expect(allContent).toContain('src/a.ts');
    expect(allContent).toContain('const a = 1;');
  });
});

describe('SubagentIsolator', () => {
  it('has configs for all 3 subagent types', () => {
    expect(SUBAGENT_CONFIGS['research']).toBeDefined();
    expect(SUBAGENT_CONFIGS['implementation']).toBeDefined();
    expect(SUBAGENT_CONFIGS['review']).toBeDefined();
  });

  it('research subagent has read-only tools', () => {
    const config = SUBAGENT_CONFIGS['research'];
    expect(config.allowedTools).toContain('read_file');
    expect(config.allowedTools).toContain('grep');
    expect(config.allowedTools).not.toContain('write_file');
    expect(config.allowedTools).not.toContain('edit_file');
  });

  it('implementation subagent has write tools', () => {
    const config = SUBAGENT_CONFIGS['implementation'];
    expect(config.allowedTools).toContain('write_file');
    expect(config.allowedTools).toContain('edit_file');
    expect(config.allowedTools).toContain('bash');
  });

  it('spawn returns a summary within the return budget', async () => {
    const isolator = new SubagentIsolator({
      runAgentLoop: async () => ({
        content: 'x'.repeat(10000), // 10K chars = ~2500 tokens
        ok: true,
        tokensUsed: 2500,
      }),
    });

    const result = await isolator.spawn({
      description: 'test',
      prompt: 'test prompt',
      type: 'research',
      maxReturnTokens: 500, // 500 tokens = 2000 chars
    });

    expect(result.ok).toBe(true);
    expect(result.summary.length).toBeLessThanOrEqual(2000 + 100); // +100 for truncation marker
    expect(result.summary).toContain('truncated');
  });

  it('spawn returns error for unknown subagent type', async () => {
    const isolator = new SubagentIsolator({
      runAgentLoop: async () => ({ content: '', ok: true, tokensUsed: 0 }),
    });

    const result = await isolator.spawn({
      description: 'test',
      prompt: 'test',
      type: 'unknown' as never,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Unknown subagent type');
  });

  it('spawn handles agent loop errors', async () => {
    const isolator = new SubagentIsolator({
      runAgentLoop: async () => {
        throw new Error('agent crashed');
      },
    });

    const result = await isolator.spawn({
      description: 'test',
      prompt: 'test',
      type: 'research',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('agent crashed');
  });
});
