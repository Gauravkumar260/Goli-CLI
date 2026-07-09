/**
 * MCP client manager (Module 3, part 2).
 *
 * Manages connections to MCP servers, discovers tools via `tools/list`,
 * and dispatches tool calls via `tools/call`. Tools are namespaced by
 * server name (`server_name:tool_name`) to avoid collisions across
 * 30+ MCP servers.
 *
 * ## Transports
 *
 * - **stdio**: spawns a child process and communicates via stdin/stdout
 *   JSON-RPC. Used for local MCP servers (filesystem, git, postgres).
 * - **http**: connects to a remote server via HTTP. Used for cloud MCP
 *   servers (github, browser).
 *
 * ## Protocol
 *
 * MCP uses JSON-RPC 2.0. The client sends:
 *   `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`
 * The server responds:
 *   `{"jsonrpc":"2.0","id":1,"result":{"tools":[...]}}`
 *
 * @module tools/mcp/client
 */

import { spawn, type ChildProcess } from 'node:child_process';

import type {
  MCPServerConfig,
  MCPTool,
  MCPSession,
  MCPConnectionState,
  JsonRpcRequest,
  JsonRpcResponse,
} from './types.js';
import type { Logger } from '../../utils/logger.js';

/** Options for constructing an MCPClientManager. */
export interface MCPClientManagerOptions {
  /** Logger instance (optional). */
  logger?: Logger;
}

/** The result of calling an MCP tool. */
export interface MCPToolCallResult {
  /** Whether the call succeeded. */
  ok: boolean;
  /** The output content. */
  content: string;
  /** Error message (if `ok` is false). */
  error?: string;
}

/**
 * MCP client manager — manages connections to MCP servers.
 *
 * @module tools/mcp/client
 */
export class MCPClientManager {
  private readonly sessions = new Map<string, MCPSession>();
  private readonly processes = new Map<string, ChildProcess>();
  private readonly log?: Logger;
  private requestId = 0;

  constructor(opts: MCPClientManagerOptions = {}) {
    this.log = opts.logger;
  }

  /**
   * Connect to an MCP server (stdio transport).
   *
   * Spawns the server process, sends `initialize`, and calls `tools/list`.
   * @param config
   */
  async connectStdio(config: MCPServerConfig): Promise<MCPSession> {
    if (!config.command) {
      throw new Error(`MCP server "${config.name}" has no command for stdio transport`);
    }

    this.log?.info('Connecting to MCP server (stdio)', { name: config.name, command: config.command });

    const session: MCPSession = {
      name: config.name,
      state: 'connecting',
      transport: 'stdio',
      tools: [],
    };
    this.sessions.set(config.name, session);

    try {
      const child = spawn(config.command, config.args ?? [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...config.env },
      });
      this.processes.set(config.name, child);

      // Set up message buffer (JSON-RPC messages are newline-delimited)
      let buffer = '';
      child.stdout?.on('data', (data: Buffer) => {
        buffer += data.toString('utf-8');
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (line.trim()) {
            this.handleMessage(config.name, line.trim());
          }
        }
      });

      child.stderr?.on('data', (data: Buffer) => {
        this.log?.warn('MCP server stderr', { name: config.name, stderr: data.toString('utf-8').trim() });
      });

      child.on('error', (err) => {
        this.log?.error('MCP server process error', { name: config.name, error: err.message });
        this.updateSessionState(config.name, 'error', err.message);
      });

      child.on('exit', (code) => {
        this.log?.info('MCP server exited', { name: config.name, exitCode: code });
        this.updateSessionState(config.name, 'disconnected');
        this.processes.delete(config.name);
      });

      // Send initialize request
      await this.sendRequest(config.name, 'initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'goli-cli', version: '0.2.0' },
      });

      // Send initialized notification
      this.sendNotification(config.name, 'notifications/initialized', {});

      // Discover tools
      const toolsResult = await this.sendRequest(config.name, 'tools/list', {});
      const tools = (toolsResult as { tools?: MCPTool[] })?.tools ?? [];
      session.tools = tools.map((t) => ({ ...t, serverName: config.name }));

      session.state = 'connected';
      this.log?.info('MCP server connected', { name: config.name, toolCount: tools.length });

      return session;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log?.error('MCP connection failed', { name: config.name, error: message });
      session.state = 'error';
      session.error = message;
      return session;
    }
  }

  /**
   * Connect to an MCP server (HTTP transport).
   * Phase 6 stub — full HTTP + OAuth support lands in a later iteration.
   * @param config
   */
  async connectHttp(config: MCPServerConfig): Promise<MCPSession> {
    if (!config.url) {
      throw new Error(`MCP server "${config.name}" has no URL for http transport`);
    }

    this.log?.info('Connecting to MCP server (http)', { name: config.name, url: config.url });

    const session: MCPSession = {
      name: config.name,
      state: 'connecting',
      transport: 'http',
      tools: [],
    };
    this.sessions.set(config.name, session);

    try {
      // Phase 6 stub: send tools/list via HTTP
      const response = await fetch(config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: ++this.requestId,
          method: 'tools/list',
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const json = (await response.json()) as JsonRpcResponse;
      const tools = (json.result as { tools?: MCPTool[] })?.tools ?? [];
      session.tools = tools.map((t) => ({ ...t, serverName: config.name }));
      session.state = 'connected';

      this.log?.info('MCP server connected', { name: config.name, toolCount: tools.length });
      return session;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log?.error('MCP HTTP connection failed', { name: config.name, error: message });
      session.state = 'error';
      session.error = message;
      return session;
    }
  }

  /**
   * Connect to an MCP server (auto-detect transport from config).
   * @param config
   */
  async connect(config: MCPServerConfig): Promise<MCPSession> {
    if (config.transport === 'stdio') {
      return this.connectStdio(config);
    } else {
      return this.connectHttp(config);
    }
  }

  /**
   * Disconnect from an MCP server.
   * @param name
   */
  async disconnect(name: string): Promise<void> {
    const child = this.processes.get(name);
    if (child) {
      child.kill('SIGTERM');
      this.processes.delete(name);
    }
    this.updateSessionState(name, 'disconnected');
  }

  /**
   * Disconnect from all MCP servers.
   */
  async disconnectAll(): Promise<void> {
    for (const name of this.sessions.keys()) {
      await this.disconnect(name);
    }
  }

  /**
   * Get all discovered tools from all connected servers.
   */
  getAllTools(): MCPTool[] {
    return [...this.sessions.values()]
      .filter((s) => s.state === 'connected')
      .flatMap((s) => s.tools);
  }

  /**
   * Get all sessions.
   */
  getSessions(): MCPSession[] {
    return [...this.sessions.values()];
  }

  /**
   * Get a session by name.
   * @param name
   */
  getSession(name: string): MCPSession | undefined {
    return this.sessions.get(name);
  }

  /**
   * Call a tool on an MCP server.
   *
   * @param namespacedName - The tool name in `server_name:tool_name` format.
   * @param args - The tool arguments.
   * @returns The tool call result.
   */
  async callTool(
    namespacedName: string,
    args: Record<string, unknown>,
  ): Promise<MCPToolCallResult> {
    // Split on the FIRST colon only — tool names may contain colons
    // (e.g. `mcp:tool:sub:command`). The previous implementation used
    // `split(':')` which truncated `mcp:tool:sub` to `serverName='mcp'`,
    // `toolName='tool'`, discarding `:sub`.
    const colonIdx = namespacedName.indexOf(':');
    if (colonIdx === -1) {
      return { ok: false, content: '', error: `Invalid tool name: ${namespacedName} (expected server:tool)` };
    }
    const serverName = namespacedName.slice(0, colonIdx);
    const toolName = namespacedName.slice(colonIdx + 1);
    if (!serverName || !toolName) {
      return { ok: false, content: '', error: `Invalid tool name: ${namespacedName} (expected server:tool)` };
    }

    const session = this.sessions.get(serverName);
    if (!session || session.state !== 'connected') {
      return { ok: false, content: '', error: `MCP server "${serverName}" is not connected` };
    }

    const tool = session.tools.find((t) => t.name === toolName);
    if (!tool) {
      return { ok: false, content: '', error: `Tool "${toolName}" not found on server "${serverName}"` };
    }

    try {
      const result = await this.sendRequest(serverName, 'tools/call', {
        name: toolName,
        arguments: args,
      });

      const content = (result as { content?: Array<{ type: string; text?: string }> })?.content;
      const text = content
        ?.filter((c) => c.type === 'text')
        .map((c) => c.text ?? '')
        .join('\n') ?? '';

      return { ok: true, content: text || '(no output)' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, content: '', error: `MCP tool call failed: ${message}` };
    }
  }

  // ─── Internal helpers ──────────────────────────────────────────

  private readonly pendingRequests = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (err: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();

  private sendRequest(serverName: string, method: string, params: unknown): Promise<unknown> {
    const id = ++this.requestId;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(String(id));
        reject(new Error(`MCP request timeout: ${method} (server: ${serverName})`));
      }, 30_000);

      this.pendingRequests.set(String(id), { resolve, reject, timeout });

      const child = this.processes.get(serverName);
      if (child?.stdin?.writable) {
        child.stdin.write(JSON.stringify(request) + '\n');
      } else {
        // HTTP transport — not implemented for stdio-style requests
        clearTimeout(timeout);
        this.pendingRequests.delete(String(id));
        reject(new Error(`Cannot send request to ${serverName}: no writable stdin`));
      }
    });
  }

  private sendNotification(serverName: string, method: string, params: unknown): void {
    const notification = {
      jsonrpc: '2.0',
      method,
      params,
    };
    const child = this.processes.get(serverName);
    if (child?.stdin?.writable) {
      child.stdin.write(JSON.stringify(notification) + '\n');
    }
  }

  private handleMessage(serverName: string, raw: string): void {
    let response: JsonRpcResponse;
    try {
      response = JSON.parse(raw) as JsonRpcResponse;
    } catch {
      this.log?.warn('MCP server sent invalid JSON', { server: serverName, line: raw.slice(0, 100) });
      return;
    }

    const pending = this.pendingRequests.get(String(response.id));
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(String(response.id));

    if (response.error) {
      pending.reject(new Error(response.error.message));
    } else {
      pending.resolve(response.result);
    }
  }

  private updateSessionState(name: string, state: MCPConnectionState, error?: string): void {
    const session = this.sessions.get(name);
    if (session) {
      session.state = state;
      if (error) session.error = error;
    }
  }
}
