/**
 * Goli Studio — agent-runtime mini-service.
 *
 * socket.io server on port 3003 (path '/'). The Caddy gateway forwards
 * browser connections from /?XTransformPort=3003 to this port.
 *
 * This uses @goli/core's AgentLoop to provide parity with the CLI.
 *
 * Events in/out: see ../../src/lib/types/socket.ts (single source of truth).
 */
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { randomUUID } from 'node:crypto';

import { AgentLoop, loadConfig, createLogger, configureLogger, defaultLifecycleLogPath } from '@goli/core';
import { validateWorkspace, WorkspaceError } from '../../src/lib/storage/workspace';
import { loadAgentsMd, formatAgentsMdPreamble } from '../../src/lib/context/agents-md';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '../../src/lib/types/socket';
import type { PermissionMode } from '../../src/lib/types';

const PORT = Number(process.env.AGENT_RUNTIME_PORT) || 3003;

// Per-session in-flight run state.
interface RunState {
  abort: AbortController;
  // Pending permission requests: toolCallId -> resolver.
  pending: Map<string, (decision: 'allow' | 'deny') => void>;
}
const runsBySession = new Map<string, RunState>();

const httpServer = createServer();
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  path: '/',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60_000,
  pingInterval: 25_000,
});

function roomFor(sessionId: string): string {
  return `session:${sessionId}`;
}

io.on('connection', (socket) => {
  console.log(`[agent-runtime] connected: ${socket.id}`);

  // ---- session:join ----
  socket.on('session:join', (payload, ack) => {
    const { sessionId } = payload;
    if (typeof sessionId === 'string' && sessionId.length > 0) {
      socket.join(roomFor(sessionId));
      ack(true);
    } else {
      ack(false);
    }
  });

  // ---- prompt ----
  socket.on('prompt', async (payload) => {
    const { sessionId, prompt, workspaceDir, permissionMode, systemPreamble } = payload;
    if (!sessionId || !prompt || !workspaceDir) {
      socket.emit('agent:error', {
        runId: randomUUID(),
        message: 'Invalid prompt payload (sessionId/prompt/workspaceDir required).',
      });
      return;
    }

    // SECURITY: re-validate the workspace server-side. Never trust the client.
    let validatedWorkspace: string;
    try {
      validatedWorkspace = await validateWorkspace(workspaceDir);
    } catch (err) {
      const msg =
        err instanceof WorkspaceError
          ? err.message
          : `Workspace validation failed: ${(err as Error).message}`;
      socket.emit('agent:error', { runId: randomUUID(), message: msg });
      return;
    }

    // Auto-load AGENTS.md (or CLAUDE.md / GOLI.md fallback) from the workspace
    // root and merge with any client-provided preamble. AGENTS.md is the
    // authoritative project-instructions layer; the client preamble (if any)
    // is appended as an additional override layer.
    const agentsMd = await loadAgentsMd(validatedWorkspace);
    const preambleParts: string[] = [];
    if (agentsMd.text) {
      preambleParts.push(formatAgentsMdPreamble(agentsMd));
    }
    if (typeof systemPreamble === 'string' && systemPreamble.trim().length > 0) {
      preambleParts.push(`# Additional instructions\n${systemPreamble}`);
    }
    const mergedPreamble = preambleParts.length > 0 ? preambleParts.join('\n\n') : undefined;
    if (agentsMd.error) {
      console.warn(`[agent-runtime] AGENTS.md read error for ${validatedWorkspace}: ${agentsMd.error}`);
    }

    // Abort any existing run for this session (one live run per session).
    const prev = runsBySession.get(sessionId);
    if (prev) prev.abort.abort();

    const abort = new AbortController();
    const pending = new Map<string, (d: 'allow' | 'deny') => void>();
    runsBySession.set(sessionId, { abort, pending });
    socket.join(roomFor(sessionId));

    // Emitter: broadcast to the session room (all tabs see the same stream).
    const room = roomFor(sessionId);
    const emit = {
      start: (runId: string) =>
        io.to(room).emit('agent:start', { runId, sessionId, at: new Date().toISOString() }),
      token: (runId: string, text: string) =>
        io.to(room).emit('agent:token', { runId, text }),
      toolStart: (runId: string, toolCallId: string, name: string, input: Record<string, unknown>) =>
        io.to(room).emit('agent:tool_start', { runId, toolCallId, name, input }),
      toolEnd: (runId: string, toolCallId: string, result: any) =>
        io.to(room).emit('agent:tool_end', { runId, toolCallId, result }),
      permissionRequest: (
        runId: string,
        toolCallId: string,
        name: string,
        input: Record<string, unknown>,
        summary: string,
      ) => io.to(room).emit('agent:permission_request', { runId, toolCallId, name, input, summary }),
      final: (runId: string, text: string) =>
        io.to(room).emit('agent:final', { runId, text }),
      error: (runId: string, message: string) =>
        io.to(room).emit('agent:error', { runId, message }),
      end: (runId: string, turns: number) =>
        io.to(room).emit('agent:end', { runId, sessionId, turns }),
    };

    const runId = randomUUID();
    emit.start(runId);

    try {
      const config = loadConfig();
      configureLogger({
        level: config.logging.level,
        format: config.logging.format,
        lifecycleLogPath: defaultLifecycleLogPath(),
      });
      const logger = createLogger({ level: config.logging.level, defaultContext: { module: 'goli.studio' } });

      const appMode = permissionMode === 'yolo' ? 'god' : (permissionMode === 'plan' ? 'plan' : 'build');
      const loop = new AgentLoop({
        config,
        logger,
        godMode: appMode === 'god',
        appMode,
      });

      // We prefix prompt with preamble if provided, just to ensure system instructions are known.
      const fullPrompt = mergedPreamble ? `${mergedPreamble}\n\nUser request: ${prompt}` : prompt;

      const roleMap: Record<string, string> = {
        'plan': 'architect',
        'build': 'implementer',
        'god': 'orchestrator'
      };
      const role = roleMap[appMode] || 'implementer';

      const result = await loop.run({
        prompt: fullPrompt,
        appMode,
        role: role as any,
        signal: abort.signal,
      });

      if (result.content) {
        emit.token(runId, result.content);
        emit.final(runId, result.content);
      }
      
      emit.end(runId, result.iterations);

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      emit.error(runId, `Loop crashed: ${errorMessage}`);
    } finally {
      // Clean up pending resolvers (deny any unanswered).
      for (const [, resolver] of pending) {
        try { resolver('deny'); } catch { /* noop */ }
      }
      pending.clear();
      if (runsBySession.get(sessionId)?.abort === abort) {
        runsBySession.delete(sessionId);
      }
    }
  });

  // ---- permission:decision ----
  socket.on('permission:decision', (payload) => {
    const { sessionId, toolCallId, decision } = payload as {
      sessionId?: string;
      toolCallId: string;
      decision: 'allow' | 'deny';
    };
    let state: RunState | undefined;
    if (sessionId) {
      state = runsBySession.get(sessionId);
    } else {
      for (const s of runsBySession.values()) {
        if (s.pending.has(toolCallId)) {
          state = s;
          break;
        }
      }
    }
    const resolver = state?.pending.get(toolCallId);
    if (resolver) {
      state!.pending.delete(toolCallId);
      resolver(decision);
    }
  });

  // ---- cancel ----
  socket.on('cancel', (payload) => {
    const { sessionId } = payload;
    const state = runsBySession.get(sessionId);
    if (state) state.abort.abort();
  });

  // ---- disconnect ----
  socket.on('disconnect', () => {
    console.log(`[agent-runtime] disconnected: ${socket.id}`);
    for (const [sessionId] of socket.rooms) {
      if (!sessionId.startsWith('session:')) continue;
      const room = io.sockets.adapter.rooms.get(sessionId);
      const remaining = room ? room.size : 0;
      if (remaining <= 1) {
        const state = runsBySession.get(sessionId.slice('session:'.length));
        if (state) state.abort.abort();
      }
    }
  });

  socket.on('error', (err) => {
    console.error(`[agent-runtime] socket error (${socket.id}):`, err);
  });
});

httpServer.listen(PORT, () => {
  console.log(`[agent-runtime] socket.io server listening on port ${PORT} (path /)`);
});

// Graceful shutdown.
function shutdown(signal: string) {
  console.log(`[agent-runtime] ${signal} received, shutting down…`);
  for (const [, state] of runsBySession) state.abort.abort();
  io.close(() => httpServer.close(() => process.exit(0)));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
