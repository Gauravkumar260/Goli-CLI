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
 */
export const REFERENCE_MCP_SERVERS: MCPServerConfig[] = [
  {
    name: 'filesystem',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', process.cwd()],
    autoConnect: false,
  },
  {
    name: 'git',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-git'],
    autoConnect: false,
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
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres'],
    autoConnect: false,
  },
  {
    name: 'fetch',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-fetch'],
    autoConnect: false,
  },
];
