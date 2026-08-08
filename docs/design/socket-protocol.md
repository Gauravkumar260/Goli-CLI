# Goli Studio — Socket.io Protocol

> **Status:** v0.1 (experimental)
> **Last updated:** 2026-07-25
> **Source of truth:** [`apps/studio/src/lib/types/socket.ts`](../../apps/studio/src/lib/types/socket.ts)

This document describes the socket.io protocol that the Goli Studio
frontend (browser) uses to talk to the agent runtime mini-service. The
**single source of truth** for the wire format is the TypeScript file
referenced above; this document is the human-readable companion.

## Connection

The frontend connects via:

```ts
import { io } from "socket.io-client";
const socket = io("/?XTransformPort=3003", {
  transports: ["websocket"],
  reconnection: true,
});
```

The `?XTransformPort=3003` query parameter is consumed by the Caddy
reverse proxy (`apps/studio/Caddyfile`) to route the WebSocket
upgrade to the agent runtime on port 3003 instead of the Next.js app on
port 3000. This is a Caddy-specific trick — the browser sees a single
origin (`http://localhost:3000`) but the WebSocket is transparently
proxied to the runtime.

If the connection fails (timeout after 1500ms, or `connect_error` event),
the frontend auto-falls back to **Demo mode** (mock agent stream) so the
UI is explorable without a backend.

## Events

### Client → Server

| Event                 | Payload                                                                                                                       | Description                                                                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `prompt`              | `{ sessionId: string, prompt: string, workspaceDir: string, permissionMode: 'ask'\|'yolo'\|'plan', systemPreamble?: string }` | Start a new agent run.                                                                                  |
| `permission:decision` | `{ runId: string, toolCallId: string, decision: 'allow'\|'deny' }`                                                            | Respond to a `agent:permission_request` event.                                                          |
| `cancel`              | `{ sessionId: string }`                                                                                                       | Cancel the in-flight agent run for this session.                                                        |
| `session:join`        | `{ sessionId: string }`                                                                                                       | Subscribe to events for a session (for multi-tab support). Ack callback receives the current run state. |

### Server → Client

| Event                      | Payload                                                                                | Description                                                                                                                                                                                                         |
| -------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent:start`              | `{ runId: string, sessionId: string, at: number }`                                     | A new agent run has started. `at` is a Unix timestamp (ms).                                                                                                                                                         |
| `agent:token`              | `{ runId: string, text: string }`                                                      | A streamed assistant token. Concatenate to build the full message.                                                                                                                                                  |
| `agent:tool_start`         | `{ runId: string, toolCallId: string, name: string, input: unknown }`                  | The agent is starting a tool call. `input` is the parsed JSON arguments.                                                                                                                                            |
| `agent:tool_end`           | `{ runId: string, toolCallId: string, result: ToolResult }`                            | The tool call completed. `result` is `{ ok: boolean, content: string, isError?: boolean }`.                                                                                                                         |
| `agent:permission_request` | `{ runId: string, toolCallId: string, name: string, input: unknown, summary: string }` | The agent is asking for permission to execute a tool. The UI must respond via `permission:decision`. The `summary` is a human-readable description of what the tool will do (e.g. "write 234 lines to src/foo.ts"). |
| `agent:final`              | `{ runId: string, text: string }`                                                      | The agent's final message for this run. The text is the full message (not a delta).                                                                                                                                 |
| `agent:error`              | `{ runId: string, message: string }`                                                   | The run errored out.                                                                                                                                                                                                |
| `agent:end`                | `{ runId: string, sessionId: string, turns: number }`                                  | The run completed normally. `turns` is the total number of turns.                                                                                                                                                   |

## Sequence

A typical happy-path run looks like:

```
Browser                    Runtime
   │                          │
   │── prompt ───────────────▶│
   │                          │
   │◀─ agent:start ───────────│
   │◀─ agent:token ───────────│
   │◀─ agent:token ───────────│  (stream of tokens)
   │◀─ agent:tool_start ──────│  (e.g. read_file)
   │◀─ agent:tool_end ────────│
   │◀─ agent:token ───────────│
   │◀─ agent:tool_start ──────│  (e.g. write_file)
   │◀─ agent:permission_request│  (write_file needs permission)
   │                          │
   │   (user clicks Allow)    │
   │                          │
   │── permission:decision ──▶│  (decision: 'allow')
   │                          │
   │◀─ agent:tool_end ────────│  (write_file succeeded)
   │◀─ agent:token ───────────│
   │◀─ agent:final ───────────│
   │◀─ agent:end ─────────────│
```

## Cancellation

The user can cancel a run at any time. The frontend emits `cancel` and
the runtime:

1. Aborts the in-flight LLM call (via `AbortController`).
2. Cancels any in-flight tool calls (via `AbortSignal`).
3. Emits `agent:end` with the partial turn count.
4. Closes the run; no more events will be emitted for this `runId`.

## Permission modes

The `permissionMode` in the `prompt` event controls how the runtime
handles tool calls that normally require permission:

| Mode   | Behavior                                                                                                                                                                            |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ask`  | Default. The runtime emits `agent:permission_request` for every tool that needs approval; the UI must respond with `permission:decision`.                                           |
| `yolo` | The runtime auto-allows every tool call (no `agent:permission_request` events). For power users only; the UI shows a "YOLO" indicator.                                              |
| `plan` | The runtime plans but does not execute — every tool call is auto-denied with a "plan mode" marker. The agent is told "you are in plan mode; propose changes but do not apply them". |

## Demo mode

When the runtime is unreachable, the frontend's `useAgentStream` hook
auto-falls back to Demo mode, which simulates the entire protocol
client-side:

1. Emits `agent:start` with a mock `runId`.
2. Streams `agent:token` events on a `setTimeout` to simulate token
   streaming.
3. Emits `agent:tool_start` for `read_file` and `write_file` (mock
   results).
4. Emits `agent:permission_request` for `write_file`.
5. Waits for `permission:decision` from the UI.
6. Emits `agent:tool_end`, then `agent:final` and `agent:end`.

Demo mode is also manually toggleable in the Settings drawer.

## Versioning

The protocol is unversioned in v0.1 (experimental). When the studio
moves to v0.2, we will introduce a `protocol_version` field in the
`agent:start` event and use semver:

- **Major** — breaking change (renamed events, removed fields, changed
  semantics). The runtime rejects clients with a mismatched major.
- **Minor** — additive (new events, new optional fields). Old clients
  keep working.
- **Patch** — bug fixes (no protocol change).

The frontend will negotiate the version on `session:join` (the ack
callback will return the runtime's supported version range).
