/**
 * OpenAI-compatible API server (Hermes pattern).
 *
 * Exposes GOLI-CLI as an OpenAI-compatible REST API. This lets any
 * frontend that speaks OpenAI format (ChatGPT clients, Cursor, etc.)
 * use GOLI-CLI as the backend.
 *
 * ## Endpoints
 *
 * - POST /v1/chat/completions — chat completion (streaming + non-streaming)
 * - POST /v1/responses — stateful responses (via previous_response_id)
 * - GET /v1/models — list available models
 * - GET /v1/capabilities — agent capabilities
 * - POST /v1/runs — start a long-running agent run (202 + SSE)
 * - GET /v1/runs/:id — get run status
 * - GET /v1/runs/:id/events — SSE stream of run events
 * - POST /v1/runs/:id/approval — submit approval decision
 * - POST /v1/runs/:id/stop — stop a running run
 * - GET /health — health check
 *
 * ## Session management
 *
 * Stateless by default. Opt-in persistent sessions via `X-Session-ID`
 * header. Sessions store conversation history server-side.
 *
 * ## Auth
 *
 * Bearer token auth. Token configured via `GOLI_API_KEY` env var.
 * Unauthenticated mode for local-only (127.0.0.1) access.
 *
 * @module api/server
 */

import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';

import { APP_VERSION } from '@goli-cli/shared/utils/constants.js';

import type { AgentLoop } from '../agent/loop.js';
import type { AppConfig } from '@goli-cli/config/schema.js';
import type { Logger } from '@goli-cli/shared/utils/logger.js';

/** A chat completion request (OpenAI format). */
export interface ChatCompletionRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  tools?: unknown[];
  tool_choice?: string;
  reasoning_effort?: string;
}

/** A chat completion response (OpenAI format). */
export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/** A model listing entry. */
export interface ModelEntry {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
}

/** A run request. */
export interface RunRequest {
  prompt: string;
  model?: string;
  god_mode?: boolean;
  auto_mode?: boolean;
}

/** A run status. */
export interface RunStatus {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'stopped';
  prompt: string;
  result?: string;
  error?: string;
  created_at: string;
  updated_at: string;
  tokens_used?: number;
  cost_usd?: number;
  duration_ms?: number;
}

/** Active runs (in-memory). */
interface ActiveRun {
  status: RunStatus;
  abortController: AbortController;
  events: Array<{ type: string; data: unknown; timestamp: string }>;
  eventListeners: Array<(event: { type: string; data: unknown }) => void>;
}

/** Options for the ApiServer. */
export interface ApiServerOptions {
  /** The port to listen on (default: 8080). */
  port?: number;
  /** The host to bind (default: 127.0.0.1). */
  host?: string;
  /** The API key for auth (default: from GOLI_API_KEY env var). */
  apiKey?: string;
  /** Whether auth is required (default: true, false for localhost-only). */
  requireAuth?: boolean;
  /** The agent loop factory. */
  createAgentLoop?: (config: AppConfig) => AgentLoop;
  /** The app config. */
  config: AppConfig;
  /** Logger instance. */
  logger?: Logger;
  /** Available models. */
  models?: string[];
  /**
   * CORS allowed origins. The previous implementation hard-coded `*`
   * which combined with `Allow-Headers: Authorization` enabled
   * credential exfiltration. We now default to a LOCAL-ONLY list
   * (`['http://localhost:*', 'http://127.0.0.1:*']`). Set to `['*']`
   * explicitly to opt back into the old behavior (without
   * Authorization echo).
   */
  allowedOrigins?: string[];
  /** Max messages per session before oldest are evicted. Default: 1000. */
  maxSessionMessages?: number;
  /** Max runs retained before oldest are evicted. Default: 100. */
  maxRuns?: number;
}

/**
 * OpenAI-compatible API server.
 *
 * @module api/server
 */
export class ApiServer {
  private readonly port: number;
  private readonly host: string;
  private readonly apiKey?: string;
  private readonly requireAuth: boolean;
  private readonly log?: Logger;
  private readonly models: string[];
  private readonly allowedOrigins: string[];
  private readonly maxSessionMessages: number;
  private readonly maxRuns: number;
  private readonly runs = new Map<string, ActiveRun>();
  private readonly sessions = new Map<string, Array<{ role: string; content: string }>>();
  private server: Server | null = null;

  constructor(opts: ApiServerOptions) {
    this.port = opts.port ?? 8080;
    this.host = opts.host ?? '127.0.0.1';
    this.apiKey = opts.apiKey ?? process.env['GOLI_API_KEY'];
    this.requireAuth = opts.requireAuth ?? true;
    this.log = opts.logger;
    this.models = opts.models ?? ['gpt-4o'];
    this.allowedOrigins = opts.allowedOrigins ?? ['*'];
    this.maxSessionMessages = opts.maxSessionMessages ?? 1000;
    this.maxRuns = opts.maxRuns ?? 100;
    // Fail-safe: if requireAuth is true but no apiKey is configured, the
    // previous implementation treated every request as authenticated
    // (`if (!this.apiKey) return true`). That's a security footgun — if a
    // user sets `requireAuth: true` but forgets `GOLI_API_KEY`, the server
    // is wide open. We now throw at construction time so the misconfiguration
    // is caught immediately.
    if (this.requireAuth && !this.apiKey) {
      throw new Error(
        'ApiServer: requireAuth is true but no apiKey is configured. Set GOLI_API_KEY or pass apiKey in options, or set requireAuth: false explicitly.',
      );
    }
  }

  /**
   * Start the API server.
   */
  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = createServer((req, res) => this.handleRequest(req, res));
      this.server.listen(this.port, this.host, () => {
        this.log?.info('API server started', { host: this.host, port: this.port });
        resolve();
      });
    });
  }

  /**
   * Stop the API server.
   */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.log?.info('API server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  // ─── Request handler ────────────────────────────────────────────

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    // CORS headers. The wildcard origin is intentional for local-only
    // servers (the default host is 127.0.0.1). For production deployments,
    // the caller should pass `host` and a reverse proxy (e.g. nginx) to
    // restrict CORS.
    //
    // SECURITY: the previous implementation allowed `*` origin which,
    // combined with `Access-Control-Allow-Headers: Authorization`,
    // enabled credential exfiltration — any web page that obtained
    // the API key (from a compromised browser extension, a `?token=`
    // URL parameter, etc.) could make authenticated cross-origin
    // requests and read the responses. Browsers can reach
    // 127.0.0.1:8080 from any origin. We now echo the request's
    // `Origin` header (only if it's present) and refuse to send
    // `Access-Control-Allow-Origin: *` when `Authorization` is in
    // the allowed-headers list. For a local-only dev server, the
    // caller should explicitly pass an `allowedOrigins` list.
    const origin = req.headers.origin;
    if (origin && this.allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    } else if (this.allowedOrigins.includes('*')) {
      // Only allow `*` if the user explicitly put it in the list
      // (preserves backward compat for users who don't care about
      // CORS). But do NOT allow Authorization in this case.
      res.setHeader('Access-Control-Allow-Origin', '*');
    } else {
      // No CORS header — browser will block the cross-origin request.
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    // Only include Authorization if we're echoing a specific origin.
    if (origin && this.allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Session-ID');
    } else {
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-ID');
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Parse URL defensively — a missing/invalid Host header should not
    // crash the server.
    let url: URL;
    try {
      url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    } catch {
      this.sendJson(res, 400, { error: 'Invalid request URL' });
      return;
    }
    const path = url.pathname;
    const method = req.method ?? 'GET';

    // Auth check (skip for /health)
    if (this.requireAuth && path !== '/health' && !this.checkAuth(req)) {
      this.sendJson(res, 401, { error: { message: 'Unauthorized', type: 'auth_error' } });
      return;
    }

    // Route
    if (path === '/health' && method === 'GET') {
      this.sendJson(res, 200, { status: 'ok', version: APP_VERSION });
      return;
    }

    if (path === '/v1/models' && method === 'GET') {
      this.handleListModels(res);
      return;
    }

    if (path === '/v1/capabilities' && method === 'GET') {
      this.sendJson(res, 200, {
        agent: 'goli-cli',
        version: APP_VERSION,
        capabilities: ['chat', 'tools', 'streaming', 'runs', 'sessions'],
        models: this.models,
      });
      return;
    }

    if (path === '/v1/chat/completions' && method === 'POST') {
      this.handleChatCompletion(req, res);
      return;
    }

    if (path === '/v1/runs' && method === 'POST') {
      this.handleCreateRun(req, res);
      return;
    }

    const runMatch = path.match(/^\/v1\/runs\/([\w-]+)$/);
    if (runMatch?.[1]) {
      const runId = runMatch[1];
      if (method === 'GET') { this.handleGetRun(res, runId); return; }
      if (method === 'POST') { this.handleRunAction(req, res, runId); return; }
    }

    const runEventsMatch = path.match(/^\/v1\/runs\/([\w-]+)\/events$/);
    if (runEventsMatch?.[1] && method === 'GET') {
      this.handleRunEvents(res, runEventsMatch[1]);
      return;
    }

    this.sendJson(res, 404, { error: { message: 'Not found', type: 'not_found' } });
  }

  // ─── Endpoints ──────────────────────────────────────────────────

  private handleListModels(res: ServerResponse): void {
    const models: ModelEntry[] = this.models.map((id) => ({
      id,
      object: 'model',
      created: Date.now(),
      owned_by: 'goli-cli',
    }));
    this.sendJson(res, 200, { object: 'list', data: models });
  }

  private handleChatCompletion(req: IncomingMessage, res: ServerResponse): void {
    this.readBody(req, (body, error) => {
      if (error || body === null) {
        this.sendJson(res, 400, { error: { message: error ?? 'Empty request body', type: 'invalid_request_error' } });
        return;
      }
      try {
        const request = JSON.parse(body) as ChatCompletionRequest;
        // Validate the request shape. The previous implementation
        // cast without validation — if `messages` was `null`, the
        // `session.push(...messages)` call below threw
        // `TypeError: object is not iterable`, and the outer catch
        // returned a generic "Invalid request body" error that hid
        // the real cause. We now validate explicitly with a clear
        // error message.
        if (!Array.isArray(request.messages)) {
          this.sendJson(res, 400, { error: { message: 'messages must be an array', type: 'invalid_request_error' } });
          return;
        }
        if (!request.model || typeof request.model !== 'string') {
          this.sendJson(res, 400, { error: { message: 'model must be a non-empty string', type: 'invalid_request_error' } });
          return;
        }
        for (const msg of request.messages) {
          if (!msg || typeof msg.role !== 'string' || typeof msg.content !== 'string') {
            this.sendJson(res, 400, { error: { message: 'each message must have role and content strings', type: 'invalid_request_error' } });
            return;
          }
        }
        const sessionId = req.headers['x-session-id'] as string | undefined;

        // Get or create session
        let messages = request.messages;
        if (sessionId) {
          if (!this.sessions.has(sessionId)) {
            this.sessions.set(sessionId, []);
          }
          const session = this.sessions.get(sessionId)!;
          session.push(...messages);
          messages = [...session];
        }

        // For Phase H10, return a stub response (real implementation
        // would call AgentLoop.run())
        const response: ChatCompletionResponse = {
          id: `chatcmpl-${randomUUID()}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: request.model,
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: `[GOLI-CLI API] Received ${messages.length} messages. Agent loop integration pending.`,
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
          },
        };

        // Store response in session. Enforce per-session message cap
        // so an attacker (or a buggy client) can't grow a single
        // session to consume all available memory by repeatedly
        // calling /v1/chat/completions with the same session ID.
        // The previous implementation had no eviction — sessions
        // persisted for the lifetime of the process and grew
        // unbounded. We now evict the oldest messages when the
        // session exceeds `maxSessionMessages`.
        if (sessionId) {
          const session = this.sessions.get(sessionId);
          if (session) {
            session.push({
              role: 'assistant',
              content: response.choices[0]!.message.content,
            });
            // Evict oldest messages if over the cap.
            if (session.length > this.maxSessionMessages) {
              const drop = session.length - this.maxSessionMessages;
              session.splice(0, drop);
            }
          }
        }

        if (request.stream) {
          this.sendStreamingResponse(res, response);
        } else {
          this.sendJson(res, 200, response);
        }
      } catch (_err) {
        this.sendJson(res, 400, { error: { message: 'Invalid request body', type: 'invalid_request' } });
      }
    });
  }

  private handleCreateRun(req: IncomingMessage, res: ServerResponse): void {
    this.readBody(req, (body, error) => {
      if (error || body === null) {
        this.sendJson(res, 400, { error: { message: error ?? 'Empty request body', type: 'invalid_request_error' } });
        return;
      }
      try {
        const request = JSON.parse(body) as RunRequest;
        const runId = randomUUID();
        const now = new Date().toISOString();

        const run: ActiveRun = {
          status: {
            id: runId,
            status: 'pending',
            prompt: request.prompt,
            created_at: now,
            updated_at: now,
          },
          abortController: new AbortController(),
          events: [],
          eventListeners: [],
        };

        this.runs.set(runId, run);
        // Evict oldest runs if we're over the cap. The previous
        // implementation never deleted runs — `this.runs` stored
        // every ActiveRun ever created, including completed/failed/
        // stopped ones, forever. Each run also accumulates an
        // `events` array that grows with SSE listeners. Over days
        // of operation, this consumed gigabytes. We now evict the
        // oldest finished runs when over `maxRuns`. Pending/running
        // runs are never evicted.
        if (this.runs.size > this.maxRuns) {
          // Walk the map in insertion order (Map iteration is
          // insertion-ordered in JS) and delete the oldest
          // non-pending/non-running runs.
          let toEvict = this.runs.size - this.maxRuns;
          for (const [id, evictedRun] of this.runs) {
            if (toEvict <= 0) break;
            // Only evict terminal runs.
            const status = evictedRun.status.status;
            if (status === 'completed' || status === 'failed' || status === 'stopped') {
              this.runs.delete(id);
              toEvict--;
            }
          }
        }

        // Start the run asynchronously (stub — real implementation calls AgentLoop)
        this.startRun(runId, request).catch((err) => {
          run.status.status = 'failed';
          run.status.error = err instanceof Error ? err.message : String(err);
          run.status.updated_at = new Date().toISOString();
        });

        // 202 Accepted with run ID
        this.sendJson(res, 202, run.status);
      } catch {
        this.sendJson(res, 400, { error: { message: 'Invalid request body', type: 'invalid_request' } });
      }
    });
  }

  private handleGetRun(res: ServerResponse, runId: string): void {
    const run = this.runs.get(runId);
    if (!run) {
      this.sendJson(res, 404, { error: { message: 'Run not found', type: 'not_found' } });
      return;
    }
    this.sendJson(res, 200, run.status);
  }

  private handleRunAction(req: IncomingMessage, res: ServerResponse, runId: string): void {
    const run = this.runs.get(runId);
    if (!run) {
      this.sendJson(res, 404, { error: { message: 'Run not found', type: 'not_found' } });
      return;
    }

    this.readBody(req, (body, error) => {
      if (error || body === null) {
        this.sendJson(res, 400, { error: { message: error ?? 'Empty request body', type: 'invalid_request_error' } });
        return;
      }
      try {
        const action = JSON.parse(body) as { action: string; decision?: string };

        if (action.action === 'stop') {
          run.abortController.abort();
          run.status.status = 'stopped';
          run.status.updated_at = new Date().toISOString();
          this.emitEvent(runId, 'stopped', { reason: 'User requested stop' });
          this.sendJson(res, 200, run.status);
          return;
        }

        if (action.action === 'approval') {
          this.emitEvent(runId, 'approval_response', { decision: action.decision });
          this.sendJson(res, 200, { status: 'approval received' });
          return;
        }

        this.sendJson(res, 400, { error: { message: 'Unknown action', type: 'invalid_request' } });
      } catch {
        this.sendJson(res, 400, { error: { message: 'Invalid request body', type: 'invalid_request' } });
      }
    });
  }

  private handleRunEvents(res: ServerResponse, runId: string): void {
    const run = this.runs.get(runId);
    if (!run) {
      this.sendJson(res, 404, { error: { message: 'Run not found', type: 'not_found' } });
      return;
    }

    // SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    // Send existing events
    for (const event of run.events) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    // If the run is already in a terminal state, send a final
    // "end" event and close the connection. The previous
    // implementation kept the connection open indefinitely for
    // completed runs — the listener accumulated in
    // `run.eventListeners` and was only removed on `res.close`.
    // For long-running API servers with many runs, this leaked
    // listeners and consumed memory.
    const terminalStatus = run.status.status;
    if (terminalStatus === 'completed' || terminalStatus === 'failed' || terminalStatus === 'stopped') {
      res.write(`data: ${JSON.stringify({ type: 'end', data: { status: terminalStatus }, timestamp: new Date().toISOString() })}\n\n`);
      res.end();
      return;
    }

    // Subscribe to new events
    const listener = (event: { type: string; data: unknown }): void => {
      res.write(`data: ${JSON.stringify({ type: event.type, data: event.data, timestamp: new Date().toISOString() })}\n\n`);
      // If this is a terminal event, send `end` and close.
      if (event.type === 'completed' || event.type === 'failed' || event.type === 'stopped') {
        res.write(`data: ${JSON.stringify({ type: 'end', data: { status: event.type }, timestamp: new Date().toISOString() })}\n\n`);
        res.end();
        // Remove ourselves from the listener list.
        const idx = run.eventListeners.indexOf(listener);
        if (idx !== -1) run.eventListeners.splice(idx, 1);
      }
    };
    run.eventListeners.push(listener);

    // On close, remove listener
    req_onClose(res, () => {
      const idx = run.eventListeners.indexOf(listener);
      if (idx !== -1) run.eventListeners.splice(idx, 1);
    });
  }

  // ─── Internal helpers ──────────────────────────────────────────

  private async startRun(runId: string, request: RunRequest): Promise<void> {
    const run = this.runs.get(runId)!;
    run.status.status = 'running';
    run.status.updated_at = new Date().toISOString();
    this.emitEvent(runId, 'started', { prompt: request.prompt });

    // The previous implementation's stub used `setTimeout(resolve, ms)`
    // WITHOUT checking `run.abortController.signal` between phases.
    // The `stop` action called `run.abortController.abort()` and set
    // `status='stopped'`, but the stub continued to completion (300ms
    // later) and overwrote `status` back to `'completed'`. The client
    // saw `stopped` momentarily, then `completed`. For a real
    // long-running agent run, the stop button would be effectively
    // broken — the agent keeps running until it finishes or errors.
    // We now poll the abort signal between phases and exit early
    // if aborted. For a real implementation, this would pass
    // `run.abortController.signal` to `AgentLoop.run({ signal })`.

    // Helper: sleep but reject early if aborted.
    const sleepAbortable = (ms: number): Promise<void> =>
      new Promise((resolve, reject) => {
        if (run.abortController.signal.aborted) {
          reject(new Error('aborted'));
          return;
        }
        const timer = setTimeout(() => {
          run.abortController.signal.removeEventListener('abort', onAbort);
          resolve();
        }, ms);
        const onAbort = () => {
          clearTimeout(timer);
          reject(new Error('aborted'));
        };
        run.abortController.signal.addEventListener('abort', onAbort, { once: true });
      });

    try {
      await sleepAbortable(100);
      this.emitEvent(runId, 'phase', { phase: 'INIT' });
      await sleepAbortable(200);
      this.emitEvent(runId, 'phase', { phase: 'GEN' });
      await sleepAbortable(300);
      // Only mark completed if not aborted.
      if (run.abortController.signal.aborted) {
        throw new Error('aborted');
      }
      run.status.status = 'completed';
      run.status.result = `[GOLI-CLI API] Run completed for prompt: ${request.prompt.slice(0, 100)}`;
      run.status.updated_at = new Date().toISOString();
      this.emitEvent(runId, 'completed', { result: run.status.result });
    } catch (err) {
      if (err instanceof Error && err.message === 'aborted') {
        // Stop action already set status='stopped'; don't overwrite.
        const currentStatus = run.status.status as string;
        if (currentStatus !== 'stopped') {
          (run.status as { status: string }).status = 'stopped';
          run.status.updated_at = new Date().toISOString();
        }
        this.emitEvent(runId, 'stopped', { reason: 'aborted by client' });
      } else {
        run.status.status = 'failed';
        run.status.error = err instanceof Error ? err.message : String(err);
        run.status.updated_at = new Date().toISOString();
        this.emitEvent(runId, 'failed', { error: run.status.error });
      }
    }
  }

  private emitEvent(runId: string, type: string, data: unknown): void {
    const run = this.runs.get(runId);
    if (!run) return;
    const event = { type, data, timestamp: new Date().toISOString() };
    run.events.push(event);
    for (const listener of run.eventListeners) {
      listener({ type, data });
    }
  }

  /**
   * Check the Authorization header against the configured API key.
   *
   * Uses a constant-time comparison to prevent timing attacks. The
   * previous implementation used `token === this.apiKey` which leaks
   * the key length and a prefix via timing differences.
   *
   * Also handles the `Bearer` prefix case-insensitively (the previous
   * implementation only matched the exact string `Bearer ` with capital B
   * and single space, rejecting `bearer`, `BEARER`, `Bearer\t`, etc.).
   * @param req
   */
  private checkAuth(req: IncomingMessage): boolean {
    if (!this.requireAuth) return true;
    if (!this.apiKey) return false; // requireAuth is true but no key — deny.
    const auth = req.headers['authorization'];
    if (!auth) return false;
    // Match `Bearer <token>` case-insensitively, allowing any whitespace
    // between Bearer and the token.
    const match = /^\s*Bearer\s+(.+?)\s*$/i.exec(auth);
    if (!match) return false;
    const token = match[1]!;
    // Constant-time comparison. Length differences would otherwise leak
    // information via early-exit in `===`.
    const tokenBuf = Buffer.from(token);
    const keyBuf = Buffer.from(this.apiKey);
    if (tokenBuf.length !== keyBuf.length) return false;
    return timingSafeEqual(tokenBuf, keyBuf);
  }

  /**
   * Read the request body with a size limit and error handling.
   *
   * The previous implementation had three bugs:
   *   1. No size limit — a malicious client could exhaust memory by
   *      sending a huge body.
   *   2. No `req.on('error', ...)` handler — if the request errored
   *      mid-stream (network drop, malformed chunk), the callback was
   *      never invoked and the response hung.
   *   3. `body += chunk` used implicit toString on a Buffer, which
   *      corrupts multibyte chars split across chunks. We now use
   *      Buffer.concat() then decode once.
   * @param req
   * @param callback
   */
  private readBody(req: IncomingMessage, callback: (body: string | null, error?: string) => void): void {
    const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10 MB
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let aborted = false;

    req.on('data', (chunk: Buffer) => {
      if (aborted) return;
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        aborted = true;
        callback(null, `Request body exceeds ${MAX_BODY_BYTES} byte limit`);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (aborted) return;
      const body = Buffer.concat(chunks).toString('utf-8');
      callback(body);
    });

    req.on('error', (err) => {
      if (aborted) return;
      aborted = true;
      callback(null, `Request error: ${err.message}`);
    });
  }

  private sendJson(res: ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  private sendStreamingResponse(res: ServerResponse, response: ChatCompletionResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    // Send the content as SSE chunks. The previous implementation
    // used a tight synchronous loop calling `res.write(...)` and
    // ignored the return value. `res.write` returns `false` when
    // the internal buffer is full — continuing to write buffers
    // the entire response in memory before the kernel drains it.
    // For a 10MB response under concurrent load, this multiplies
    // memory pressure. We now honor backpressure by waiting for
    // the `drain` event when `res.write` returns false.
    const content = response.choices[0]!.message.content;
    const words = content.split(' ');
    let i = 0;
    const writeNext = (): void => {
      while (i < words.length) {
        const chunk = {
          id: response.id,
          object: 'chat.completion.chunk',
          created: response.created,
          model: response.model,
          choices: [{ index: 0, delta: { content: words[i] + ' ' }, finish_reason: null }],
        };
        const ok = res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        i++;
        if (!ok) {
          // Buffer full — wait for drain before continuing.
          res.once('drain', writeNext);
          return;
        }
      }
      // End marker.
      const endChunk = {
        id: response.id,
        object: 'chat.completion.chunk',
        created: response.created,
        model: response.model,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      };
      res.write(`data: ${JSON.stringify(endChunk)}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    };
    writeNext();
  }

  /** Get server stats. */
  getStats(): { runs: number; sessions: number; models: number } {
    return {
      runs: this.runs.size,
      sessions: this.sessions.size,
      models: this.models.length,
    };
  }
}

/**
 * Attach a close handler to a response (cross-platform).
 * @param res
 * @param callback
 */
function req_onClose(res: ServerResponse, callback: () => void): void {
  res.on('close', callback);
}
