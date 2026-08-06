/**
 * Unit tests for the CommandRegistry.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  CommandRegistry,
  globalCommands,
  registerDefaultCommands,
} from '../src/tui/lib/CommandRegistry.js';

describe('CommandRegistry', () => {
  let registry: CommandRegistry;

  beforeEach(() => {
    registry = new CommandRegistry();
  });

  it('registers and dispatches commands', () => {
    let called = false;
    registry.register({
      name: 'test',
      description: 'Test command',
      handler: () => {
        called = true;
      },
    });
    const result = registry.dispatch('/test');
    expect(result.handled).toBe(true);
    expect(called).toBe(true);
  });

  it('passes args to the handler', () => {
    let receivedArgs: string[] = [];
    registry.register({
      name: 'echo',
      description: 'Echo args',
      handler: (args) => {
        receivedArgs = args;
      },
    });
    registry.dispatch('/echo hello world');
    expect(receivedArgs).toEqual(['hello', 'world']);
  });

  it('returns unknown for unregistered commands', () => {
    const result = registry.dispatch('/nonexistent');
    expect(result.handled).toBe(false);
    expect(result.reason).toBe('unknown');
  });

  it('returns shell for ! prefix', () => {
    const result = registry.dispatch('!ls -la');
    expect(result.handled).toBe(false);
    expect(result.reason).toBe('shell');
  });

  it('returns filepicker for @ prefix', () => {
    const result = registry.dispatch('@src/index.ts');
    expect(result.handled).toBe(false);
    expect(result.reason).toBe('filepicker');
  });

  it('returns passthrough for regular input', () => {
    const result = registry.dispatch('hello world');
    expect(result.handled).toBe(false);
    expect(result.reason).toBe('passthrough');
  });

  it('has and get methods work', () => {
    registry.register({
      name: 'test',
      description: 'Test',
      handler: () => {},
    });
    expect(registry.has('test')).toBe(true);
    expect(registry.has('other')).toBe(false);
    expect(registry.get('test')?.name).toBe('test');
  });

  it('entries returns all commands', () => {
    registry.register({ name: 'a', description: 'A', handler: () => {} });
    registry.register({ name: 'b', description: 'B', handler: () => {} });
    expect(registry.entries()).toHaveLength(2);
  });
});

describe('globalCommands (singleton) with registerDefaultCommands', () => {
  it('registers all default commands', () => {
    registerDefaultCommands(true); // force re-register
    const names = globalCommands.entries().map((c) => c.name);
    expect(names).toContain('help');
    expect(names).toContain('godmode');
    expect(names).toContain('safemode');
    expect(names).toContain('tier');
    expect(names).toContain('clear');
    expect(names).toContain('design');
    expect(names).toContain('btw');
    expect(names).toContain('inputmode');
    expect(names).toContain('plan');
    expect(names).toContain('build');
    expect(names).toContain('compact');
  });
});
