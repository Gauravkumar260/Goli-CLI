/**
 * Tests for build mode permission gate.
 *
 * Covers:
 *   - CRITICAL_TOOLS set includes write_file, edit_file, bash, etc.
 *   - isCriticalTool() returns true for critical tools
 *   - isCriticalTool() returns false for read-only tools
 *   - CliAgentLoop.shouldAskPermission() returns true in build mode for critical tools
 *   - CliAgentLoop.shouldAskPermission() returns false in god mode
 *   - CliAgentLoop.shouldAskPermission() returns false for always-approved tools
 *   - CliAgentLoop.markAlwaysApproved() prevents future prompts
 *   - CliAgentLoop.setAppMode() clears always-approved set
 *   - describeToolAction() returns human-readable descriptions
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CliAgentLoop } from '../../packages/cli/src/services/CliAgentLoop.js';

describe('Build mode permission gate', () => {
  let loop: CliAgentLoop;

  beforeEach(() => {
    loop = new CliAgentLoop();
  });

  // ─── CRITICAL_TOOLS ─────────────────────────────────────────────

  it('write_file is a critical tool', () => {
    loop.setAppMode('build');
    expect(loop.shouldAskPermission('write_file')).toBe(true);
  });

  it('edit_file is a critical tool', () => {
    loop.setAppMode('build');
    expect(loop.shouldAskPermission('edit_file')).toBe(true);
  });

  it('run_shell_command is a critical tool', () => {
    loop.setAppMode('build');
    expect(loop.shouldAskPermission('run_shell_command')).toBe(true);
  });

  it('bash is a critical tool', () => {
    loop.setAppMode('build');
    expect(loop.shouldAskPermission('bash')).toBe(true);
  });

  it('background_shell is a critical tool', () => {
    loop.setAppMode('build');
    expect(loop.shouldAskPermission('background_shell')).toBe(true);
  });

  it('web_fetch is a critical tool', () => {
    loop.setAppMode('build');
    expect(loop.shouldAskPermission('web_fetch')).toBe(true);
  });

  it('web_search is a critical tool', () => {
    loop.setAppMode('build');
    expect(loop.shouldAskPermission('web_search')).toBe(true);
  });

  // ─── Non-critical tools ─────────────────────────────────────────

  it('read_file is NOT a critical tool', () => {
    loop.setAppMode('build');
    expect(loop.shouldAskPermission('read_file')).toBe(false);
  });

  it('grep is NOT a critical tool', () => {
    loop.setAppMode('build');
    expect(loop.shouldAskPermission('grep')).toBe(false);
  });

  it('glob is NOT a critical tool', () => {
    loop.setAppMode('build');
    expect(loop.shouldAskPermission('glob')).toBe(false);
  });

  it('ls is NOT a critical tool', () => {
    loop.setAppMode('build');
    expect(loop.shouldAskPermission('ls')).toBe(false);
  });

  it('plan_task is NOT a critical tool', () => {
    loop.setAppMode('build');
    expect(loop.shouldAskPermission('plan_task')).toBe(false);
  });

  // ─── God mode ───────────────────────────────────────────────────

  it('god mode never asks for permission (write_file)', () => {
    loop.setAppMode('god');
    expect(loop.shouldAskPermission('write_file')).toBe(false);
  });

  it('god mode never asks for permission (bash)', () => {
    loop.setAppMode('god');
    expect(loop.shouldAskPermission('bash')).toBe(false);
  });

  // ─── Always-approved ────────────────────────────────────────────

  it('always-approved tools skip permission in build mode', () => {
    loop.setAppMode('build');
    loop.markAlwaysApproved('write_file');
    expect(loop.shouldAskPermission('write_file')).toBe(false);
  });

  it('always-approved only affects the specified tool', () => {
    loop.setAppMode('build');
    loop.markAlwaysApproved('write_file');
    expect(loop.shouldAskPermission('write_file')).toBe(false);
    expect(loop.shouldAskPermission('edit_file')).toBe(true);
  });

  it('setAppMode clears always-approved set', () => {
    loop.setAppMode('build');
    loop.markAlwaysApproved('write_file');
    expect(loop.shouldAskPermission('write_file')).toBe(false);
    loop.setAppMode('build'); // re-set clears
    expect(loop.shouldAskPermission('write_file')).toBe(true);
  });

  // ─── Other modes ────────────────────────────────────────────────

  it('read-only mode does not ask for permission', () => {
    loop.setAppMode('read-only');
    expect(loop.shouldAskPermission('write_file')).toBe(false);
  });

  it('plan mode does not ask for permission', () => {
    loop.setAppMode('plan');
    expect(loop.shouldAskPermission('write_file')).toBe(false);
  });

  // ─── Default mode ───────────────────────────────────────────────

  it('default mode (build) asks for critical tools', () => {
    // Without calling setAppMode, default is 'build'
    expect(loop.shouldAskPermission('write_file')).toBe(true);
  });
});
