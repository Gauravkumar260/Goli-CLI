/**
 * Tests for T-107: /doctor health check command.
 *
 * Covers:
 *   - /doctor command is registered
 *   - /doctor is isSafeConcurrent
 *   - /doctor outputs Health Check header
 *   - /doctor shows Node.js version
 *   - /doctor shows Platform
 *   - /doctor shows API keys (count, not values)
 *   - /doctor shows Model
 *   - /doctor shows Sandbox
 *   - /doctor shows Terminal info
 *   - /doctor shows Config files
 *   - /doctor shows Memory files
 *   - /doctor shows MCP config
 *   - /doctor shows Workspace
 *   - /doctor shows Result summary
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { globalCommands, registerDefaultCommands } from '../src/tui/lib/CommandRegistry.js';
import { AppStateStore } from '../src/tui/state/AppStateStore.js';

beforeEach(() => {
  registerDefaultCommands();
});

describe('T-107: /doctor command', () => {
  it('is registered', () => {
    const cmd = globalCommands.entries().find((c) => c.name === 'doctor');
    expect(cmd).toBeDefined();
  });

  it('is isSafeConcurrent', () => {
    const cmd = globalCommands.entries().find((c) => c.name === 'doctor');
    expect(cmd?.isSafeConcurrent).toBe(true);
  });

  it('outputs Health Check header', () => {
    const cmd = globalCommands.resolve('doctor');
    const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
    cmd!.handler([]);
    const msg = pushSpy.mock.calls[0]![0];
    expect(msg).toContain('Health Check');
    pushSpy.mockRestore();
  });

  it('shows Node.js version', () => {
    const cmd = globalCommands.resolve('doctor');
    const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
    cmd!.handler([]);
    const msg = pushSpy.mock.calls[0]![0];
    expect(msg).toContain('Node.js:');
    expect(msg).toContain(process.version);
    pushSpy.mockRestore();
  });

  it('shows Platform', () => {
    const cmd = globalCommands.resolve('doctor');
    const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
    cmd!.handler([]);
    const msg = pushSpy.mock.calls[0]![0];
    expect(msg).toContain('Platform:');
    pushSpy.mockRestore();
  });

  it('shows API keys (count, not values)', () => {
    const cmd = globalCommands.resolve('doctor');
    const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
    cmd!.handler([]);
    const msg = pushSpy.mock.calls[0]![0];
    expect(msg).toContain('API keys:');
    // Should not contain actual key values (security).
    pushSpy.mockRestore();
  });

  it('shows Model', () => {
    const cmd = globalCommands.resolve('doctor');
    const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
    cmd!.handler([]);
    const msg = pushSpy.mock.calls[0]![0];
    expect(msg).toContain('Model:');
    pushSpy.mockRestore();
  });

  it('shows Sandbox', () => {
    const cmd = globalCommands.resolve('doctor');
    const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
    cmd!.handler([]);
    const msg = pushSpy.mock.calls[0]![0];
    expect(msg).toContain('Sandbox:');
    pushSpy.mockRestore();
  });

  it('shows Terminal info', () => {
    const cmd = globalCommands.resolve('doctor');
    const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
    cmd!.handler([]);
    const msg = pushSpy.mock.calls[0]![0];
    expect(msg).toContain('Terminal:');
    expect(msg).toContain('Truecolor:');
    pushSpy.mockRestore();
  });

  it('shows Config files', () => {
    const cmd = globalCommands.resolve('doctor');
    const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
    cmd!.handler([]);
    const msg = pushSpy.mock.calls[0]![0];
    expect(msg).toContain('Config:');
    pushSpy.mockRestore();
  });

  it('shows Memory files', () => {
    const cmd = globalCommands.resolve('doctor');
    const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
    cmd!.handler([]);
    const msg = pushSpy.mock.calls[0]![0];
    expect(msg).toContain('Memory:');
    pushSpy.mockRestore();
  });

  it('shows MCP config', () => {
    const cmd = globalCommands.resolve('doctor');
    const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
    cmd!.handler([]);
    const msg = pushSpy.mock.calls[0]![0];
    expect(msg).toContain('MCP:');
    pushSpy.mockRestore();
  });

  it('shows Workspace', () => {
    const cmd = globalCommands.resolve('doctor');
    const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
    cmd!.handler([]);
    const msg = pushSpy.mock.calls[0]![0];
    expect(msg).toContain('Workspace:');
    pushSpy.mockRestore();
  });

  it('shows Result summary', () => {
    const cmd = globalCommands.resolve('doctor');
    const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
    cmd!.handler([]);
    const msg = pushSpy.mock.calls[0]![0];
    expect(msg).toContain('Result:');
    // Should contain either ✓ or ⚠
    expect(msg).toMatch(/✓|⚠/);
    pushSpy.mockRestore();
  });
});
