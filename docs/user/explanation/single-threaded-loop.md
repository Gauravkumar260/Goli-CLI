# The Single-Threaded Agent Loop

> **Explanation** — why Goli-CLI's agent loop is single-threaded, and
> how concurrency works without threads.

Goli-CLI's agent loop is **single-threaded** (ADR 0009). All
concurrency is cooperative, via `Promise.all`, `Promise.race`, and
`AbortController`. There are no worker threads, no `cluster`, no
`child_process.fork` for the agent itself.

This is a deliberate design choice. This note explains why.

## The naive argument for multi-threading

The argument for multi-threading an agent loop goes like this:

> The agent needs to do many things in parallel: stream tokens from
> the LLM, execute tool calls, update the TUI, write to the audit
> log, run the SICA overseer. If these are all on the main thread,
> one slow operation blocks the others. Multi-threading would let
> them run in parallel.

This argument is correct about the need for concurrency — the agent
_does_ need to do many things at once. But it's wrong about the
solution. JavaScript's event loop already provides concurrency for
I/O-bound work, which is what the agent does. Multi-threading would
add complexity without buying performance.

## Why single-threaded is enough

The agent's work is almost entirely **I/O-bound**:

- LLM calls: HTTP requests, ~1-30 seconds each.
- Tool calls: filesystem reads/writes, subprocesses, network requests.
- TUI updates: terminal writes, <1ms each.
- Audit log: filesystem appends, <1ms each.
- SICA overseer: another LLM call, ~1-10 seconds.

Node.js's event loop handles I/O-bound concurrency natively. While
the LLM call is in flight (waiting for the next token), the event
loop processes TUI updates, audit log writes, and SICA critiques.
No thread is blocked; the CPU is idle waiting for I/O.

The only **CPU-bound** work is JSON parsing, prompt construction, and
tree-sitter indexing. These are fast enough (<100ms each) that
running them on the main thread is fine. For the rare case where
they're not (e.g. indexing a 10k-file repo), Goli-CLI uses a worker
thread pool — but the **agent loop itself** stays single-threaded.

## The benefits of single-threaded

### 1. No race conditions

A single-threaded loop has no race conditions. The agent's state
(the session transcript, the context window, the SICA registry) is
mutated by one logical flow; there's no need for locks, mutexes, or
atomics.

In a multi-threaded loop, you'd need to synchronize access to:

- The session transcript (the agent appends while the TUI reads).
- The context window (the agent reads while compaction writes).
- The SICA registry (the agent reads while the overseer writes).
- The audit log (multiple writers).

Each synchronization point is a potential bug. Single-threading
eliminates them all.

### 2. Deterministic ordering

In a single-threaded loop, events happen in a deterministic order.
The same prompt always produces the same sequence of tool calls,
the same SICA critiques, the same audit log entries. This is
critical for reproducibility (ADR 0024) and for debugging.

In a multi-threaded loop, the order of events depends on the
scheduler. A bug that reproduces on one run may not reproduce on
the next, because the threads interleaved differently.

### 3. Easier to reason about

A single-threaded loop is a straight-line story: "the agent did A,
then B, then C." A multi-threaded loop is a maze: "the agent did A
and B in parallel, then C waited for B, then D raced with C."

This matters for code review, for debugging, and for new contributors.
A single-threaded loop is easier to understand, easier to test, and
easier to maintain.

### 4. Lower memory overhead

Each thread has its own stack (default 1MB on Linux) and its own
copy of the V8 isolate's internals. A multi-threaded agent with 8
threads would use 8MB+ of stack alone, plus the duplicated V8 state.

Single-threaded uses one stack, one V8 isolate. The memory savings
are not huge, but they matter for the CLI's cold-start budget
(NFR-001: ≤ 1.5s).

## How concurrency works

Single-threaded does not mean sequential. The agent does many things
"in parallel" via the event loop:

### Parallel tool execution

When the model emits multiple tool calls in one turn, they execute in
parallel via `Promise.all`:

```typescript
const results = await Promise.all(
  toolCalls.map((call) => executeTool(call, signal)),
);
```

Each tool call is an async function; they all start at the same
instant and run concurrently on the event loop. The `await
Promise.all` waits for all of them to finish before continuing.

### Cancellation

The `AbortSignal` flows from the user's Ctrl-C all the way down to
each in-flight tool. When the user cancels:

```typescript
// In the TUI:
abortController.abort();

// In each tool:
if (signal.aborted) throw new AbortError();
```

Cancellation is **cooperative** — each tool checks the signal
periodically and bails out. This is simpler and safer than thread
cancellation (which is cooperative anyway in most languages).

### Streaming

Streaming tokens from the LLM is an async iterator:

```typescript
for await (const chunk of provider.chat(req, signal)) {
  emit("agent:token", chunk.text);
  if (signal.aborted) break;
}
```

The event loop processes TUI updates between iterations. The user
sees tokens stream in real-time, even though the loop is
single-threaded.

## When we do use worker threads

Goli-CLI uses worker threads for **CPU-bound** work that would block
the event loop:

- **Tree-sitter indexing** — parsing a 10k-file repo takes ~5s on the
  main thread. We move it to a worker pool
  (`packages/shared/src/worker-pool.ts`).
- **Vector search** — sqlite-vec queries are fast but synchronous;
  we run them in a worker to avoid blocking.
- **Prettier formatting** (in the `auto-format` hook) — for large
  files, Prettier can take 100ms+; we run it in a worker.

The agent loop itself never runs in a worker. The workers are
**tools** the agent calls, not part of the loop.

## Subagents

Subagents (`spawn_subagent`) are a separate concern. Each subagent
runs in its own **process** (not thread), with its own context window
and tool registry. The parent agent awaits the subagent's result via
an async iterator. This is multi-process, not multi-threaded — and
it's how Goli-CLI gets parallelism for CPU-bound agent work without
the complexity of threads.

See [ADR 0039](../../decisions/0039-parallel-subagents.md) for the
subagent design.

## See also

- [ADR 0009](../../decisions/0009-single-threaded-loop.md) — the
  design decision.
- [ADR 0039](../../decisions/0039-parallel-subagents.md) — parallel
  subagents.
- [ADR 0042](../../decisions/0042-tool-result-streaming.md) —
  streaming.
- [Explanation: SICA loop](sica-loop.md) — the overseer runs as a
  separate LLM call, not a separate thread.
- [`packages/agent-core/src/loop.ts`](../../../packages/agent-core/src/loop.ts)
  — the implementation.
