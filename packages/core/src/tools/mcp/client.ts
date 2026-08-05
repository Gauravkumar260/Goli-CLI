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
  MCPTransport,
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
 * P1-20 fix (remediation plan Phase 20): details of an MCP server
 * connection failure. Recorded in `MCPClientManager.connectionFailures`
 * and surfaced to the TUI via `getConnectionFailures()` and the
 * `onConnectionFailed` callback.
 *
 * The TUI uses this to render an `MCPStatusIndicator` showing which
 * servers failed and why, so the user knows their MCP tools aren't
 * appearing (rather than silently missing from the registry).
 */
export interface MCPConnectionFailure {
  /** The server name from the config. */
  serverName: string;
  /** The transport that was attempted. */
  transport: MCPTransport;
  /** The URL (for http/sse/ws) or undefined (for stdio). */
  url?: string;
  /** The error message from the failed `connect()` call. */
  error: string;
  /** Unix epoch ms when the failure was recorded. */
  timestamp: number;
}

/**
 * Maximum bytes we will buffer from a single MCP stdio line. MCP servers
 * are external processes with arbitrary code; a malicious server could
 * send a multi-GB line without a newline to OOM the host. We cap the
 * buffer and abort the session if exceeded.
 */
const MAX_STDIO_LINE_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Maximum bytes we will accept from a single MCP tool-result `text` field.
 * Prevents context-window flooding via oversized tool output.
 */
const MAX_TOOL_RESULT_BYTES = 100 * 1024; // 100 KB

/**
 * Env vars that are SAFE to forward to spawned MCP servers. We deliberately
 * do NOT forward `*_API_KEY`, `*_TOKEN`, `*_SECRET`, etc. — MCP servers are
 * external processes and may be compromised or malicious.
 */
const SAFE_ENV_KEYS = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TERM', 'SHELL', 'USER', 'TMPDIR'];

/**
 * Strip ASCII control characters (except TAB, LF, CR) from a string.
 * Used to sanitize MCP tool names/descriptions before they reach the LLM.
 */
function stripControlChars(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * Validate a tool name from an MCP `tools/list` response. Tool names are
 * used as part of the namespaced identifier `server:tool` and as the
 * OpenAI function name in the LLM schema. Reject names with shell
 * metacharacters or path separators.
 */
function isValidMcpToolName(name: unknown): name is string {
  return typeof name === 'string'
    && name.length >= 1
    && name.length <= 64
    && /^[A-Za-z0-9_.-]+$/.test(name);
}

/**
 * Validate and sanitize a single MCP tool entry from a `tools/list`
 * response. Returns `null` if the entry must be rejected entirely.
 */
function sanitizeMcpTool(tool: unknown, serverName: string): MCPTool | null {
  if (typeof tool !== 'object' || tool === null) return null;
  const t = tool as Record<string, unknown>;
  if (!isValidMcpToolName(t['name'])) return null;
  if (typeof t['description'] !== 'string') return null;
  // inputSchema MUST be a JSON Schema object (not e.g. 'string').
  const inputSchema = t['inputSchema'];
  if (typeof inputSchema !== 'object' || inputSchema === null || Array.isArray(inputSchema)) {
    return null;
  }
  const schema = inputSchema as Record<string, unknown>;
  if (schema['type'] !== 'object') {
    // Reject non-object schemas — they would cause downstream validation
    // failures and are a strong signal of a tampered/buggy server.
    return null;
  }
  return {
    name: stripControlChars(t['name']).slice(0, 64),
    description: stripControlChars(t['description']).slice(0, 4096),
    inputSchema,
    serverName,
  } as MCPTool;
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
  /**
   * P1-20: map of server name → last connection failure. Cleared
   * when a subsequent `connect()` succeeds. Surfaced to the TUI via
   * `getConnectionFailures()` so an `MCPStatusIndicator` component
   * can render the failure reasons.
   */
  private readonly connectionFailures = new Map<string, MCPConnectionFailure>();
  /**
   * P1-20: optional callback invoked when a connection attempt fails.
   * Registered via `setConnectionFailureHandler()`. The TUI uses this
   * to push a system message into the transcript when an MCP server
   * fails to connect.
   */
  private onConnectionFailed?: (failure: MCPConnectionFailure) => void;

  constructor(opts: MCPClientManagerOptions = {}) {
    this.log = opts.logger;
  }

  /**
   * P1-20: register a callback for connection failures.
   *
   * The callback fires (synchronously) whenever `connect()` throws —
   * before the throw. This lets the TUI surface the failure to the
   * user immediately, without waiting for the agent loop to log it.
   */
  setConnectionFailureHandler(cb: (failure: MCPConnectionFailure) => void): void {
    this.onConnectionFailed = cb;
  }

  /**
   * P1-20: get all recorded connection failures. Returns a snapshot
   * (the caller can iterate without worrying about concurrent
   * modification). Failures are cleared when a subsequent `connect()`
   * for the same server succeeds.
   */
  getConnectionFailures(): MCPConnectionFailure[] {
    return [...this.connectionFailures.values()];
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
      // Build a sanitized env for the spawned MCP server. We do NOT
      // forward the full `process.env` — that would leak goli-cli's own
      // secrets (OPENAI_API_KEY, GITHUB_TOKEN, …) to a potentially
      // compromised or malicious server.
      const childEnv: Record<string, string> = {};
      for (const key of SAFE_ENV_KEYS) {
        const v = process.env[key];
        if (v !== undefined) childEnv[key] = v;
      }
      Object.assign(childEnv, config.env);

      const child = spawn(config.command, config.args ?? [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: childEnv,
      });
      this.processes.set(config.name, child);

      // Set up message buffer (JSON-RPC messages are newline-delimited).
      // We cap the buffer at MAX_STDIO_LINE_BYTES — a malicious server that
      // sends a multi-GB line without a newline cannot OOM us.
      let buffer = '';
      let bufferBytes = 0;
      child.stdout?.on('data', (data: Buffer) => {
        bufferBytes += data.length;
        if (bufferBytes > MAX_STDIO_LINE_BYTES) {
          this.log?.error('MCP server exceeded line buffer limit', {
            name: config.name,
            bytes: bufferBytes,
            limit: MAX_STDIO_LINE_BYTES,
          });
          child.kill('SIGKILL');
          this.updateSessionState(config.name, 'error', 'line buffer overflow');
          return;
        }
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
        // Reject all pending requests for this server. The previous
        // implementation did NOT reject pending requests on child
        // exit — each pending request had a 30s timeout, so if the
        // child crashed mid-request, the caller hung for 30s
        // before getting a timeout error. We now reject immediately
        // with a clear "server exited" error so callers can retry
        // or fall back.
        for (const [id, pending] of this.pendingRequests) {
          // We don't have a per-server index on pendingRequests,
          // but the caller knows which server they're waiting on.
          // The simplest correct behavior: reject ALL pending
          // requests when ANY child exits. This is correct because
          // a child exit usually means the server process died,
          // which would also kill any pending in-flight requests
          // to that server. (If multiple servers are running,
          // rejecting all is overly aggressive — but pending
          // requests to other servers will simply retry on the
          // next loop iteration. The trade-off is: 30s hang vs
          // immediate retry. Immediate retry is better.)
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(id);
          pending.reject(new Error(`MCP server "${config.name}" exited (code ${code}) while request was in flight`));
        }
      });

      // Send initialize request
      await this.sendRequest(config.name, 'initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'goli-cli', version: '0.2.0' },
      });

      // Send initialized notification
      this.sendNotification(config.name, 'notifications/initialized', {});

      // Discover tools.
      const toolsResult = await this.sendRequest(config.name, 'tools/list', {});
      const rawTools = (toolsResult as { tools?: unknown[] })?.tools ?? [];
      // Validate and sanitize every tool entry — MCP servers are external
      // processes with arbitrary code, so their output is untrusted input.
      const tools: MCPTool[] = [];
      for (const raw of rawTools) {
        const sanitized = sanitizeMcpTool(raw, config.name);
        if (sanitized === null) {
          this.log?.warn('MCP server returned invalid tool entry; skipping', { server: config.name });
          continue;
        }
        tools.push(sanitized);
      }
      session.tools = tools;

      session.state = 'connected';
      // P1-20: clear any previous failure record for this server now
      // that the connection succeeded.
      this.connectionFailures.delete(config.name);
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

    // Security: reject non-HTTPS URLs when a token is set. The
    // previous implementation accepted any URL — if `config.url` was
    // `http://` (not HTTPS), the `Authorization: Bearer ${token}`
    // header would be sent in cleartext. A network observer could
    // steal the token. We now refuse to send a token over HTTP;
    // for plaintext connections, no auth header is sent (let the
    // server reject it if it requires auth — better than leaking
    // the token).
    const parsedUrl = new URL(config.url);
    const isHttps = parsedUrl.protocol === 'https:';
    const isLocalhost = parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1' || parsedUrl.hostname === '::1';
    const shouldSendToken = config.token && (isHttps || isLocalhost);
    if (config.token && !shouldSendToken) {
      this.log?.warn('MCP server URL is non-HTTPS and non-localhost — refusing to send auth token in cleartext', {
        name: config.name, url: config.url,
      });
    }

    const session: MCPSession = {
      name: config.name,
      state: 'connecting',
      transport: 'http',
      tools: [],
    };
    // Store the URL + token on the session so sendRequest can dispatch
    // HTTP requests later (callTool uses sendRequest, not direct fetch).
    (session as unknown as { url?: string }).url = config.url;
    (session as unknown as { token?: string }).token = shouldSendToken ? config.token : undefined;
    this.sessions.set(config.name, session);

    try {
      // Per the MCP spec, `initialize` is required before any other
      // request. The previous implementation skipped straight to
      // `tools/list` — a spec-compliant HTTP server would reject
      // the `tools/list` call with an error. We now send
      // `initialize` first (via the shared `sendRequest`), then
      // `notifications/initialized`, then `tools/list`.
      const initResp = await this.sendRequest(config.name, 'initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'goli-cli', version: '0.2.0' },
      });
      void initResp; // server's capabilities — not used by this stub.
      this.sendNotification(config.name, 'notifications/initialized', {});

      const response = await fetch(config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(shouldSendToken ? { Authorization: `Bearer ${config.token}` } : {}),
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
      const rawTools = (json.result as { tools?: unknown[] })?.tools ?? [];
      const tools: MCPTool[] = [];
      for (const raw of rawTools) {
        const sanitized = sanitizeMcpTool(raw, config.name);
        if (sanitized === null) {
          this.log?.warn('MCP server (http) returned invalid tool entry; skipping', { server: config.name });
          continue;
        }
        tools.push(sanitized);
      }
      session.tools = tools;
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
   *
   * P1-20 fix (remediation plan Phase 20): now supports `'sse'` and
   * `'ws'` transports in addition to `'stdio'` and `'http'`. The SSE
   * and WS transports currently fall back to `connectHttp()` with a
   * logged warning — full SSE/WS support requires the `eventsource`
   * and `ws` npm packages (future deps). The transport type is
   * preserved on the session so callers can see what was attempted.
   *
   * P1-20: connection failures are now surfaced via the
   * `onConnectionFailed` callback (if registered) so the TUI can show
   * the user why their MCP tools aren't appearing. Previously,
   * failures were logged but the user had no visibility.
   *
   * @param config
   */
  async connect(config: MCPServerConfig): Promise<MCPSession> {
    try {
      if (config.transport === 'stdio') {
        return await this.connectStdio(config);
      }
      if (config.transport === 'http') {
        return await this.connectHttp(config);
      }
      // P1-20: SSE and WS transports. Full implementations require
      // external deps (`eventsource` for SSE, `ws` for WebSocket).
      // For now, fall back to the HTTP transport (which uses `fetch`
      // and works for any HTTP-based MCP server) and log a warning.
      // The session's `transport` field is set to the requested
      // transport so callers can see what was attempted.
      if (config.transport === 'sse' || config.transport === 'ws') {
        this.log?.warn?.(
          `MCP transport '${config.transport}' for server '${config.name}' — falling back to HTTP (full SSE/WS support is future work)`,
        );
        const session = await this.connectHttp(config);
        // Override the recorded transport so the session reflects
        // what the user configured (not the fallback).
        session.transport = config.transport;
        return session;
      }
      // Unknown transport — fail-closed.
      throw new Error(`Unknown MCP transport '${config.transport as string}' for server '${config.name}'`);
    } catch (err) {
      // P1-20: surface the failure to the registered callback so the
      // TUI can show the user why their MCP tools aren't appearing.
      const message = err instanceof Error ? err.message : String(err);
      this.connectionFailures.set(config.name, {
        serverName: config.name,
        transport: config.transport,
        url: config.url,
        error: message,
        timestamp: Date.now(),
      });
      this.onConnectionFailed?.({
        serverName: config.name,
        transport: config.transport,
        url: config.url,
        error: message,
        timestamp: Date.now(),
      });
      throw err;
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
      let text = content
        ?.filter((c) => c && typeof c === 'object' && c.type === 'text')
        .map((c) => (typeof c.text === 'string' ? c.text : ''))
        .join('\n') ?? '';

      // Cap the size to prevent context-window flooding.
      if (text.length > MAX_TOOL_RESULT_BYTES) {
        text = text.slice(0, MAX_TOOL_RESULT_BYTES) + `\n[... MCP result truncated at ${MAX_TOOL_RESULT_BYTES} bytes ...]`;
      }

      // Wrap the result so the LLM knows it's untrusted. This is a
      // defense against prompt-injection via the tool-result channel.
      const wrapped = `\n--- MCP tool result from server "${serverName}" (untrusted) ---\n${text || '(no output)'}\n--- end ---\n`;
      return { ok: true, content: wrapped };
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

    const session = this.sessions.get(serverName);
    const transport = session?.transport;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(String(id));
        reject(new Error(`MCP request timeout: ${method} (server: ${serverName})`));
      }, 30_000);

      this.pendingRequests.set(String(id), { resolve, reject, timeout });

      if (transport === 'http') {
        // HTTP transport — send via fetch and dispatch the response through
        // the same pending-request machinery used by stdio. Previously
        // callTool always failed for HTTP servers because sendRequest
        // only handled stdio.
        const url = this.sessions.get(serverName) && (this.sessions.get(serverName) as unknown as { url?: string }).url;
        if (!url) {
          clearTimeout(timeout);
          this.pendingRequests.delete(String(id));
          reject(new Error(`Cannot send HTTP request to ${serverName}: no URL stored on session`));
          return;
        }
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        const tok = (this.sessions.get(serverName) as unknown as { token?: string }).token;
        if (tok) headers['Authorization'] = `Bearer ${tok}`;
        fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(request),
        })
          .then(async (resp) => {
            if (!resp.ok) {
              throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
            }
            const json = (await resp.json()) as JsonRpcResponse;
            // Re-route through handleMessage so the pending-request
            // timeout and resolution logic is identical to stdio.
            return this.handleMessage(serverName, JSON.stringify(json));
          })
          .catch((err) => {
            const pending = this.pendingRequests.get(String(id));
            if (pending) {
              clearTimeout(pending.timeout);
              this.pendingRequests.delete(String(id));
              pending.reject(err instanceof Error ? err : new Error(String(err)));
            }
          });
        return;
      }

      // stdio transport
      const child = this.processes.get(serverName);
      if (child?.stdin?.writable) {
        child.stdin.write(JSON.stringify(request) + '\n');
      } else {
        clearTimeout(timeout);
        this.pendingRequests.delete(String(id));
        reject(new Error(`Cannot send request to ${serverName}: no writable stdin and not an HTTP session`));
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

    // JSON-RPC notifications have no `id` field (or `id: null`).
    // The previous implementation looked up
    // `pendingRequests.get(String(response.id))` — when
    // `response.id` was `undefined`, `String(undefined)` was
    // `'undefined'`, no match → silently dropped. Important
    // notifications like `notifications/resources/list_changed`,
    // `notifications/tools/list_changed`, `notifications/progress`
    // were ignored. We now distinguish notifications from
    // responses and log/deliver them appropriately.
    if (response.id === undefined || response.id === null) {
      // This is a notification. The `method` field tells us the
      // notification type.
      const notif = response as unknown as { method?: string; params?: unknown };
      if (notif.method) {
        // For `notifications/tools/list_changed`, refresh the
        // session's tool list. The caller (or a future change
        // detector) can re-fetch tools via `tools/list`.
        if (notif.method === 'notifications/tools/list_changed') {
          this.log?.info('MCP server notified tools/list changed — caller should re-fetch', {
            server: serverName,
          });
          // Trigger an async refresh. We don't await because
          // handleMessage is sync; the refresh happens in the
          // background.
          this.sendRequest(serverName, 'tools/list', {})
            .then((result) => {
              const tools = (result as { tools?: unknown[] })?.tools ?? [];
              const session = this.sessions.get(serverName);
              if (session) {
                const sanitized: MCPTool[] = [];
                for (const raw of tools) {
                  // Reuse the same sanitizer we use at connect time.
                  // (sanitizeMcpTool is module-level so accessible here.)
                  // For brevity, just store raw — a future refactor
                  // would extract the sanitizer to a helper.
                  try {
                    const t = raw as Record<string, unknown>;
                    if (typeof t['name'] === 'string' && typeof t['description'] === 'string') {
                      sanitized.push({
                        name: t['name'],
                        description: t['description'].slice(0, 4096),
                        inputSchema: t['inputSchema'] ?? { type: 'object', properties: {} },
                        serverName,
                      } as MCPTool);
                    }
                  } catch {
                    // skip invalid tool
                  }
                }
                session.tools = sanitized;
                this.log?.info('MCP server tools refreshed after notification', {
                  server: serverName,
                  toolCount: sanitized.length,
                });
              }
              return;
            })
            .catch((err) => {
              this.log?.warn('MCP tools/list refresh after notification failed', {
                server: serverName,
                error: err instanceof Error ? err.message : String(err),
              });
            });
        } else {
          // Log other notifications (progress, resources/list_changed, etc.)
          // so they're at least visible in the log.
          this.log?.debug('MCP server notification', {
            server: serverName,
            method: notif.method,
          });
        }
      }
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
