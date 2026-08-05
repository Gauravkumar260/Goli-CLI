/**
 * MCP module public exports (Module 3, part 2).
 *
 * @module tools/mcp
 */

import type { MCPServerConfig } from './types.js';

/**
 *
 */
export type {
  MCPTransport,
  MCPServerConfig,
  MCPTool,
  JsonRpcRequest,
  JsonRpcResponse,
  MCPConnectionState,
  MCPSession,
} from './types.js';
/**
 *
 */
export { MCPClientManager } from './client.js';
/**
 *
 */
export type { MCPClientManagerOptions, MCPToolCallResult } from './client.js';

/**
 * Default reference MCP server configurations.
 *
 * These are common MCP servers that users can enable. They're not
 * auto-connected — the user must opt in via `config/mcp-servers.toml`
 * (Phase 6+).
 *
 * ## Why not `npx -y`?
 *
 * The previous implementation used `command: 'npx'` with
 * `args: ['-y', '@modelcontextprotocol/server-filesystem', ...]`.
 * The `-y` flag auto-accepts the `npx` "install this package?"
 * prompt, which means the FIRST time a user enables a reference
 * server, `npx` silently downloads and executes arbitrary code from
 * npm. If the user's npm registry is compromised (or a typosquat
 * sneaks in), the sandbox is bypassed.
 *
 * We now require the user to install the package globally (or have
 * it on `PATH`) and call the binary directly. This makes the install
 * step explicit and visible, and lets the user audit the package
 * before running it. The `installHint` field documents how to
 * install each server.
 *
 * `process.cwd()` is also no longer evaluated at module load — it
 * was captured the moment this module was first imported, which
 * could be before the workspace was initialized. We now resolve
 * `process.cwd()` lazily when the user actually starts a server.
 */

/**
 *
 */
export interface ReferenceMcpServer extends Omit<MCPServerConfig, 'args'> {
  /** How to install the server binary (shown to the user before enable). */
  installHint?: string;
  /**
   * Args (lazily-resolved). Each entry is either a string or a
   * function returning a string — the latter is used for values
   * like `process.cwd()` that must be evaluated at start time, not
   * at module load time.
   */
  args?: Array<string | (() => string)>;
}

/**
 * Default reference MCP server configurations (frozen — plugins
 * cannot mutate the array to inject their own configs).
 */
export const REFERENCE_MCP_SERVERS: readonly ReferenceMcpServer[] = Object.freeze([
  {
    name: 'filesystem',
    transport: 'stdio',
    command: 'mcp-server-filesystem',
    args: [() => process.cwd()],
    autoConnect: false,
    installHint: 'npm install -g @modelcontextprotocol/server-filesystem',
  },
  {
    name: 'git',
    transport: 'stdio',
    command: 'mcp-server-git',
    args: [],
    autoConnect: false,
    installHint: 'npm install -g @modelcontextprotocol/server-git',
  },
  {
    name: 'github',
    transport: 'http',
    url: 'https://api.githubcopilot.com/mcp/',
    autoConnect: false,
  },
  {
    name: 'postgres',
    transport: 'stdio',
    command: 'mcp-server-postgres',
    args: [],
    autoConnect: false,
    installHint: 'npm install -g @modelcontextprotocol/server-postgres',
  },
  {
    name: 'fetch',
    transport: 'stdio',
    command: 'mcp-server-fetch',
    args: [],
    autoConnect: false,
    installHint: 'npm install -g @modelcontextprotocol/server-fetch',
  },
]);

/**
 * Build a fresh copy of the reference servers (with `process.cwd()`
 * re-evaluated at call time). Use this when starting servers — it
 * picks up the current workspace, not the workspace that was active
 * when this module was first imported.
 */
export function buildReferenceMcpServers(): MCPServerConfig[] {
  return REFERENCE_MCP_SERVERS.map((s) => ({
    name: s.name,
    transport: s.transport,
    command: s.command,
    args: s.args?.map((a) => (typeof a === 'function' ? a() : a)),
    env: s.env,
    url: s.url,
    token: s.token,
    autoConnect: s.autoConnect,
  }));
}
