/**
 * Unit tests for the system-prompt assembler.
 */

import { describe, it, expect } from 'vitest';

import { SystemPromptAssembler } from '../src/system-prompt.js';

import type { SystemPromptContext } from '../src/system-prompt.js';

function makeCtx(overrides: Partial<SystemPromptContext> = {}): SystemPromptContext {
  return {
    role: 'orchestrator',
    toolNames: ['read_file', 'write_file', 'plan_task'],
    sandboxMode: 'workspace-write',
    todos: [],
    language: 'English',
    godMode: false,
    taskPrompt: 'Fix the bug in parser.ts',
    ...overrides,
  };
}

describe('SystemPromptAssembler', () => {
  it('assembles a non-empty prompt with all fragments', () => {
    const assembler = new SystemPromptAssembler();
    const prompt = assembler.assemble(makeCtx());
    expect(prompt.length).toBeGreaterThan(100);
    expect(prompt).toContain('GOLI-CLI');
    expect(prompt).toContain('Orchestrator');
    expect(prompt).toContain('read_file');
    expect(prompt).toContain('WORKSPACE-WRITE');
    expect(prompt).toContain('English');
    expect(prompt).toContain('Safety rules');
  });

  it('does NOT include the task prompt in the stable identity tier', () => {
    // taskPrompt changes every turn → including it in the system prompt
    // busts the prefix cache. The task is already in the latest user message.
    const assembler = new SystemPromptAssembler();
    const prompt = assembler.assemble(makeCtx({ taskPrompt: 'Refactor the auth module' }));
    expect(prompt).not.toContain('Refactor the auth module');
    expect(prompt).not.toContain('Current task:');
  });

  it('includes TODO list when present', () => {
    const assembler = new SystemPromptAssembler();
    const prompt = assembler.assemble(
      makeCtx({
        todos: [
          { content: 'Read file', status: 'completed', priority: 'high' },
          { content: 'Edit file', status: 'in_progress', priority: 'medium' },
          { content: 'Test', status: 'pending', priority: 'low' },
        ],
      }),
    );
    expect(prompt).toContain('Read file');
    expect(prompt).toContain('Edit file');
    expect(prompt).toContain('in-progress');
  });

  it('shows GOD MODE warning when godMode is true', () => {
    const assembler = new SystemPromptAssembler();
    const prompt = assembler.assemble(makeCtx({ godMode: true }));
    expect(prompt).toContain('GOD MODE');
    expect(prompt).toContain('bypassed');
  });

  it('adapts to read-only sandbox mode', () => {
    const assembler = new SystemPromptAssembler();
    const prompt = assembler.assemble(makeCtx({ sandboxMode: 'read-only' }));
    expect(prompt).toContain('READ-ONLY');
    expect(prompt).toContain('CANNOT write');
  });

  it('adapts to danger-full-access sandbox mode', () => {
    const assembler = new SystemPromptAssembler();
    const prompt = assembler.assemble(makeCtx({ sandboxMode: 'danger-full-access' }));
    expect(prompt).toContain('DANGER-FULL-ACCESS');
  });

  it('includes git branch when provided', () => {
    const assembler = new SystemPromptAssembler();
    const prompt = assembler.assemble(makeCtx({ gitBranch: 'feature/auth' }));
    expect(prompt).toContain('feature/auth');
  });

  it('omits git section when no branch', () => {
    const assembler = new SystemPromptAssembler();
    const prompt = assembler.assemble(makeCtx({ gitBranch: undefined }));
    expect(prompt).not.toContain('Current git branch');
  });

  it('includes memory snapshot when provided', () => {
    const assembler = new SystemPromptAssembler();
    const prompt = assembler.assemble(
      makeCtx({
        memorySnapshot: {
          memory: 'User prefers functional style.',
          user: 'Senior engineer.',
          project: 'Next.js monorepo.',
        },
      }),
    );
    expect(prompt).toContain('MEMORY');
    expect(prompt).toContain('User prefers functional style.');
    expect(prompt).toContain('USER PREFERENCES');
    expect(prompt).toContain('PROJECT CONTEXT');
  });

  it('handles empty tool list', () => {
    const assembler = new SystemPromptAssembler();
    const prompt = assembler.assemble(makeCtx({ toolNames: [] }));
    expect(prompt).toContain('no tools available');
  });

  it('uses the correct agent role label', () => {
    const assembler = new SystemPromptAssembler();
    const prompt = assembler.assemble(makeCtx({ role: 'scout' }));
    expect(prompt).toContain('Scout');
  });
});

// Fix the typo in the test (assembler.assembler → assembler.assemble)
// This is a self-test guard — the actual method name is `assemble`.
