/**
 * Goli Studio — socket.io event protocol (single source of truth).
 *
 * The React client connects with: io('/?XTransformPort=3003', { transports:['websocket'] })
 * The mini-service listens on port 3003 with path '/' (required by the Caddy gateway).
 *
 * Both sides import these maps so the event names + payload shapes cannot drift.
 */
import type { PermissionMode, ToolResult } from './index';

// ---------------------------------------------------------------------------
// Client -> Server
// ---------------------------------------------------------------------------

/**
 *
 */
export interface ClientToServerEvents {
  /** Join a session room so events for that session are routed to this socket. */
  'session:join': (payload: { sessionId: string }, ack: (ok: boolean) => void) => void;
  /** Kick off an agent run for an existing session. */
  prompt: (payload: {
    sessionId: string;
    prompt: string;
    workspaceDir: string;
    permissionMode: PermissionMode;
    /** Optional AGENTS.md / project preamble text. */
    systemPreamble?: string;
  }) => void;
  /** User's decision on a permission_request. */
  'permission:decision': (payload: {
    runId: string;
    toolCallId: string;
    decision: 'allow' | 'deny';
  }) => void;
  /** Cancel the in-flight run for a session. */
  cancel: (payload: { sessionId: string }) => void;
}

// ---------------------------------------------------------------------------
// Server -> Client
// ---------------------------------------------------------------------------

/**
 *
 */
export interface AgentEventMap {
  'agent:start': { runId: string; sessionId: string; at: string };
  'agent:token': { runId: string; text: string };
  'agent:tool_start': {
    runId: string;
    toolCallId: string;
    name: string;
    input: Record<string, unknown>;
  };
  'agent:tool_end': { runId: string; toolCallId: string; result: ToolResult };
  'agent:permission_request': {
    runId: string;
    toolCallId: string;
    name: string;
    input: Record<string, unknown>;
    /** Human-readable reason shown in the approval card. */
    summary: string;
  };
  'agent:final': { runId: string; text: string };
  'agent:error': { runId: string; message: string };
  'agent:end': { runId: string; sessionId: string; turns: number };
}

/**
 *
 */
export interface ServerToClientEvents {
  'agent:start': (payload: AgentEventMap['agent:start']) => void;
  'agent:token': (payload: AgentEventMap['agent:token']) => void;
  'agent:tool_start': (payload: AgentEventMap['agent:tool_start']) => void;
  'agent:tool_end': (payload: AgentEventMap['agent:tool_end']) => void;
  'agent:permission_request': (payload: AgentEventMap['agent:permission_request']) => void;
  'agent:final': (payload: AgentEventMap['agent:final']) => void;
  'agent:error': (payload: AgentEventMap['agent:error']) => void;
  'agent:end': (payload: AgentEventMap['agent:end']) => void;
}

/** Default port the agent-runtime mini-service listens on. */
export const AGENT_RUNTIME_PORT = 3003;
