/**
 * Tests for T-097: Context-source inspector (/context command).
 *
 * Covers:
 *   - /context command is registered
 *   - /context has /ctx as an alias
 *   - /context is isSafeConcurrent
 *   - /context outputs "Context Sources" header
 *   - /context shows Memory Files section
 *   - /context shows MCP Config section
 *   - /context shows Skills section
 *   - /context shows Workspace Config section
 *   - /context shows Total count
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { globalCommands, registerDefaultCommands } from '../../apps/cli/src/tui/lib/CommandRegistry.js';
import { AppStateStore } from '../../apps/cli/src/tui/state/AppStateStore.js';

beforeEach(() => {
  registerDefaultCommands();
});

describe('T-097: /context command', () => {
  it('is registered', () => {
    const cmd = globalCommands.entries().find((c) => c.name === 'context');
    expect(cmd).toBeDefined();
    expect(cmd!.description).toContain('context');
  });

  it('has /ctx as an alias', () => {
    const cmd = globalCommands.entries().find((c) => c.name === 'context');
    expect(cmd?.altNames).toContain('ctx');
  });

  it('is isSafeConcurrent', () => {
    const cmd = globalCommands.entries().find((c) => c.name === 'context');
    expect(cmd?.isSafeConcurrent).toBe(true);
  });

  it('outputs Context Sources header', () => {
    const cmd = globalCommands.resolve('context');
    const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
    cmd!.handler([]);
    expect(pushSpy).toHaveBeenCalledTimes(1);
    const msg = pushSpy.mock.calls[0]![0];
    expect(msg).toContain('Context Sources');
    pushSpy.mockRestore();
  });

  it('includes Memory Files section', () => {
    const cmd = globalCommands.resolve('context');
    const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
    cmd!.handler([]);
    const msg = pushSpy.mock.calls[0]![0];
    expect(msg).toContain('Memory Files');
    pushSpy.mockRestore();
  });

  it('includes MCP Config section', () => {
    const cmd = globalCommands.resolve('context');
    const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
    cmd!.handler([]);
    const msg = pushSpy.mock.calls[0]![0];
    expect(msg).toContain('MCP Config');
    pushSpy.mockRestore();
  });

  it('includes Skills section', () => {
    const cmd = globalCommands.resolve('context');
    const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
    cmd!.handler([]);
    const msg = pushSpy.mock.calls[0]![0];
    expect(msg).toContain('Skills');
    pushSpy.mockRestore();
  });

  it('includes Workspace Config section', () => {
    const cmd = globalCommands.resolve('context');
    const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
    cmd!.handler([]);
    const msg = pushSpy.mock.calls[0]![0];
    expect(msg).toContain('Workspace Config');
    pushSpy.mockRestore();
  });

  it('includes Total count', () => {
    const cmd = globalCommands.resolve('context');
    const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
    cmd!.handler([]);
    const msg = pushSpy.mock.calls[0]![0];
    expect(msg).toContain('Total:');
    expect(msg).toMatch(/Total: \d+ context source/);
    pushSpy.mockRestore();
  });

  it('shows "none found" when no memory files exist', () => {
    // Run in a temp dir with no memory files.
    const origCwd = process.cwd();
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goli-ctx-'));
    process.chdir(tmpDir);

    try {
      const cmd = globalCommands.resolve('context');
      const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
      cmd!.handler([]);
      const msg = pushSpy.mock.calls[0]![0];
      expect(msg).toContain('none found');
      pushSpy.mockRestore();
    } finally {
      process.chdir(origCwd);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('detects AGENTS.md when present', () => {
    const origCwd = process.cwd();
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goli-ctx-'));
    fs.writeFileSync(path.join(tmpDir, 'AGENTS.md'), '# Test\nThis is a test AGENTS.md file.');
    process.chdir(tmpDir);

    try {
      const cmd = globalCommands.resolve('context');
      const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
      cmd!.handler([]);
      const msg = pushSpy.mock.calls[0]![0];
      expect(msg).toContain('AGENTS.md');
      expect(msg).toContain('bytes');
      pushSpy.mockRestore();
    } finally {
      process.chdir(origCwd);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
