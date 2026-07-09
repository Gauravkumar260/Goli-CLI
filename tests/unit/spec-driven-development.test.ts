/**
 * Unit tests for H13: Spec-Driven Development.
 *
 * Verifies:
 *   - spec_write creates a markdown file + registers the spec in 'draft' status
 *   - spec_review approves / rejects / requests changes
 *   - spec_update updates content fields and status
 *   - SpecRegistry.hasApprovedSpec() works correctly
 *   - edit_file/write_file are GATED by spec-mode (refuse when no approved spec)
 *   - edit_file/write_file proceed when an approved spec exists
 *   - god mode bypasses spec gating
 */

import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { EDIT_FILE_TOOL } from '../../packages/core/src/tools/core/edit-file.js';
import { specRegistry, deriveTitle, renderSpecMarkdown } from '../../packages/core/src/tools/core/spec-registry.js';
import { SPEC_REVIEW_TOOL } from '../../packages/core/src/tools/core/spec-review.js';
import { SPEC_UPDATE_TOOL } from '../../packages/core/src/tools/core/spec-update.js';
import { SPEC_WRITE_TOOL } from '../../packages/core/src/tools/core/spec-write.js';
import { WRITE_FILE_TOOL } from '../../packages/core/src/tools/core/write-file.js';

import type { ToolContext } from '../../packages/core/src/tools/types.js';

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    toolCallId: 'test-tc',
    workspaceRoot: '/tmp/test-workspace',
    readFiles: new Set(),
    godMode: false,
    autoMode: false,
    sandboxMode: 'workspace-write',
    ...overrides,
  };
}

describe('deriveTitle', () => {
  it('derives a title from a spec path', () => {
    expect(deriveTitle('specs/feature-x.md')).toBe('Feature X');
    expect(deriveTitle('specs/my-cool-feature.md')).toBe('My Cool Feature');
    expect(deriveTitle('specs/api_auth.spec.md')).toBe('Api Auth');
  });
});

describe('renderSpecMarkdown', () => {
  it('renders a spec with all sections', () => {
    const spec = {
      id: 'test-id',
      specPath: '/foo/bar.md',
      title: 'Test Spec',
      requirements: ['req1', 'req2'],
      acceptanceCriteria: ['ac1', 'ac2'],
      testPlan: ['test1'],
      implementationNotes: 'notes',
      status: 'draft' as const,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    const md = renderSpecMarkdown(spec);
    expect(md).toContain('# Specification: Test Spec');
    expect(md).toContain('## Status');
    expect(md).toContain('draft');
    expect(md).toContain('- req1');
    expect(md).toContain('- [ ] ac1');
    expect(md).toContain('- test1');
    expect(md).toContain('notes');
    expect(md).toContain('test-id');
  });
});

describe('H13 spec_write', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'goli-h13-write-'));
    specRegistry.clear();
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
    specRegistry.clear();
  });

  it('writes a spec markdown file and registers it in draft status', async () => {
    const specPath = join(workspace, '.goli', 'specs', 'feature-x.md');
    const ctx = makeContext({ workspaceRoot: workspace });
    const result = await SPEC_WRITE_TOOL.handler(
      {
        spec_path: specPath,
        requirements: ['The system shall do X', 'The system shall do Y'],
        acceptance_criteria: ['Given Z, when W, then X'],
        test_plan: ['Unit test for X', 'Integration test for Y'],
        implementation_notes: 'Use the strategy pattern',
      },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(existsSync(specPath)).toBe(true);
    const md = readFileSync(specPath, 'utf-8');
    expect(md).toContain('# Specification: Feature X');
    expect(md).toContain('The system shall do X');

    // Registry should have the spec
    const spec = specRegistry.get(specPath);
    expect(spec).toBeDefined();
    expect(spec!.status).toBe('draft');
    expect(spec!.requirements).toHaveLength(2);
    expect(spec!.acceptanceCriteria).toHaveLength(1);
  });

  it('throws if requirements is empty', async () => {
    const ctx = makeContext({ workspaceRoot: workspace });
    await expect(
      SPEC_WRITE_TOOL.handler(
        { spec_path: join(workspace, 'x.md'), requirements: [], acceptance_criteria: ['ac'] },
        ctx,
      ),
    ).rejects.toThrow('at least one requirement');
  });

  it('throws if acceptance_criteria is empty', async () => {
    const ctx = makeContext({ workspaceRoot: workspace });
    await expect(
      SPEC_WRITE_TOOL.handler(
        { spec_path: join(workspace, 'x.md'), requirements: ['r'], acceptance_criteria: [] },
        ctx,
      ),
    ).rejects.toThrow('at least one acceptance criterion');
  });

  it('updates an existing spec (re-write workflow)', async () => {
    const specPath = join(workspace, 'spec.md');
    const ctx = makeContext({ workspaceRoot: workspace });
    await SPEC_WRITE_TOOL.handler(
      { spec_path: specPath, requirements: ['orig'], acceptance_criteria: ['ac'] },
      ctx,
    );
    // Approve it
    await SPEC_REVIEW_TOOL.handler(
      { spec_path: specPath, action: 'approve' },
      ctx,
    );
    expect(specRegistry.get(specPath)!.status).toBe('approved');
    // Re-write with new content
    await SPEC_WRITE_TOOL.handler(
      { spec_path: specPath, requirements: ['new'], acceptance_criteria: ['ac2'] },
      ctx,
    );
    const spec = specRegistry.get(specPath)!;
    expect(spec.requirements).toEqual(['new']);
    // Status should reset to draft on re-write
    expect(spec.status).toBe('draft');
  });
});

describe('H13 spec_review', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'goli-h13-review-'));
    specRegistry.clear();
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
    specRegistry.clear();
  });

  it('approves a draft spec', async () => {
    const specPath = join(workspace, 'spec.md');
    const ctx = makeContext({ workspaceRoot: workspace });
    await SPEC_WRITE_TOOL.handler(
      { spec_path: specPath, requirements: ['r'], acceptance_criteria: ['ac'] },
      ctx,
    );
    const result = await SPEC_REVIEW_TOOL.handler(
      { spec_path: specPath, action: 'approve' },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(result.content).toContain('approved');
    expect(specRegistry.get(specPath)!.status).toBe('approved');
    expect(specRegistry.hasApprovedSpec()).toBe(true);
  });

  it('rejects a draft spec with feedback', async () => {
    const specPath = join(workspace, 'spec.md');
    const ctx = makeContext({ workspaceRoot: workspace });
    await SPEC_WRITE_TOOL.handler(
      { spec_path: specPath, requirements: ['r'], acceptance_criteria: ['ac'] },
      ctx,
    );
    const result = await SPEC_REVIEW_TOOL.handler(
      { spec_path: specPath, action: 'reject', feedback: 'missing security requirements' },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(specRegistry.get(specPath)!.status).toBe('rejected');
    expect(specRegistry.get(specPath)!.reviewFeedback).toBe('missing security requirements');
    expect(specRegistry.hasApprovedSpec()).toBe(false);
  });

  it('requires feedback for reject', async () => {
    const specPath = join(workspace, 'spec.md');
    const ctx = makeContext({ workspaceRoot: workspace });
    await SPEC_WRITE_TOOL.handler(
      { spec_path: specPath, requirements: ['r'], acceptance_criteria: ['ac'] },
      ctx,
    );
    await expect(
      SPEC_REVIEW_TOOL.handler(
        { spec_path: specPath, action: 'reject' },
        ctx,
      ),
    ).rejects.toThrow('Feedback is required');
  });

  it('throws if the spec is not in the registry', async () => {
    const ctx = makeContext({ workspaceRoot: workspace });
    await expect(
      SPEC_REVIEW_TOOL.handler(
        { spec_path: join(workspace, 'nonexistent.md'), action: 'approve' },
        ctx,
      ),
    ).rejects.toThrow('Spec not found');
  });
});

describe('H13 spec_update', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'goli-h13-update-'));
    specRegistry.clear();
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
    specRegistry.clear();
  });

  it('updates spec content fields', async () => {
    const specPath = join(workspace, 'spec.md');
    const ctx = makeContext({ workspaceRoot: workspace });
    await SPEC_WRITE_TOOL.handler(
      { spec_path: specPath, requirements: ['orig'], acceptance_criteria: ['ac'] },
      ctx,
    );
    const result = await SPEC_UPDATE_TOOL.handler(
      {
        spec_path: specPath,
        requirements: ['new1', 'new2'],
        status: 'implemented',
      },
      ctx,
    );
    expect(result.ok).toBe(true);
    const spec = specRegistry.get(specPath)!;
    expect(spec.requirements).toEqual(['new1', 'new2']);
    expect(spec.status).toBe('implemented');
  });

  it('throws if the spec does not exist', async () => {
    const ctx = makeContext({ workspaceRoot: workspace });
    await expect(
      SPEC_UPDATE_TOOL.handler(
        { spec_path: join(workspace, 'nope.md'), requirements: ['r'] },
        ctx,
      ),
    ).rejects.toThrow('Spec not found');
  });
});

describe('H13 spec-mode gating on edit_file', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'goli-h13-gate-'));
    specRegistry.clear();
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
    specRegistry.clear();
  });

  it('refuses to edit when spec-mode is on and no approved spec exists', async () => {
    const filePath = join(workspace, 'test.txt');
    writeFileSync(filePath, 'hello\n', 'utf-8');
    const ctx = makeContext({
      workspaceRoot: workspace,
      readFiles: new Set([filePath]),
      specMode: true,
    });
    await expect(
      EDIT_FILE_TOOL.handler(
        { file_path: filePath, old_string: 'hello', new_string: 'HELLO' },
        ctx,
      ),
    ).rejects.toThrow('no approved spec');
    // File should be unchanged
    expect(readFileSync(filePath, 'utf-8')).toBe('hello\n');
  });

  it('allows editing when spec-mode is on and an approved spec exists', async () => {
    const filePath = join(workspace, 'test.txt');
    writeFileSync(filePath, 'hello\n', 'utf-8');
    const specPath = join(workspace, 'spec.md');
    const ctx = makeContext({
      workspaceRoot: workspace,
      readFiles: new Set([filePath]),
      specMode: true,
    });
    // Write + approve the spec
    await SPEC_WRITE_TOOL.handler(
      { spec_path: specPath, requirements: ['r'], acceptance_criteria: ['ac'] },
      ctx,
    );
    await SPEC_REVIEW_TOOL.handler({ spec_path: specPath, action: 'approve' }, ctx);
    // Now editing should work
    const result = await EDIT_FILE_TOOL.handler(
      { file_path: filePath, old_string: 'hello', new_string: 'HELLO' },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(readFileSync(filePath, 'utf-8')).toBe('HELLO\n');
  });

  it('allows editing when spec-mode is off (default)', async () => {
    const filePath = join(workspace, 'test.txt');
    writeFileSync(filePath, 'hello\n', 'utf-8');
    const ctx = makeContext({
      workspaceRoot: workspace,
      readFiles: new Set([filePath]),
      specMode: false,
    });
    const result = await EDIT_FILE_TOOL.handler(
      { file_path: filePath, old_string: 'hello', new_string: 'HELLO' },
      ctx,
    );
    expect(result.ok).toBe(true);
  });

  it('god mode bypasses spec gating', async () => {
    const filePath = join(workspace, 'test.txt');
    writeFileSync(filePath, 'hello\n', 'utf-8');
    const ctx = makeContext({
      workspaceRoot: workspace,
      readFiles: new Set([filePath]),
      specMode: true,
      godMode: true,
    });
    const result = await EDIT_FILE_TOOL.handler(
      { file_path: filePath, old_string: 'hello', new_string: 'HELLO' },
      ctx,
    );
    expect(result.ok).toBe(true);
  });
});

describe('H13 spec-mode gating on write_file', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'goli-h13-wgate-'));
    specRegistry.clear();
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
    specRegistry.clear();
  });

  it('refuses to write when spec-mode is on and no approved spec exists', async () => {
    const filePath = join(workspace, 'new.txt');
    const ctx = makeContext({
      workspaceRoot: workspace,
      specMode: true,
    });
    await expect(
      WRITE_FILE_TOOL.handler(
        { file_path: filePath, content: 'hello' },
        ctx,
      ),
    ).rejects.toThrow('no approved spec');
    expect(existsSync(filePath)).toBe(false);
  });

  it('allows writing when spec-mode is on and an approved spec exists', async () => {
    const filePath = join(workspace, 'new.txt');
    const specPath = join(workspace, 'spec.md');
    const ctx = makeContext({
      workspaceRoot: workspace,
      specMode: true,
    });
    await SPEC_WRITE_TOOL.handler(
      { spec_path: specPath, requirements: ['r'], acceptance_criteria: ['ac'] },
      ctx,
    );
    await SPEC_REVIEW_TOOL.handler({ spec_path: specPath, action: 'approve' }, ctx);
    const result = await WRITE_FILE_TOOL.handler(
      { file_path: filePath, content: 'hello' },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(readFileSync(filePath, 'utf-8')).toBe('hello');
  });
});
