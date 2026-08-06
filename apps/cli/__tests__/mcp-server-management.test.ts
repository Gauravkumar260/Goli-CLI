/**
 * Unit tests for H20: MCP Server Management.
 *
 * Verifies:
 *   - addMcpServer adds a stdio server to the TOML config
 *   - addMcpServer adds an HTTP server
 *   - addMcpServer replaces an existing server with the same name
 *   - addMcpServer validates name, transport, command/url
 *   - removeMcpServer removes a server
 *   - removeMcpServer returns error for unknown server
 *   - listMcpServers returns all configured servers
 *   - listMcpServers returns empty array when config doesn't exist
 *   - scanMcpServers returns reference servers not yet configured
 *   - TOML round-trip (parse → serialize → parse) is stable
 */

import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  addMcpServer,
  removeMcpServer,
  listMcpServers,
  scanMcpServers,
  defaultMcpConfigPath,
} from '../src/commands/mcp-config.js';

describe('H20 MCP config management', () => {
  let configDir: string;
  let configPath: string;
  let origGoliHome: string | undefined;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'goli-h20-mcp-'));
    configPath = join(configDir, 'mcp-servers.toml');
    origGoliHome = process.env['GOLI_HOME'];
    process.env['GOLI_HOME'] = configDir;
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
    if (origGoliHome === undefined) {
      delete process.env['GOLI_HOME'];
    } else {
      process.env['GOLI_HOME'] = origGoliHome;
    }
  });

  it('addMcpServer adds a stdio server', () => {
    const result = addMcpServer({
      name: 'filesystem',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      autoConnect: true,
    }, configPath);
    expect(result.ok).toBe(true);
    expect(result.message).toContain('Added');
    expect(existsSync(configPath)).toBe(true);

    const servers = listMcpServers(configPath);
    expect(servers).toHaveLength(1);
    expect(servers[0]!.name).toBe('filesystem');
    expect(servers[0]!.transport).toBe('stdio');
    expect(servers[0]!.command).toBe('npx');
    expect(servers[0]!.args).toEqual(['-y', '@modelcontextprotocol/server-filesystem', '/tmp']);
    expect(servers[0]!.autoConnect).toBe(true);
  });

  it('addMcpServer adds an HTTP server', () => {
    const result = addMcpServer({
      name: 'github',
      transport: 'http',
      url: 'https://mcp.github.com/sse',
      token: 'ghp_token',
      autoConnect: false,
    }, configPath);
    expect(result.ok).toBe(true);

    const servers = listMcpServers(configPath);
    expect(servers).toHaveLength(1);
    expect(servers[0]!.name).toBe('github');
    expect(servers[0]!.transport).toBe('http');
    expect(servers[0]!.url).toBe('https://mcp.github.com/sse');
    expect(servers[0]!.token).toBe('ghp_token');
    expect(servers[0]!.autoConnect).toBe(false);
  });

  it('addMcpServer replaces an existing server with the same name', () => {
    addMcpServer({
      name: 'fs',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'old-package'],
    }, configPath);
    const result = addMcpServer({
      name: 'fs',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'new-package'],
    }, configPath);
    expect(result.ok).toBe(true);
    expect(result.message).toContain('Replaced');

    const servers = listMcpServers(configPath);
    expect(servers).toHaveLength(1);
    expect(servers[0]!.args).toEqual(['-y', 'new-package']);
  });

  it('addMcpServer validates name', () => {
    const result = addMcpServer({
      name: '',
      transport: 'stdio',
      command: 'npx',
    }, configPath);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('name is required');
  });

  it('addMcpServer validates transport', () => {
    const result = addMcpServer({
      name: 'bad',
      transport: 'ftp' as never,
      command: 'x',
    }, configPath);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('Invalid transport');
  });

  it('addMcpServer validates stdio requires command', () => {
    const result = addMcpServer({
      name: 'bad',
      transport: 'stdio',
      command: undefined,
    }, configPath);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('stdio transport requires a command');
  });

  it('addMcpServer validates http requires url', () => {
    const result = addMcpServer({
      name: 'bad',
      transport: 'http',
      url: undefined,
    }, configPath);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('http transport requires a url');
  });

  it('removeMcpServer removes a server', () => {
    addMcpServer({
      name: 'fs',
      transport: 'stdio',
      command: 'npx',
    }, configPath);
    const result = removeMcpServer('fs', configPath);
    expect(result.ok).toBe(true);
    expect(result.message).toContain('Removed');
    expect(listMcpServers(configPath)).toHaveLength(0);
  });

  it('removeMcpServer returns error for unknown server', () => {
    const result = removeMcpServer('nonexistent', configPath);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('not found');
  });

  it('listMcpServers returns empty array when config does not exist', () => {
    expect(listMcpServers(configPath)).toEqual([]);
  });

  it('TOML round-trip preserves all fields', () => {
    const original: Array<{ name: string; transport: 'stdio' | 'http'; command?: string; args?: string[]; url?: string; token?: string; autoConnect?: boolean }> = [
      {
        name: 'fs',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
        autoConnect: true,
      },
      {
        name: 'gh',
        transport: 'http',
        url: 'https://mcp.github.com/sse',
        token: 'ghp_token',
        autoConnect: false,
      },
    ];
    for (const s of original) addMcpServer(s, configPath);
    const loaded = listMcpServers(configPath);
    expect(loaded).toHaveLength(2);
    expect(loaded[0]!.name).toBe('fs');
    expect(loaded[0]!.command).toBe('npx');
    expect(loaded[0]!.args).toEqual(['-y', '@modelcontextprotocol/server-filesystem', '/tmp']);
    expect(loaded[0]!.autoConnect).toBe(true);
    expect(loaded[1]!.name).toBe('gh');
    expect(loaded[1]!.url).toBe('https://mcp.github.com/sse');
    expect(loaded[1]!.token).toBe('ghp_token');
    expect(loaded[1]!.autoConnect).toBe(false);
  });

  it('scanMcpServers returns reference servers not yet configured', () => {
    // Initially, all reference servers should be available to add.
    const available = scanMcpServers(configPath);
    expect(available.length).toBeGreaterThan(0);

    // Add one of the reference servers; it should no longer appear in scan.
    const firstRef = available[0]!;
    addMcpServer(firstRef, configPath);
    const available2 = scanMcpServers(configPath);
    expect(available2.find((s) => s.name === firstRef.name)).toBeUndefined();
  });
});

describe('H20 defaultMcpConfigPath', () => {
  let origGoliHome: string | undefined;

  beforeEach(() => {
    origGoliHome = process.env['GOLI_HOME'];
  });

  afterEach(() => {
    if (origGoliHome === undefined) {
      delete process.env['GOLI_HOME'];
    } else {
      process.env['GOLI_HOME'] = origGoliHome;
    }
  });

  it('returns $GOLI_HOME/mcp-servers.toml when GOLI_HOME is set', () => {
    process.env['GOLI_HOME'] = '/tmp/test-goli-home';
    expect(defaultMcpConfigPath()).toBe(join('/tmp/test-goli-home', 'mcp-servers.toml'));
  });
});
