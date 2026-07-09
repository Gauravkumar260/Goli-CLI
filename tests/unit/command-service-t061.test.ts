/**
 * Tests for the pluggable CommandService (T-061).
 *
 * Covers:
 *   - CommandService.create runs loaders in parallel via Promise.all
 *   - builtin source wins over workspace on conflict
 *   - workspace wins over user, user wins over MCP, MCP wins over extension
 *   - fileLoader discovers .md files and parses frontmatter
 *   - fileLoader's commands have working handlers
 *   - telemetry: emitSlashCommandEvent + registerSlashCommandTelemetry
 *   - sub-command dispatch via CommandRegistry.dispatch
 *   - async completion returns candidate strings
 *   - abort signal cancels pending loaders
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { CommandRegistry } from '../../packages/cli/src/tui/lib/CommandRegistry.js';
import {
  CommandService,
  builtinLoader,
  fileLoader,
  emitSlashCommandEvent,
  registerSlashCommandTelemetry,
  type SlashCommandEvent,
  type CommandSource,
} from '../../packages/cli/src/tui/lib/CommandService.js';

// ─── CommandService basics ────────────────────────────────────────────────

describe('T-061: CommandService — basics', () => {
  it('create runs loaders in parallel and registers results', async () => {
    const registry = new CommandRegistry();
    const svc = new CommandService(registry);
    svc.addLoader(async () => [
      {
        source: 'builtin' as const,
        command: { name: 'foo', description: 'foo cmd', handler: () => undefined },
      },
    ]);
    svc.addLoader(async () => [
      {
        source: 'workspace' as const,
        command: { name: 'bar', description: 'bar cmd', handler: () => undefined },
      },
    ]);
    const result = await svc.create();
    expect(result.count).toBe(2);
    expect(result.conflicts).toHaveLength(0);
    expect(registry.has('foo')).toBe(true);
    expect(registry.has('bar')).toBe(true);
  });

  it('create returns empty result when no loaders are registered', async () => {
    const registry = new CommandRegistry();
    const svc = new CommandService(registry);
    const result = await svc.create();
    expect(result.count).toBe(0);
    expect(result.conflicts).toHaveLength(0);
  });

  it('create captures loader errors as outcomes without crashing', async () => {
    const registry = new CommandRegistry();
    const svc = new CommandService(registry);
    svc.addLoader(async () => {
      throw new Error('loader boom');
    });
    svc.addLoader(async () => [
      {
        source: 'builtin' as const,
        command: { name: 'ok', description: 'ok', handler: () => undefined },
      },
    ]);
    const result = await svc.create();
    expect(result.count).toBe(1); // only the successful loader's command
    expect(result.outcomes).toHaveLength(2);
    expect(result.outcomes[0]!.error).toBeInstanceOf(Error);
    expect(result.outcomes[1]!.error).toBeUndefined();
  });

  it('auto-sets kind from source when kind is not provided', async () => {
    const registry = new CommandRegistry();
    const svc = new CommandService(registry);
    svc.addLoader(async () => [
      {
        source: 'MCP' as const,
        command: { name: 'mcp1', description: 'mcp', handler: () => undefined },
      },
    ]);
    await svc.create();
    const cmd = registry.get('mcp1');
    expect(cmd?.kind).toBe('MCP');
  });

  it('does not override kind when explicitly provided', async () => {
    const registry = new CommandRegistry();
    const svc = new CommandService(registry);
    svc.addLoader(async () => [
      {
        source: 'workspace' as const,
        command: {
          name: 'explicit',
          description: 'explicit',
          kind: 'Agent',
          handler: () => undefined,
        },
      },
    ]);
    await svc.create();
    const cmd = registry.get('explicit');
    expect(cmd?.kind).toBe('Agent');
  });
});

// ─── Conflict resolution ──────────────────────────────────────────────────

describe('T-061: CommandService — conflict resolution', () => {
  const SOURCES: CommandSource[] = ['builtin', 'workspace', 'user', 'MCP', 'extension'];

  // Test each adjacent pair (builtin > workspace > user > MCP > extension).
  const PAIRS: Array<[CommandSource, CommandSource]> = [
    ['builtin', 'workspace'],
    ['workspace', 'user'],
    ['user', 'MCP'],
    ['MCP', 'extension'],
  ];

  for (const [higher, lower] of PAIRS) {
    it(`${higher} wins over ${lower} on a name conflict`, async () => {
      const registry = new CommandRegistry();
      const svc = new CommandService(registry);
      const higherHandler = vi.fn();
      const lowerHandler = vi.fn();
      svc.addLoader(async () => [
        {
          source: higher,
          command: { name: 'shared', description: 'high', handler: higherHandler },
        },
      ]);
      svc.addLoader(async () => [
        {
          source: lower,
          command: { name: 'shared', description: 'low', handler: lowerHandler },
        },
      ]);
      const result = await svc.create();
      expect(result.count).toBe(1);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]!.name).toBe('shared');
      expect(result.conflicts[0]!.winner).toBe(higher);
      expect(result.conflicts[0]!.losers).toContain(lower);
      // The winning command should be the one registered.
      const cmd = registry.get('shared');
      expect(cmd?.description).toBe('high');
    });
  }

  it('reports all losers when 3+ sources collide on the same name', async () => {
    const registry = new CommandRegistry();
    const svc = new CommandService(registry);
    svc.addLoader(async () => [
      { source: 'extension', command: { name: 'x', description: 'ext', handler: () => undefined } },
    ]);
    svc.addLoader(async () => [
      { source: 'MCP', command: { name: 'x', description: 'mcp', handler: () => undefined } },
    ]);
    svc.addLoader(async () => [
      { source: 'workspace', command: { name: 'x', description: 'ws', handler: () => undefined } },
    ]);
    svc.addLoader(async () => [
      { source: 'builtin', command: { name: 'x', description: 'bi', handler: () => undefined } },
    ]);
    const result = await svc.create();
    expect(result.count).toBe(1);
    expect(result.conflicts).toHaveLength(1);
    const conflict = result.conflicts[0]!;
    expect(conflict.winner).toBe('builtin');
    expect(conflict.losers).toHaveLength(3);
    expect(conflict.losers).toContain('workspace');
    expect(conflict.losers).toContain('MCP');
    expect(conflict.losers).toContain('extension');
  });

  it('no conflicts when all command names are unique', async () => {
    const registry = new CommandRegistry();
    const svc = new CommandService(registry);
    svc.addLoader(async () => [
      { source: 'builtin', command: { name: 'a', description: 'a', handler: () => undefined } },
    ]);
    svc.addLoader(async () => [
      { source: 'workspace', command: { name: 'b', description: 'b', handler: () => undefined } },
    ]);
    const result = await svc.create();
    expect(result.conflicts).toHaveLength(0);
  });
});

// ─── builtinLoader ────────────────────────────────────────────────────────

describe('T-061: builtinLoader', () => {
  it('wraps a Command[] into loader results with source=builtin', async () => {
    const commands = [
      { name: 'foo', description: 'foo', handler: () => undefined },
      { name: 'bar', description: 'bar', handler: () => undefined },
    ];
    const loader = builtinLoader(commands);
    const results = await loader();
    expect(results).toHaveLength(2);
    expect(results[0]!.source).toBe('builtin');
    expect(results[0]!.command.name).toBe('foo');
    expect(results[1]!.command.name).toBe('bar');
  });

  it('returns empty array when given no commands', async () => {
    const loader = builtinLoader([]);
    const results = await loader();
    expect(results).toEqual([]);
  });
});

// ─── fileLoader ───────────────────────────────────────────────────────────

describe('T-061: fileLoader', () => {
  it('discovers .md files and creates commands with the bare filename as name', async () => {
    const loader = fileLoader({
      dir: '/fake/commands',
      source: 'workspace',
      readDir: () => ['foo.md', 'bar.md', 'not-md.txt'],
      readFile: (file) => `# ${file}\nBody text.`,
    });
    const results = await loader();
    expect(results).toHaveLength(2); // not-md.txt excluded
    const names = results.map((r) => r.command.name).sort();
    expect(names).toEqual(['bar', 'foo']);
  });

  it('parses frontmatter for description, altNames, hidden', async () => {
    const loader = fileLoader({
      dir: '/fake',
      source: 'user',
      readDir: () => ['deploy.md'],
      readFile: () =>
        [
          '---',
          'description: "Deploy the app to prod"',
          'altNames: ["ship", "release"]',
          'hidden: true',
          '---',
          '',
          'Run `npm run deploy` and verify.',
        ].join('\n'),
    });
    const results = await loader();
    expect(results).toHaveLength(1);
    const cmd = results[0]!.command;
    expect(cmd.description).toBe('Deploy the app to prod');
    expect(cmd.altNames).toEqual(['ship', 'release']);
    expect(cmd.hidden).toBe(true);
    expect(cmd.kind).toBe('custom');
  });

  it('falls back to default description when frontmatter is missing', async () => {
    const loader = fileLoader({
      dir: '/fake',
      source: 'workspace',
      readDir: () => ['bare.md'],
      readFile: () => 'Just body text, no frontmatter.',
    });
    const results = await loader();
    expect(results).toHaveLength(1);
    const cmd = results[0]!.command;
    expect(cmd.description).toContain('bare.md');
    expect(cmd.altNames).toBeUndefined();
    expect(cmd.hidden).toBeUndefined();
  });

  it('returns empty array when directory does not exist', async () => {
    const loader = fileLoader({
      dir: '/nonexistent',
      source: 'workspace',
      readDir: () => {
        throw new Error('ENOENT');
      },
      readFile: () => '',
    });
    const results = await loader();
    expect(results).toEqual([]);
  });

  it('skips files that cannot be read', async () => {
    const loader = fileLoader({
      dir: '/fake',
      source: 'workspace',
      readDir: () => ['ok.md', 'bad.md'],
      readFile: (file) => {
        if (file.includes('bad')) throw new Error('read fail');
        return 'ok body';
      },
    });
    const results = await loader();
    expect(results).toHaveLength(1);
    expect(results[0]!.command.name).toBe('ok');
  });

  it('the registered handler is callable', async () => {
    const loader = fileLoader({
      dir: '/fake',
      source: 'workspace',
      readDir: () => ['hi.md'],
      readFile: () => 'Hello body',
    });
    const results = await loader();
    expect(() => results[0]!.command.handler([])).not.toThrow();
  });
});

// ─── Telemetry ────────────────────────────────────────────────────────────

describe('T-061: slash command telemetry', () => {
  it('registerSlashCommandTelemetry receives emitted events', () => {
    const events: SlashCommandEvent[] = [];
    const unsub = registerSlashCommandTelemetry((e) => events.push(e));
    emitSlashCommandEvent({
      command: 'theme',
      source: 'builtin',
      status: 'success',
    });
    emitSlashCommandEvent({
      command: 'unknown-cmd',
      source: 'workspace',
      status: 'unknown',
    });
    expect(events).toHaveLength(2);
    expect(events[0]!.command).toBe('theme');
    expect(events[1]!.status).toBe('unknown');
    unsub();
  });

  it('unregister stops receiving events', () => {
    const events: SlashCommandEvent[] = [];
    const unsub = registerSlashCommandTelemetry((e) => events.push(e));
    unsub();
    emitSlashCommandEvent({
      command: 'foo',
      source: 'builtin',
      status: 'success',
    });
    expect(events).toHaveLength(0);
  });

  it('sink errors do not crash the emitter', () => {
    registerSlashCommandTelemetry(() => {
      throw new Error('sink boom');
    });
    expect(() =>
      emitSlashCommandEvent({
        command: 'foo',
        source: 'builtin',
        status: 'success',
      }),
    ).not.toThrow();
  });

  it('events include optional subcommand and extension_id', () => {
    const events: SlashCommandEvent[] = [];
    const unsub = registerSlashCommandTelemetry((e) => events.push(e));
    emitSlashCommandEvent({
      command: 'mcp',
      subcommand: 'add',
      source: 'MCP',
      status: 'success',
      extension_id: 'mcp-filesystem',
    });
    expect(events[0]!.subcommand).toBe('add');
    expect(events[0]!.extension_id).toBe('mcp-filesystem');
    unsub();
  });
});

// ─── Sub-command dispatch ─────────────────────────────────────────────────

describe('T-061: sub-command dispatch via CommandRegistry', () => {
  it('dispatch routes to the sub-command when the first arg matches', () => {
    const registry = new CommandRegistry();
    const addHandler = vi.fn();
    const removeHandler = vi.fn();
    const listHandler = vi.fn();
    registry.register({
      name: 'mcp',
      description: 'MCP ops',
      handler: () => undefined,
      subCommands: [
        { name: 'add', description: 'add server', handler: addHandler },
        { name: 'remove', description: 'remove server', handler: removeHandler },
        { name: 'list', description: 'list servers', handler: listHandler },
      ],
    });
    const r1 = registry.dispatch('/mcp add filesystem');
    expect(r1.handled).toBe(true);
    expect(addHandler).toHaveBeenCalledWith(['filesystem']);
    expect(removeHandler).not.toHaveBeenCalled();

    const r2 = registry.dispatch('/mcp remove filesystem');
    expect(r2.handled).toBe(true);
    expect(removeHandler).toHaveBeenCalledWith(['filesystem']);
    expect(listHandler).not.toHaveBeenCalled();
  });

  it('dispatch falls back to the parent handler when the sub-name does not match', () => {
    const registry = new CommandRegistry();
    const parentHandler = vi.fn();
    registry.register({
      name: 'mcp',
      description: 'MCP ops',
      handler: parentHandler,
      subCommands: [
        { name: 'add', description: 'add', handler: () => undefined },
      ],
    });
    const r = registry.dispatch('/mcp unknown-sub');
    expect(r.handled).toBe(true);
    expect(parentHandler).toHaveBeenCalledWith(['unknown-sub']);
  });

  it('dispatch calls the parent handler when no args are provided', () => {
    const registry = new CommandRegistry();
    const parentHandler = vi.fn();
    registry.register({
      name: 'mcp',
      description: 'MCP ops',
      handler: parentHandler,
      subCommands: [
        { name: 'add', description: 'add', handler: () => undefined },
      ],
    });
    const r = registry.dispatch('/mcp');
    expect(r.handled).toBe(true);
    expect(parentHandler).toHaveBeenCalledWith([]);
  });
});

// ─── Async completion ─────────────────────────────────────────────────────

describe('T-061: async completion', () => {
  it('a command with a completion provider returns candidate strings', async () => {
    const registry = new CommandRegistry();
    registry.register({
      name: 'theme',
      description: 'theme',
      handler: () => undefined,
      completion: async ({ partialArg }) => {
        const all = ['dark', 'light', 'solarized', 'gruvbox'];
        return all.filter((t) => t.startsWith(partialArg));
      },
    });
    const cmd = registry.get('theme')!;
    const candidates = await cmd.completion!({ args: [], partialArg: 'so' });
    expect(candidates).toEqual(['solarized']);
  });

  it('completion can return a synchronous string[]', async () => {
    const registry = new CommandRegistry();
    registry.register({
      name: 'model',
      description: 'model',
      handler: () => undefined,
      completion: ({ partialArg }) => {
        const all = ['gpt-4', 'gpt-3.5', 'claude-3'];
        return all.filter((m) => m.startsWith(partialArg));
      },
    });
    const cmd = registry.get('model')!;
    const candidates = await cmd.completion!({ args: [], partialArg: 'gpt' });
    expect(candidates).toEqual(['gpt-4', 'gpt-3.5']);
  });

  it('commands without a completion provider return undefined for the field', () => {
    const registry = new CommandRegistry();
    registry.register({
      name: 'plain',
      description: 'plain',
      handler: () => undefined,
    });
    const cmd = registry.get('plain')!;
    expect(cmd.completion).toBeUndefined();
  });
});

// ─── Abort signal ─────────────────────────────────────────────────────────

describe('T-061: abort signal', () => {
  it('create does not crash when an AbortSignal is provided', async () => {
    const registry = new CommandRegistry();
    const svc = new CommandService(registry);
    const controller = new AbortController();
    svc.addLoader(async () => [
      { source: 'builtin', command: { name: 'foo', description: 'f', handler: () => undefined } },
    ]);
    const result = await svc.create(controller.signal);
    expect(result.count).toBe(1);
  });

  it('loaders receive the signal as an argument', async () => {
    const registry = new CommandRegistry();
    const svc = new CommandService(registry);
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    svc.addLoader(async (signal) => {
      receivedSignal = signal;
      return [];
    });
    await svc.create(controller.signal);
    expect(receivedSignal).toBe(controller.signal);
  });
});
