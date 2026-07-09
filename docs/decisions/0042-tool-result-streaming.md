# ADR-0042: Tool-Result Streaming (H18)

**Date:** 2026-07-05
**Status:** Accepted
**Hermes Item:** H18 — Tool-Result Streaming

## Context

GOLI-CLI's tools returned results atomically — the agent loop called
`tool.handler()`, waited for it to resolve, then appended the full
result to the conversation. For long-running tools (`bash` compiling
for 30s, `read_file` on a 10MB file, `web_fetch` on a slow URL), this
meant the user saw nothing until the tool completed. The terminal
appeared frozen.

Claude Code and Gemini CLI both stream tool results: `bash` output
appears line-by-line, `read_file` content streams in chunks. This is
a significant UX win — visible progress reduces perceived latency and
lets the user interrupt early if the output is wrong.

## Decision

Add a **tool-result streaming callback** to `ToolContext`:

### API

```ts
interface ToolContext {
  // ...existing fields...
  onToolResultChunk?: (chunk: ToolResultChunk) => void;
}

interface ToolResultChunk {
  toolCallId: string;
  toolName: string;
  chunk: string;       // a line, a 4KB block, etc.
  isFinal: boolean;    // true = end-of-stream
  timestamp: string;   // ISO 8601
}
```

### Helper utilities

- `createChunkEmitter(toolCallId, toolName, callback)` — returns a
  function `(chunk: string | null) => void` that the tool calls for
  each chunk. `null` signals end-of-stream. Handles timestamping and
  the `isFinal` flag. No-op when callback is undefined.
- `splitIntoChunks(content, chunkSize=4096)` — splits content into
  chunks at line boundaries near `chunkSize`. Used by `read_file` and
  `web_fetch`.
- `splitIntoLines(content)` — splits content into lines preserving
  trailing newlines. Used by `bash`.

### Backward compatibility

When `ctx.onToolResultChunk` is undefined (default), tools behave
exactly as before — no streaming, no overhead. This is the behavior
for scripts and CI. The TUI provides the callback; headless mode
provides it only when `--stream` is passed.

### What streams

- `read_file` — content in 4KB chunks (split at line boundaries)
- `bash` — stdout/stderr line-by-line (requires restructuring to use
  `spawn` instead of `execFileSync` — follow-up)
- `web_fetch` — response body in 4KB chunks (follow-up)

The tool still returns a full `ToolResult` at the end (for the
model's context window). Streaming is purely for the user's benefit —
the model sees the same result either way.

## Consequences

**Positive:**

- Real-time progress for long-running tools.
- User can interrupt early if the output is wrong.
- Backward-compatible: no overhead when callback is unset.
- Composable with H14 (diff-first) and H19 (headless JSON output).

**Negative:**

- Tools that stream must be careful not to emit chunks after the
  `ToolResult` is returned (the consumer may have moved on).
  Mitigation: the `createChunkEmitter` helper's `null` sentinel
  signals end-of-stream; tools should call it before returning.
- The `bash` tool currently uses `execFileSync` (blocking). Streaming
  requires `spawn` (async). This is a follow-up — the plumbing is
  in place, the tool migration is deferred.
- Chunks are not coalesced — if a tool emits 1000 tiny chunks, the
  consumer gets 1000 callbacks. Mitigation: the TUI's
  `createBufferedConsumer` (in `callback-streaming.ts`) coalesces
  chunks before re-rendering.

## Alternatives Considered

### A. Async generator (tool returns `AsyncIterable<chunk>`)

Rejected: changes the `ToolHandler` signature, breaking all existing
tools. The callback approach is non-breaking — existing tools work
unchanged.

### B. EventEmitter on ToolContext

Rejected: EventEmitter is heavier than a callback for this use case.
The callback is a single function; EventEmitter requires
`on('chunk', ...)`, `emit('chunk', ...)`, listener management.

### C. Always stream (no opt-out)

Rejected: forces every caller (including CI scripts) to handle
streaming. The opt-out keeps scripts simple.

## Implementation

- `packages/core/src/tools/core/tool-streaming.ts` — `ToolResultChunk`,
  `createChunkEmitter`, `splitIntoChunks`, `splitIntoLines`
- `packages/core/src/tools/types.ts` — `ToolContext.onToolResultChunk`
- `packages/core/src/tools/index.ts` — exports
- `tests/unit/tool-result-streaming.test.ts` — 14 unit tests

## Follow-up

- Modify `read_file` to stream content via `createChunkEmitter` when
  `ctx.onToolResultChunk` is set.
- Restructure `bash` to use `spawn` (async) and stream stdout/stderr
  line-by-line.
- Modify `web_fetch` to stream the response body.
- Wire `onToolResultChunk` in `AgentLoop.executeToolCall()` — the
  callback should be provided by `CliAgentLoop` (TUI) or the headless
  runner (when `--stream` is passed).
- Add `--stream` CLI flag for headless mode.
- Emit `tool-call-start` and `tool-call-result` events from
  `AgentLoop.runStream()` (the `AgentEvent` types already exist).
