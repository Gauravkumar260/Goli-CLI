/**
 * `goli mcp` subcommand (H20).
 *
 * Manages MCP server configurations. Subcommands:
 *
 * - `goli mcp add <name> <command...>` — add a stdio MCP server
 * - `goli mcp add <name> --url <url>` — add an HTTP MCP server
 * - `goli mcp remove <name>` — remove a server
 * - `goli mcp list` — list configured servers
 * - `goli mcp scan` — show reference servers not yet configured
 *
 * ## Examples
 *
 * ```sh
 * goli mcp add filesystem npx -y @modelcontextprotocol/server-filesystem /tmp
 * goli mcp add github --url https://mcp.github.com/sse --token ghp_...
 * goli mcp list
 * goli mcp remove filesystem
 * goli mcp scan
 * ```
 *
 * @module cli/commands/mcp
 */

import { Command } from 'commander';

import {
  addMcpServer,
  removeMcpServer,
  listMcpServers,
  scanMcpServers,
  defaultMcpConfigPath,
} from './mcp-config.js';

import type { MCPServerConfig } from '@goli-cli/tool-system';

/**
 * Build the `goli mcp` subcommand tree.
 *
 * Exported for testing — tests can call `buildMcpCommand()` and invoke
 * `.parseAsync(argv)` without touching `process.exit`.
 */
export function buildMcpCommand(): Command {
  const mcp = new Command('mcp')
    .description('Manage MCP (Model Context Protocol) server configurations');

  // ─── mcp add ────────────────────────────────────────────────
  mcp
    .command('add <name> [command...]')
    .description('Add an MCP server. For stdio: pass the command + args. For HTTP: use --url.')
    .option('--url <url>', 'HTTP transport URL (alternative to command)')
    .option('--token <token>', 'OAuth token for HTTP transport')
    .option('--no-auto-connect', 'Do not auto-connect on startup')
    .action((name: string, command: string[], opts: {
      url?: string;
      token?: string;
      autoConnect?: boolean;
    }) => {
      const configPath = defaultMcpConfigPath();
      let server: MCPServerConfig;

      if (opts.url) {
        // HTTP transport
        server = {
          name,
          transport: 'http',
          url: opts.url,
          token: opts.token,
          autoConnect: opts.autoConnect !== false,
        };
      } else if (command.length > 0) {
        // stdio transport
        server = {
          name,
          transport: 'stdio',
          command: command[0]!,
          args: command.slice(1),
          autoConnect: opts.autoConnect !== false,
        };
      } else {
        process.stderr.write('Error: either a command or --url is required\n');
        process.exitCode = 1;
        return;
      }

      const result = addMcpServer(server, configPath);
      if (result.ok) {
        process.stdout.write(`${result.message}\n`);
      } else {
        process.stderr.write(`Error: ${result.message}\n`);
        process.exitCode = 1;
      }
    });

  // ─── mcp remove ─────────────────────────────────────────────
  mcp
    .command('remove <name>')
    .description('Remove an MCP server from the config')
    .action((name: string) => {
      const result = removeMcpServer(name, defaultMcpConfigPath());
      if (result.ok) {
        process.stdout.write(`${result.message}\n`);
      } else {
        process.stderr.write(`Error: ${result.message}\n`);
        process.exitCode = 1;
      }
    });

  // ─── mcp list ───────────────────────────────────────────────
  mcp
    .command('list')
    .description('List configured MCP servers')
    .option('--json', 'Output as JSON')
    .action((opts: { json?: boolean }) => {
      const servers = listMcpServers(defaultMcpConfigPath());
      if (servers.length === 0) {
        if (opts.json) {
          process.stdout.write('[]\n');
        } else {
          process.stdout.write('No MCP servers configured. Use `goli mcp add` or `goli mcp scan` to discover servers.\n');
        }
        return;
      }
      if (opts.json) {
        process.stdout.write(JSON.stringify(servers, null, 2) + '\n');
        return;
      }
      process.stdout.write(`MCP servers (${servers.length}):\n\n`);
      for (const s of servers) {
        const conn = s.autoConnect ? 'auto' : 'manual';
        if (s.transport === 'stdio') {
          const args = s.args && s.args.length > 0 ? ' ' + s.args.join(' ') : '';
          process.stdout.write(`  ${s.name} (${s.transport}, ${conn})\n    ${s.command}${args}\n\n`);
        } else {
          process.stdout.write(`  ${s.name} (${s.transport}, ${conn})\n    ${s.url}\n\n`);
        }
      }
    });

  // ─── mcp scan ───────────────────────────────────────────────
  mcp
    .command('scan')
    .description('Show reference MCP servers not yet configured')
    .option('--json', 'Output as JSON')
    .action((opts: { json?: boolean }) => {
      const available = scanMcpServers(defaultMcpConfigPath());
      if (available.length === 0) {
        if (opts.json) {
          process.stdout.write('[]\n');
        } else {
          process.stdout.write('All reference MCP servers are already configured.\n');
        }
        return;
      }
      if (opts.json) {
        process.stdout.write(JSON.stringify(available, null, 2) + '\n');
        return;
      }
      process.stdout.write(`Reference MCP servers available to add (${available.length}):\n\n`);
      for (const s of available) {
        if (s.transport === 'stdio') {
          const args = s.args && s.args.length > 0 ? ' ' + s.args.join(' ') : '';
          process.stdout.write(`  ${s.name} — ${s.command}${args}\n`);
        } else if (s.url) {
          process.stdout.write(`  ${s.name} — ${s.url}\n`);
        } else {
          process.stdout.write(`  ${s.name}\n`);
        }
      }
      process.stdout.write('\nUse `goli mcp add <name> ...` to add a server.\n');
    });

  return mcp;
}
