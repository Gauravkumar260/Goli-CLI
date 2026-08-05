/**
 * MCP server config manager (H20).
 *
 * Manages a TOML config file at `$GOLI_HOME/mcp-servers.toml` (or
 * `~/.goli-cli/mcp-servers.toml`) containing user-defined MCP server
 * configurations. Supports add, remove, list, and scan operations.
 *
 * ## TOML format
 *
 * ```toml
 * [[servers]]
 * name = "filesystem"
 * transport = "stdio"
 * command = "npx"
 * args = ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
 * autoConnect = true
 *
 * [[servers]]
 * name = "github"
 * transport = "http"
 * url = "https://mcp.github.com/sse"
 * token = "ghp_..."
 * autoConnect = false
 * ```
 *
 * ## Why a separate config file (not config/default.toml)?
 *
 * - MCP servers are user-managed (added/removed via `goli mcp add/remove`),
 *   not project-managed. Putting them in `config/default.toml` would
 *   require editing the project config for every MCP change.
 * - The file lives in `$GOLI_HOME` (user-level), so the same MCP servers
 *   are available across all projects.
 * - Project-level MCP servers (`.goli/mcp-servers.toml`) are a future
 *   addition.
 *
 * @module cli/commands/mcp-config
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

import { buildReferenceMcpServers, type MCPServerConfig } from '@goli/core';

/** The MCP config file path. */
export function defaultMcpConfigPath(): string {
  const goliHome = process.env['GOLI_HOME'] ?? join(homedir(), '.goli-cli');
  return join(goliHome, 'mcp-servers.toml');
}

/** Result of an MCP config operation. */
export interface McpConfigResult {
  /** Whether the operation succeeded. */
  ok: boolean;
  /** Human-readable message. */
  message: string;
  /** The affected server config (if any). */
  server?: MCPServerConfig;
}

/**
 * Load all MCP server configs from the TOML file.
 *
 * If the file does not exist, returns an empty array (no error).
 *
 * @param configPath - The config file path (default: `$GOLI_HOME/mcp-servers.toml`).
 * @returns Array of server configs.
 */
export function loadMcpServers(configPath: string = defaultMcpConfigPath()): MCPServerConfig[] {
  if (!existsSync(configPath)) return [];
  const content = readFileSync(configPath, 'utf-8');
  return parseMcpToml(content);
}

/**
 * Parse a TOML string into an array of `MCPServerConfig`.
 *
 * The parser is minimal — it handles only the `[[servers]]` array-of-tables
 * syntax with string, array, and boolean values. For full TOML support,
 * use `@iarna/toml`; but for MCP configs, this is sufficient.
 * @param content
 */
function parseMcpToml(content: string): MCPServerConfig[] {
  const servers: MCPServerConfig[] = [];
  let current: Partial<MCPServerConfig> | null = null;

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;

    if (line === '[[servers]]') {
      if (current) servers.push(finalizeServer(current));
      current = {};
      continue;
    }

    if (!current) continue; // ignore top-level keys

    const m = line.match(/^(\w+)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1]!;
    const value = m[2]!;

    if (value.startsWith('["') || value.startsWith("['")) {
      // Array of strings
      const arrMatch = value.match(/^\[(.*)\]$/);
      if (arrMatch) {
        const items = arrMatch[1]!
          .split(',')
          .map((s) => s.trim().replace(/^["']|["']$/g, ''))
          .map((s) => unescapeTomlString(s))
          .filter((s) => s.length > 0);
        (current as Record<string, unknown>)[key] = items;
      }
    } else if (value === 'true' || value === 'false') {
      (current as Record<string, unknown>)[key] = value === 'true';
    } else {
      // String (strip quotes, then unescape TOML escapes)
      (current as Record<string, unknown>)[key] = unescapeTomlString(
        value.replace(/^["']|["']$/g, ''),
      );
    }
  }
  if (current) servers.push(finalizeServer(current));
  return servers;
}

function finalizeServer(partial: Partial<MCPServerConfig>): MCPServerConfig {
  return {
    name: partial.name ?? 'unnamed',
    transport: partial.transport ?? 'stdio',
    command: partial.command,
    args: partial.args,
    env: partial.env,
    url: partial.url,
    token: partial.token,
    autoConnect: partial.autoConnect ?? true,
  };
}

/**
 * Serialize an array of `MCPServerConfig` to TOML.
 * @param servers
 */
/**
 * P1-21 fix: Escape a string for inclusion in a TOML double-quoted value.
 *
 * Previously `serializeMcpToml` only escaped `"` inside `args` — `name`,
 * `command`, `url`, and `token` were interpolated verbatim. A user
 * running `goli mcp add 'foo"bar' npx …` (or any value containing a
 * quote or backslash) would produce corrupt TOML that wouldn't
 * round-trip through `parseMcpToml`, silently losing the server config.
 *
 * We escape per the TOML spec: backslash first, then double-quote, then
 * the control characters that have short escapes. Other control chars
 * are emitted as `\uXXXX` for safety.
 */
function escapeTomlString(s: string): string {
  return s
    .replace(/\\/g, '\\\\')   // backslash first (so we don't double-escape the escapes we add)
    .replace(/"/g, '\\"')     // double quote
    .replace(/\n/g, '\\n')    // newline
    .replace(/\r/g, '\\r')    // carriage return
    .replace(/\t/g, '\\t')    // tab
    // eslint-disable-next-line no-control-regex -- escape C0 controls + DEL for TOML string literal
    .replace(/[\x00-\x1f\x7f]/g, (ch) => {  // other C0 controls + DEL
      const code = ch.charCodeAt(0);
      return '\\u' + code.toString(16).padStart(4, '0');
    });
}

/**
 * Unescape a TOML double-quoted string value back to its literal form.
 *
 * Mirrors `escapeTomlString` so that values round-trip exactly. Notably,
 * on Windows an `args` entry like `F:\examples\server.js` is written as
 * `"F:\\examples\\server.js"`; without this unescape step, the parsed
 * value would retain the doubled backslashes (`F:\\examples\\server.js`).
 */
function unescapeTomlString(s: string): string {
  // Process `\uXXXX` first (4 hex digits), then the short escapes.
  // `\\` must be handled last so the backslashes we restore from the
  // other escapes aren't re-processed.
  return s
    // \uXXXX ranges are ASCII hex, so no-control-regex doesn't apply
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

function serializeMcpToml(servers: MCPServerConfig[]): string {
  const lines: string[] = ['# MCP server configurations (managed by `goli mcp`)', ''];
  for (const s of servers) {
    lines.push('[[servers]]');
    // P1-21 fix: escape ALL string values, not just `args`.
    lines.push(`name = "${escapeTomlString(s.name)}"`);
    lines.push(`transport = "${escapeTomlString(s.transport)}"`);
    if (s.command) lines.push(`command = "${escapeTomlString(s.command)}"`);
    if (s.args && s.args.length > 0) {
      const argsStr = s.args.map((a: string) => `"${escapeTomlString(a)}"`).join(', ');
      lines.push(`args = [${argsStr}]`);
    }
    if (s.url) lines.push(`url = "${escapeTomlString(s.url)}"`);
    if (s.token) lines.push(`token = "${escapeTomlString(s.token)}"`);
    if (s.autoConnect !== undefined) lines.push(`autoConnect = ${s.autoConnect}`);
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Add an MCP server to the config file.
 *
 * If a server with the same name already exists, it is replaced.
 *
 * @param server - The server config to add.
 * @param configPath - The config file path.
 * @returns The result of the operation.
 */
export function addMcpServer(
  server: MCPServerConfig,
  configPath: string = defaultMcpConfigPath(),
): McpConfigResult {
  if (!server.name) {
    return { ok: false, message: 'Server name is required' };
  }
  if (server.transport !== 'stdio' && server.transport !== 'http') {
    return { ok: false, message: `Invalid transport: ${server.transport}` };
  }
  if (server.transport === 'stdio' && !server.command) {
    return { ok: false, message: 'stdio transport requires a command' };
  }
  if (server.transport === 'http' && !server.url) {
    return { ok: false, message: 'http transport requires a url' };
  }

  const servers = loadMcpServers(configPath);
  const existingIdx = servers.findIndex((s) => s.name === server.name);
  if (existingIdx >= 0) {
    servers[existingIdx] = server;
  } else {
    servers.push(server);
  }

  // Ensure the parent directory exists.
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, serializeMcpToml(servers), 'utf-8');

  return {
    ok: true,
    message: existingIdx >= 0
      ? `Replaced MCP server '${server.name}' in ${configPath}`
      : `Added MCP server '${server.name}' to ${configPath}`,
    server,
  };
}

/**
 * Remove an MCP server from the config file.
 *
 * @param name - The server name to remove.
 * @param configPath - The config file path.
 * @returns The result of the operation.
 */
export function removeMcpServer(
  name: string,
  configPath: string = defaultMcpConfigPath(),
): McpConfigResult {
  const servers = loadMcpServers(configPath);
  const idx = servers.findIndex((s) => s.name === name);
  if (idx < 0) {
    return { ok: false, message: `MCP server '${name}' not found in ${configPath}` };
  }
  const removed = servers.splice(idx, 1)[0]!;
  writeFileSync(configPath, serializeMcpToml(servers), 'utf-8');
  return {
    ok: true,
    message: `Removed MCP server '${name}' from ${configPath}`,
    server: removed,
  };
}

/**
 * List all configured MCP servers.
 *
 * @param configPath - The config file path.
 * @returns Array of server configs (empty if none configured).
 */
export function listMcpServers(
  configPath: string = defaultMcpConfigPath(),
): MCPServerConfig[] {
  return loadMcpServers(configPath);
}

/**
 * Scan for reference MCP servers (from `REFERENCE_MCP_SERVERS` in core).
 *
 * Returns the list of reference servers that are NOT already in the
 * user's config. Useful for `goli mcp scan` to suggest servers to add.
 *
 * @param configPath - The config file path.
 * @returns Array of reference servers not yet configured.
 */
export function scanMcpServers(
  configPath: string = defaultMcpConfigPath(),
): MCPServerConfig[] {
  // REFERENCE_MCP_SERVERS is imported at the top of the file via ESM
  // (the previous require() failed because @goli/core is ESM-only with
  // no CJS export in its `exports` map).
  // Use buildReferenceMcpServers() which resolves lazy `() => string` args
  // to plain strings, giving us a properly-typed MCPServerConfig[] return.
  const configured = loadMcpServers(configPath);
  const configuredNames = new Set(configured.map((s) => s.name));
  const allResolved = buildReferenceMcpServers();
  return allResolved.filter((s: MCPServerConfig) => !configuredNames.has(s.name));
}
