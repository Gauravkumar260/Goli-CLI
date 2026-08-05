/**
 * MCP extension API test (T-008 / A8).
 *
 * Verifies that:
 *   1. The example MCP server file exists at examples/mcp-hello-world/server.js
 *   2. The server.js file exports a valid MCP server (syntactic check —
 *      we don't actually run it, since it requires npm install of
 *      @modelcontextprotocol/sdk which isn't part of the main deps)
 *   3. `scanMcpServers` returns the reference servers (filesystem, git,
 *      github) — proving the MCP discovery API works
 *   4. `addMcpServer` + `listMcpServers` round-trip works — proving
 *      a user can register an MCP server without touching core source
 *   5. The example server can be added to the config (proving A8:
 *      "An MCP-style extension can be added without touching core source")
 */

import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  addMcpServer,
  removeMcpServer,
  listMcpServers,
  scanMcpServers,
  defaultMcpConfigPath,
} from '@goli/cli/commands/mcp-config.js';
import { REFERENCE_MCP_SERVERS } from '../src/mcp/index.js';

const EXAMPLE_SERVER = resolve(process.cwd(), 'examples/mcp-hello-world/server.js');
const EXAMPLE_PKG = resolve(process.cwd(), 'examples/mcp-hello-world/package.json');

describe('T-008: MCP extension API (A8)', () => {
  let configDir: string;
  let configPath: string;
  let origGoliHome: string | undefined;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'goli-t008-mcp-'));
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

  describe('example MCP server file', () => {
    it('examples/mcp-hello-world/server.js exists', () => {
      expect(existsSync(EXAMPLE_SERVER)).toBe(true);
    });

    it('examples/mcp-hello-world/package.json exists', () => {
      expect(existsSync(EXAMPLE_PKG)).toBe(true);
    });

    it('server.js imports @modelcontextprotocol/sdk Server and StdioServerTransport', () => {
      const src = readFileSync(EXAMPLE_SERVER, 'utf-8');
      expect(src).toContain('@modelcontextprotocol/sdk/server/index.js');
      expect(src).toContain('@modelcontextprotocol/sdk/server/stdio.js');
      expect(src).toContain('new Server(');
      expect(src).toContain('StdioServerTransport');
    });

    it('server.js registers a `greet` tool via tools/list handler', () => {
      const src = readFileSync(EXAMPLE_SERVER, 'utf-8');
      expect(src).toContain("tools/list");
      expect(src).toContain("'greet'");
      expect(src).toContain('tools/call');
    });

    it('package.json declares @modelcontextprotocol/sdk dependency', () => {
      const pkg = JSON.parse(readFileSync(EXAMPLE_PKG, 'utf-8'));
      expect(pkg.dependencies['@modelcontextprotocol/sdk']).toBeDefined();
    });
  });

  describe('MCP discovery API (scanMcpServers)', () => {
    it('scanMcpServers returns reference servers not yet configured', () => {
      const available = scanMcpServers(configPath);
      // The reference set always includes at least filesystem + git
      const names = available.map((s) => s.name);
      expect(names).toContain('filesystem');
      expect(names).toContain('git');
      expect(available.length).toBeGreaterThanOrEqual(3);
    });

    it('scanMcpServers excludes servers that have been added', () => {
      // Add the 'filesystem' server
      addMcpServer({
        name: 'filesystem',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
        autoConnect: false,
      }, configPath);

      const available = scanMcpServers(configPath);
      const names = available.map((s) => s.name);
      expect(names).not.toContain('filesystem');
      expect(names).toContain('git'); // still present
    });

    it('REFERENCE_MCP_SERVERS is a non-empty array (source of truth for scan)', () => {
      expect(Array.isArray(REFERENCE_MCP_SERVERS)).toBe(true);
      expect(REFERENCE_MCP_SERVERS.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('MCP registration round-trip (addMcpServer + listMcpServers)', () => {
    it('can register the hello-world example server and list it', () => {
      // This is the A8 acceptance criterion: "An MCP-style extension can
      // be added without touching core source."
      const result = addMcpServer({
        name: 'hello-world',
        transport: 'stdio',
        command: 'node',
        args: [EXAMPLE_SERVER],
        autoConnect: false,
      }, configPath);

      expect(result.ok).toBe(true);

      const servers = listMcpServers(configPath);
      expect(servers.length).toBe(1);
      expect(servers[0]!.name).toBe('hello-world');
      expect(servers[0]!.transport).toBe('stdio');
      expect(servers[0]!.command).toBe('node');
      expect(servers[0]!.args).toEqual([EXAMPLE_SERVER]);
    });

    it('can remove a registered server', () => {
      addMcpServer({
        name: 'hello-world',
        transport: 'stdio',
        command: 'node',
        args: [EXAMPLE_SERVER],
        autoConnect: false,
      }, configPath);

      expect(listMcpServers(configPath).length).toBe(1);

      const result = removeMcpServer('hello-world', configPath);
      expect(result.ok).toBe(true);
      expect(listMcpServers(configPath).length).toBe(0);
    });

    it('can register multiple servers', () => {
      addMcpServer({
        name: 'hello-world',
        transport: 'stdio',
        command: 'node',
        args: [EXAMPLE_SERVER],
        autoConnect: false,
      }, configPath);
      addMcpServer({
        name: 'filesystem',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
        autoConnect: false,
      }, configPath);

      const servers = listMcpServers(configPath);
      expect(servers.length).toBe(2);
      const names = servers.map((s) => s.name).sort();
      expect(names).toEqual(['filesystem', 'hello-world']);
    });
  });

  describe('docs/extensions/mcp.md exists', () => {
    it('docs/extensions/mcp.md exists with hello-world example', () => {
      const doc = resolve(process.cwd(), 'docs/extensions/mcp.md');
      expect(existsSync(doc)).toBe(true);
      const src = readFileSync(doc, 'utf-8');
      expect(src).toContain('hello-world');
      expect(src).toContain('examples/mcp-hello-world/');
      expect(src).toContain('A8');
    });
  });
});
