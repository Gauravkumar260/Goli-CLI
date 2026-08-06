/**
 * Unit tests for the next-gen engine capabilities:
 *   - ReflexionEngine
 *   - ProjectMapGenerator
 *   - DynamicToolManager
 *   - ProvenanceTracker
 */

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';


import { ProvenanceTracker, isSensitiveTool, isWebTool } from '../../packages/core/src/agent/provenance.js';
import { ReflexionEngine } from '../../packages/core/src/agent/reflexion.js';
import { ProjectMapGenerator } from '../../packages/core/src/context/project-map.js';
import { DynamicToolManager } from '@goli-cli/tool-system';

import type { ToolCall, ClassifiedError } from '../../packages/core/src/agent/types.js';

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'goli-nextgen-'));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

// ─── ReflexionEngine ─────────────────────────────────────────────

describe('ReflexionEngine', () => {
  it('generates heuristic reflections without an LLM client', async () => {
    const engine = new ReflexionEngine();
    const toolCall: ToolCall = {
      id: 'tc1',
      name: 'edit_file',
      arguments: '{"file_path":"foo.ts"}',
      status: 'failed',
    };
    const classification: ClassifiedError = {
      reason: 'tool_execution',
      shouldRetry: false,
      shouldRotateCredential: false,
      shouldCompress: false,
      isTerminal: false,
      category: 'tool',
      message: 'old_string not found',
    };
    const reflection = await engine.reflect(new Error('old_string not found'), toolCall, classification, []);
    expect(reflection).not.toBeNull();
    expect(reflection!.strategy).toContain('edit_file');
    expect(reflection!.reflection).toContain('old_string not found');
  });

  it('stores reflections for prompt injection', async () => {
    const engine = new ReflexionEngine();
    const toolCall: ToolCall = {
      id: 'tc1',
      name: 'bash',
      arguments: '{"command":"npm test"}',
      status: 'failed',
    };
    const classification: ClassifiedError = {
      reason: 'tool_execution',
      shouldRetry: false,
      shouldRotateCredential: false,
      shouldCompress: false,
      isTerminal: false,
      category: 'tool',
      message: 'command failed',
    };
    await engine.reflect(new Error('command failed'), toolCall, classification, []);
    const reflections = engine.getReflections();
    expect(reflections).toHaveLength(1);
    expect(engine.formatForPrompt()).toContain('Recent Reflections');
  });

  it('caps reflections at maxReflections', async () => {
    const engine = new ReflexionEngine({ maxReflections: 3 });
    for (let i = 0; i < 5; i++) {
      const tc: ToolCall = { id: `tc${i}`, name: 'bash', arguments: '{}', status: 'failed' };
      const cls: ClassifiedError = {
        reason: 'tool_execution',
        shouldRetry: false,
        shouldRotateCredential: false,
        shouldCompress: false,
        isTerminal: false,
        category: 'tool',
        message: `error ${i}`,
      };
      await engine.reflect(new Error(`error ${i}`), tc, cls, []);
    }
    expect(engine.getReflections()).toHaveLength(3);
  });

  it('clears reflections', () => {
    const engine = new ReflexionEngine();
    engine.clear();
    expect(engine.getReflections()).toHaveLength(0);
    expect(engine.formatForPrompt()).toBe('');
  });
});

// ─── ProjectMapGenerator ─────────────────────────────────────────

describe('ProjectMapGenerator', () => {
  it('generates a map from a workspace with source files', () => {
    // Create a small project.
    mkdirSync(join(workspace, 'src'));
    writeFileSync(join(workspace, 'src', 'index.ts'),
      'export function main() { return 42; }\nexport class App { start() {} }');
    writeFileSync(join(workspace, 'src', 'utils.ts'),
      'export function helper() { return "hello"; }');

    const gen = new ProjectMapGenerator({ workspaceRoot: workspace });
    const map = gen.generate();

    expect(map).toContain('Project Structure');
    expect(map).toContain('index.ts');
    expect(map).toContain('utils.ts');
    expect(map).toContain('fn main');
    expect(map).toContain('class App');
  });

  it('handles empty workspace', () => {
    const gen = new ProjectMapGenerator({ workspaceRoot: workspace });
    const map = gen.generate();
    expect(map).toContain('No source files found');
  });

  it('skips node_modules and .git', () => {
    mkdirSync(join(workspace, 'node_modules'), { recursive: true });
    mkdirSync(join(workspace, '.git'), { recursive: true });
    writeFileSync(join(workspace, 'node_modules', 'dep.js'), 'module.exports = {};');
    writeFileSync(join(workspace, '.git', 'config'), '[core]');
    writeFileSync(join(workspace, 'main.ts'), 'export function main() {}');

    const gen = new ProjectMapGenerator({ workspaceRoot: workspace });
    const map = gen.generate();

    expect(map).toContain('main.ts');
    expect(map).not.toContain('node_modules');
    expect(map).not.toContain('.git');
  });

  it('respects the token budget', () => {
    // Create many files.
    for (let i = 0; i < 20; i++) {
      writeFileSync(join(workspace, `file${i}.ts`),
        `export function func${i}() { return ${i}; }`);
    }
    const gen = new ProjectMapGenerator({ workspaceRoot: workspace, maxTokens: 100 });
    const map = gen.generate();
    // Should be truncated to fit ~400 chars.
    expect(map.length).toBeLessThan(600);
  });
});

// ─── DynamicToolManager ──────────────────────────────────────────

describe('DynamicToolManager', () => {
  it('creates a tool and lists it', () => {
    const manager = new DynamicToolManager({ toolsDir: join(workspace, 'tools') });
    const tool = manager.createTool({
      name: 'test-tool',
      description: 'A test tool',
      language: 'bash',
      code: 'echo "hello $1"',
      args: [{ name: 'msg', type: 'string', description: 'Message', required: true }],
    });
    expect(tool.name).toBe('test-tool');
    expect(tool.inputSchema.properties).toBeDefined();
    expect(manager.has('test-tool')).toBe(true);
    expect(manager.list()).toContain('test-tool');
  });

  it('persists tools to disk', () => {
    const toolsDir = join(workspace, 'tools');
    const manager1 = new DynamicToolManager({ toolsDir });
    manager1.createTool({
      name: 'persisted-tool',
      description: 'A persisted tool',
      language: 'python',
      code: 'print("hello")',
      args: [],
    });
    // Create a new manager — it should load the tool from disk.
    const manager2 = new DynamicToolManager({ toolsDir });
    expect(manager2.has('persisted-tool')).toBe(true);
  });

  it('deletes tools', () => {
    const manager = new DynamicToolManager({ toolsDir: join(workspace, 'tools') });
    manager.createTool({
      name: 'deletable',
      description: 'To be deleted',
      language: 'bash',
      code: 'echo hi',
      args: [],
    });
    expect(manager.has('deletable')).toBe(true);
    expect(manager.delete('deletable')).toBe(true);
    expect(manager.has('deletable')).toBe(false);
  });

  it('generates correct input schema', () => {
    const manager = new DynamicToolManager({ toolsDir: join(workspace, 'tools') });
    const tool = manager.createTool({
      name: 'schema-test',
      description: 'Schema test',
      language: 'bash',
      code: 'echo',
      args: [
        { name: 'path', type: 'string', description: 'File path', required: true },
        { name: 'verbose', type: 'boolean', description: 'Verbose', required: false },
      ],
    });
    const schema = tool.inputSchema;
    expect(schema.properties).toHaveProperty('path');
    expect(schema.properties).toHaveProperty('verbose');
    expect(schema.required).toContain('path');
    expect(schema.required).not.toContain('verbose');
  });
});

// ─── ProvenanceTracker ───────────────────────────────────────────

describe('ProvenanceTracker', () => {
  it('tags context blocks with trust levels', () => {
    const tracker = new ProvenanceTracker();
    tracker.tag('msg1', { source: 'user', canTriggerActions: true });
    tracker.tag('msg2', { source: 'web', canTriggerActions: false });

    expect(tracker.get('msg1')?.source).toBe('user');
    expect(tracker.get('msg2')?.source).toBe('web');
  });

  it('allows sensitive actions from trusted sources', () => {
    const tracker = new ProvenanceTracker();
    tracker.tag('msg1', { source: 'user', canTriggerActions: true });
    const result = tracker.canTriggerAction('bash', ['msg1']);
    expect(result.allowed).toBe(true);
  });

  it('blocks sensitive actions from web sources (prompt injection defense)', () => {
    const tracker = new ProvenanceTracker();
    tracker.tag('msg1', { source: 'web', canTriggerActions: false });
    const result = tracker.canTriggerAction('bash', ['msg1']);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('prompt injection');
  });

  it('blocks sensitive actions from untrusted sources', () => {
    const tracker = new ProvenanceTracker();
    tracker.tag('msg1', { source: 'untrusted', canTriggerActions: false });
    const result = tracker.canTriggerAction('write_file', ['msg1']);
    expect(result.allowed).toBe(false);
  });

  it('allows non-sensitive actions regardless of provenance', () => {
    const tracker = new ProvenanceTracker();
    tracker.tag('msg1', { source: 'web', canTriggerActions: false });
    const result = tracker.canTriggerAction('read_file', ['msg1']);
    expect(result.allowed).toBe(true);
  });

  it('getToolTrustLevel returns correct levels', () => {
    const tracker = new ProvenanceTracker();
    expect(tracker.getToolTrustLevel('read_file')).toBe('trusted');
    expect(tracker.getToolTrustLevel('web_search')).toBe('web');
    expect(tracker.getToolTrustLevel('web_fetch')).toBe('web');
    expect(tracker.getToolTrustLevel('bash')).toBe('tool');
  });

  it('isSensitiveTool identifies write tools', () => {
    expect(isSensitiveTool('write_file')).toBe(true);
    expect(isSensitiveTool('edit_file')).toBe(true);
    expect(isSensitiveTool('bash')).toBe(true);
    expect(isSensitiveTool('read_file')).toBe(false);
    expect(isSensitiveTool('grep')).toBe(false);
  });

  it('isWebTool identifies web tools', () => {
    expect(isWebTool('web_search')).toBe(true);
    expect(isWebTool('web_fetch')).toBe(true);
    expect(isWebTool('bash')).toBe(false);
  });

  it('clears all tags', () => {
    const tracker = new ProvenanceTracker();
    tracker.tag('msg1', { source: 'user', canTriggerActions: true });
    tracker.clear();
    expect(tracker.get('msg1')).toBeUndefined();
  });
});
