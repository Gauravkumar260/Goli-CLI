/**
 * MCP client types (Module 3, part 2).
 *
 * The Model Context Protocol (MCP) is the industry-standard protocol for
 * connecting AI agents to external tool servers. MCP servers expose
 * tools, resources, and prompts via JSON-RPC 2.0 over stdio or HTTP.
 *
 * Phase 6 implements MCP v1.x (production-stable). MCP v2 (ships
 * 2026-07-28) adds stateless core, OAuth 2.1, and the MCP Apps/Tasks
 * extensions — we'll migrate in a later phase.
 *
 * @module tools/mcp/types
 */

/** MCP transport type. */
export type MCPTransport = 'stdio' | 'http';

/** An MCP server configuration. */
export interface MCPServerConfig {
  /** The server name (used for namespacing: `server_name:tool_name`). */
  name: string;
  /** The transport type. */
  transport: MCPTransport;
  /** For stdio: the command to run (e.g. `npx`). */
  command?: string;
  /** For stdio: the command arguments. */
  args?: string[];
  /** For stdio: environment variables. */
  env?: Record<string, string>;
  /** For http: the server URL. */
  url?: string;
  /** For http: OAuth token. */
  token?: string;
  /** Whether to auto-connect on startup. Default: true. */
  autoConnect?: boolean;
}

/** An MCP tool definition (from tools/list). */
export interface MCPTool {
  /** The tool name (without the server prefix). */
  name: string;
  /** The tool description. */
  description: string;
  /** The JSON Schema for the input parameters. */
  inputSchema: Record<string, unknown>;
  /** The server that exposes this tool. */
  serverName: string;
}

/** A JSON-RPC 2.0 request. */
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: unknown;
}

/** A JSON-RPC 2.0 response. */
export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** Connection state of an MCP server. */
export type MCPConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

/** An MCP server session. */
export interface MCPSession {
  /** The server name. */
  name: string;
  /** The connection state. */
  state: MCPConnectionState;
  /** The transport type. */
  transport: MCPTransport;
  /** Discovered tools (from tools/list). */
  tools: MCPTool[];
  /** Error message (if state is 'error'). */
  error?: string;
}
