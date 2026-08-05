/**
 * TypeScript LSP client (P3-4, audit Finding 5.23).
 *
 * A concrete `LspClient` implementation that spawns
 * `typescript-language-server` as a child process and communicates
 * via JSON-RPC 2.0 over stdio. This makes the 4 LSP tools
 * (`lsp_hover`, `lsp_goto_definition`, `lsp_references`,
 * `lsp_diagnostics`) functional — previously they always threw
 * "LSP client not configured" because the `LspClient` interface
 * had no concrete implementation.
 *
 * ## Why typescript-language-server?
 *
 * It's the de-facto standard TS/JS LSP server (used by VS Code,
 * Neovim, etc.), installable via `npm install -g typescript-language-server`.
 * It wraps `tsserver` and speaks the LSP protocol.
 *
 * ## Lifecycle
 *
 * - `start()` spawns the server and performs the LSP `initialize`
 *   handshake. Call this once at startup.
 * - `hover()` / `gotoDefinition()` / `references()` / `diagnostics()`
 *   send JSON-RPC requests and await responses.
 * - `stop()` sends `shutdown` + `exit` and kills the child process.
 *
 * ## Limitations
 *
 * - Only TypeScript/JavaScript files. For Python, a separate
 *   `PythonLspClient` (pyright/pylsp) would be needed — follow-up.
 * - The server must be on PATH (`typescript-language-server`). If
 *   not found, `start()` throws a clear error.
 * - Diagnostics are pulled via `textDocument/diagnostic` (LSP 3.17+).
 *   Older servers may not support this; we fall back to an empty
 *   array (no crash).
 * - File content is NOT synced via `textDocument/didOpen`/`didChange`
 *   in this minimal implementation — the server reads files from disk.
 *   This means unsaved buffer changes aren't visible to LSP. A
 *   follow-up would wire `didOpen`/`didChange` for live editing.
 *
 * @module tools/core/typescript-lsp-client
 */

import { spawn, type ChildProcess } from 'node:child_process';

import type {
  LspClient,
  LspLocation,
  LspHoverResult,
  LspDiagnostic,
  LspSeverity,
} from './lsp-types.js';

/** A pending JSON-RPC request awaiting a response. */
interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

/**
 * TypeScript LSP client — spawns `typescript-language-server` and
 * communicates via JSON-RPC 2.0 over stdio.
 */
export class TypeScriptLspClient implements LspClient {
  private child: ChildProcess | null = null;
  private readonly pending = new Map<string | number, PendingRequest>();
  private buffer = '';
  private initialized = false;
  private nextRequestId = 1;
  private readonly rootUri: string;
  /** Loosely-typed logger — accepts any object with info/warn/debug methods. */
  private readonly log?: { info: (msg: string, ctx?: Record<string, unknown>) => void; warn: (msg: string, ctx?: Record<string, unknown>) => void; debug: (msg: string, ctx?: Record<string, unknown>) => void };

  /**
   * @param opts - Configuration.
   * @param opts.rootUri - The workspace root URI (e.g. `file:///workspace`).
   * @param opts.logger - Optional logger.
   */
  constructor(opts: { rootUri: string; logger?: { info: (msg: string, ctx?: Record<string, unknown>) => void; warn: (msg: string, ctx?: Record<string, unknown>) => void; debug: (msg: string, ctx?: Record<string, unknown>) => void } }) {
    this.rootUri = opts.rootUri;
    this.log = opts.logger;
  }

  /**
   * Start the language server and perform the `initialize` handshake.
   *
   * Spawns `typescript-language-server --stdio`. If the binary is not
   * on PATH, throws an error with install instructions.
   */
  async start(): Promise<void> {
    if (this.child) return; // already started
    this.log?.info('Starting TypeScript language server', { rootUri: this.rootUri });
    try {
      this.child = spawn('typescript-language-server', ['--stdio'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      throw new Error(
        `Failed to spawn typescript-language-server. Install it with: npm install -g typescript-language-server typescript. Error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    // Wire stdout → JSON-RPC message parser.
    this.child.stdout?.setEncoding('utf-8');
    this.child.stdout?.on('data', (data: string) => {
      this.buffer += data;
      this.processBuffer();
    });
    this.child.stderr?.setEncoding('utf-8');
    this.child.stderr?.on('data', (data: string) => {
      this.log?.debug('LSP server stderr', { stderr: data.trim() });
    });
    this.child.on('exit', (code) => {
      this.log?.info('TypeScript language server exited', { code });
      this.child = null;
      this.initialized = false;
      // Reject all pending requests.
      for (const [, pending] of this.pending) {
        pending.reject(new Error('LSP server exited'));
        clearTimeout(pending.timeout);
      }
      this.pending.clear();
    });
    // Perform the initialize handshake.
    const initResult = await this.sendRequest('initialize', {
      processId: process.pid,
      rootUri: this.rootUri,
      capabilities: {},
    });
    void initResult; // we don't need the server capabilities for this minimal client
    // Send the initialized notification.
    this.sendNotification('initialized', {});
    this.initialized = true;
    this.log?.info('TypeScript language server initialized');
  }

  /**
   * Stop the language server gracefully.
   */
  async stop(): Promise<void> {
    if (!this.child) return;
    try {
      await this.sendRequest('shutdown', null);
    } catch {
      // Ignore — server may have already exited.
    }
    this.sendNotification('exit', null);
    this.child.kill('SIGTERM');
    this.child = null;
    this.initialized = false;
  }

  /** @inheritdoc */
  async hover(filePath: string, line: number, column: number): Promise<LspHoverResult | null> {
    if (!this.initialized) await this.start();
    const result = await this.sendRequest('textDocument/hover', {
      textDocument: { uri: this.pathToUri(filePath) },
      position: { line, character: column },
    });
    if (!result || typeof result !== 'object') return null;
    const hover = result as { contents?: unknown; range?: unknown };
    const contents = this.extractHoverContents(hover.contents);
    if (!contents) return null;
    return { contents };
  }

  /** @inheritdoc */
  async gotoDefinition(filePath: string, line: number, column: number): Promise<LspLocation[]> {
    if (!this.initialized) await this.start();
    const result = await this.sendRequest('textDocument/definition', {
      textDocument: { uri: this.pathToUri(filePath) },
      position: { line, character: column },
    });
    return this.extractLocations(result);
  }

  /** @inheritdoc */
  async references(filePath: string, line: number, column: number): Promise<LspLocation[]> {
    if (!this.initialized) await this.start();
    const result = await this.sendRequest('textDocument/references', {
      textDocument: { uri: this.pathToUri(filePath) },
      position: { line, character: column },
      context: { includeDeclaration: true },
    });
    return this.extractLocations(result);
  }

  /** @inheritdoc */
  async diagnostics(filePath: string): Promise<LspDiagnostic[]> {
    if (!this.initialized) await this.start();
    // textDocument/diagnostic is LSP 3.17+. Some servers may not support it.
    try {
      const result = await this.sendRequest('textDocument/diagnostic', {
        textDocument: { uri: this.pathToUri(filePath) },
      });
      if (!result || typeof result !== 'object') return [];
      const diagResult = result as { items?: unknown[]; kind?: string };
      if (!Array.isArray(diagResult.items)) return [];
      return diagResult.items.map((d) => this.extractDiagnostic(d));
    } catch {
      // Server doesn't support textDocument/diagnostic — return empty.
      return [];
    }
  }

  // ─── JSON-RPC plumbing ─────────────────────────────────────────

  /**
   * Send a JSON-RPC request and await the response.
   */
  private sendRequest(method: string, params: unknown): Promise<unknown> {
    if (!this.child?.stdin) {
      return Promise.reject(new Error('LSP server not started'));
    }
    const id = this.nextRequestId++;
    const request = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`LSP request '${method}' timed out after 30s`));
      }, 30_000);
      this.pending.set(id, { resolve, reject, timeout });
      const message = `Content-Length: ${Buffer.byteLength(JSON.stringify(request), 'utf-8')}\r\n\r\n${JSON.stringify(request)}`;
      this.child!.stdin!.write(message);
    });
  }

  /**
   * Send a JSON-RPC notification (no response expected).
   */
  private sendNotification(method: string, params: unknown): void {
    if (!this.child?.stdin) return;
    const notification = {
      jsonrpc: '2.0',
      method,
      params,
    };
    const message = `Content-Length: ${Buffer.byteLength(JSON.stringify(notification), 'utf-8')}\r\n\r\n${JSON.stringify(notification)}`;
    this.child.stdin.write(message);
  }

  /**
   * Process the stdout buffer, extracting complete JSON-RPC messages
   * (framed with `Content-Length` headers per LSP spec).
   */
  private processBuffer(): void {
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return; // incomplete header
      const header = this.buffer.slice(0, headerEnd);
      const contentLengthMatch = /Content-Length:\s*(\d+)/i.exec(header);
      if (!contentLengthMatch) {
        // Malformed header — drop everything up to and including the header end.
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }
      const contentLength = parseInt(contentLengthMatch[1]!, 10);
      const contentStart = headerEnd + 4;
      if (this.buffer.length < contentStart + contentLength) {
        return; // incomplete body — wait for more data
      }
      const body = this.buffer.slice(contentStart, contentStart + contentLength);
      this.buffer = this.buffer.slice(contentStart + contentLength);
      try {
        const message = JSON.parse(body);
        this.handleMessage(message);
      } catch (err) {
        this.log?.warn('Failed to parse LSP message', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  /**
   * Handle a parsed JSON-RPC message (response or notification).
   */
  private handleMessage(message: { id?: string | number; method?: string; result?: unknown; error?: unknown; params?: unknown }): void {
    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      // It's a response to a request we sent.
      const pending = this.pending.get(message.id);
      if (!pending) return; // unknown request — ignore
      this.pending.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.error) {
        pending.reject(new Error(`LSP error: ${JSON.stringify(message.error)}`));
      } else {
        pending.resolve(message.result);
      }
    } else if (message.method) {
      // It's a notification from the server (e.g. textDocument/publishDiagnostics).
      // We don't handle these in this minimal client — diagnostics are pulled
      // via textDocument/diagnostic, not pushed.
    }
  }

  // ─── LSP type extraction helpers ───────────────────────────────

  private extractHoverContents(contents: unknown): string | null {
    if (typeof contents === 'string') return contents;
    if (Array.isArray(contents)) {
      return contents.map((c) => (typeof c === 'string' ? c : (c as { value?: string })?.value ?? '')).join('\n');
    }
    if (contents && typeof contents === 'object') {
      const obj = contents as { value?: string; kind?: string };
      return obj.value ?? null;
    }
    return null;
  }

  private extractLocations(result: unknown): LspLocation[] {
    if (!result) return [];
    if (Array.isArray(result)) {
      return result.map((l) => this.extractLocation(l)).filter((l): l is LspLocation => l !== null);
    }
    const single = this.extractLocation(result);
    return single ? [single] : [];
  }

  private extractLocation(loc: unknown): LspLocation | null {
    if (!loc || typeof loc !== 'object') return null;
    const obj = loc as { uri?: string; range?: { start?: { line?: number; character?: number }; end?: { line?: number; character?: number } } };
    if (!obj.uri || !obj.range?.start) return null;
    return {
      filePath: this.uriToPath(obj.uri),
      line: obj.range.start.line ?? 0,
      column: obj.range.start.character ?? 0,
      endLine: obj.range.end?.line,
      endColumn: obj.range.end?.character,
    };
  }

  private extractDiagnostic(d: unknown): LspDiagnostic {
    const obj = (d ?? {}) as {
      range?: { start?: { line?: number; character?: number }; end?: { line?: number; character?: number } };
      severity?: number;
      message?: string;
      source?: string;
      code?: string | number;
    };
    const severityMap: Record<number, LspSeverity> = {
      1: 'error',
      2: 'warning',
      3: 'info',
      4: 'hint',
    };
    return {
      line: obj.range?.start?.line ?? 0,
      column: obj.range?.start?.character ?? 0,
      endLine: obj.range?.end?.line,
      endColumn: obj.range?.end?.character,
      severity: severityMap[obj.severity ?? 1] ?? 'error',
      message: obj.message ?? '(no message)',
      source: obj.source,
      code: obj.code !== undefined ? String(obj.code) : undefined,
    };
  }

  private pathToUri(filePath: string): string {
    // Convert a filesystem path to a file:// URI. On Windows, the path
    // starts with a drive letter (e.g. C:\) and needs an extra slash.
    const normalized = filePath.replace(/\\/g, '/');
    return normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`;
  }

  private uriToPath(uri: string): string {
    if (uri.startsWith('file:///')) {
      // On Unix: file:///path → /path. On Windows: file:///C:/path → C:/path.
      return decodeURIComponent(uri.slice('file://'.length));
    }
    return uri;
  }
}
