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

/**
 * MCP transport type.
 *
 * P1-20 fix (remediation plan Phase 20): added `'sse'` and `'ws'`
 * transports. The SSE transport uses Server-Sent Events for
 * server→client push + HTTP POST for client→server; the WS transport
 * uses bidirectional WebSocket frames. Both are implemented as
 * transport adapters in `transports/sse.ts` and `transports/ws.ts`
 * (stubs that document the contract — full implementation requires
 * the `eventsource` and `ws` npm packages, which are future deps).
 */
export type MCPTransport = 'stdio' | 'http' | 'sse' | 'ws';

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

/** An MCP tool definition (from tools/list).
 *
 * MEDIUM-29: the previous `inputSchema` was typed as
 * `Record<string, unknown>`, which provided NO type-safety. A
 * caller could pass `{ type: 'object' }` (valid) or
 * `{ type: 'string', bogus: true }` (invalid) and TypeScript
 * accepted both. We now use a JSON Schema subset type that
 * enforces the required `type` field and the common properties.
 */
export interface MCPTool {
  /** The tool name (without the server prefix). */
  name: string;
  /** The tool description. */
  description: string;
  /** The JSON Schema for the input parameters. */
  inputSchema: McpInputSchema;
  /** The server that exposes this tool. */
  serverName: string;
}

/**
 * A JSON Schema subset for MCP tool input parameters.
 *
 * This is NOT a full JSON Schema type — it covers the shapes that
 * MCP servers actually emit (object with properties, required, and
 * additionalProperties). Servers that emit non-object schemas (e.g.
 * for tools that take a single string) are out of scope and will
 * fail validation at the boundary.
 */
export interface McpInputSchema {
  /** The schema type. MCP tools take object inputs. */
  type: 'object';
  /** Property definitions (key = parameter name). */
  properties?: Record<string, unknown>;
  /** Required parameter names. */
  required?: string[];
  /** Whether additional properties are allowed. */
  additionalProperties?: boolean;
  /** A textual description of the schema. */
  description?: string;
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
