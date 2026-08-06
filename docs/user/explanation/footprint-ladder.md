# The Footprint Ladder

> **Explanation** — why every tool in Goli-CLI declares a "footprint,"
> and how the agent uses it to stay within the context window.

Every tool in Goli-CLI declares a **footprint** — the character budget
its output consumes from the context window. The footprint ladder
(ADR 0025) is how Goli-CLI prevents a single tool call from blowing
the context window and forcing a compaction mid-turn.

## The problem

Without budgets, an agent can paint itself into a corner:

1. The agent calls `read_file` on a 500 KB file. The file's contents
   go into the context window.
2. The agent calls `bash` with `npm test`. The test output is 200 KB.
3. The agent calls `read_file` on another large file.
4. The context window is now 90% full. The next LLM call will trigger
   compaction, which loses information.

The naive fix — truncate every tool result to a fixed size — is too
coarse. A `read_file` of a 50-line file should fit; a `read_file` of
a 50,000-line file should be truncated aggressively. A `bash` command
that ran for 10 seconds probably has a small output; a `bash` command
that ran for 10 minutes probably has a large output.

## The footprint ladder

Goli-CLI's footprint ladder declares five tiers:

| Tier      | Budget      | Typical tools                                               |
| --------- | ----------- | ----------------------------------------------------------- |
| Tiny      | ≤ 500 chars | `read_file` (small), `grep` (few matches), `list_directory` |
| Small     | ≤ 5 KB      | `read_file` (medium), `glob`, `web_search`                  |
| Medium    | ≤ 30 KB     | `read_file` (large), `bash` (output), `web_fetch`           |
| Large     | ≤ 200 KB    | `read_file` (very large), `bash` (verbose output)           |
| Unbounded | streamed    | `background_shell` (streamed, not budgeted)                 |

Each tool declares its tier in its `capabilities` field:

```typescript
export const read_file: Tool = {
  name: 'read_file',
  description: '...',
  inputSchema: ...,
  capabilities: {
    footprint: 'medium',         // ≤ 30 KB
    streaming: false,
    sideEffects: false,
  },
  execute: ...,
};
```

The runtime uses the tier to decide:

- Whether to truncate the result (and to what size).
- Whether to stream the result instead of buffering it.
- Whether to warn the agent ("this tool's output was truncated; use
  `offset`/`limit` to read it in chunks").

## How the agent uses the ladder

When the agent emits a tool call, the runtime:

1. Looks up the tool's declared footprint.
2. Executes the tool.
3. If the result is within the declared budget, returns it as-is.
4. If the result exceeds the budget, truncates it with a
   `[truncated at N chars; use offset/limit to read more]` marker.
5. If the tool declares `streaming: true`, streams the output
   line-by-line to the TUI (and to the context window as a summary,
   not the full output).

The agent sees the truncated marker and can decide to:

- Re-call the tool with `offset`/`limit` to read the next chunk.
- Use `grep` to find a specific line.
- Use `bash` with `head`/`tail` to get a slice.

This puts the **budget decision in the agent's hands** — the agent
knows what it's looking for and can request exactly the slice it
needs, instead of getting a firehose and having to compact.

## Per-tier strategies

### Tiny (≤ 500 chars)

No truncation needed. The result fits comfortably in any context
window.

Examples: `list_directory` on a 20-file directory, `grep` with 3
matches, `read_file` on a 30-line file.

### Small (≤ 5 KB)

No truncation in normal use. If the context window is already >90%
full, the runtime may truncate to 2 KB.

Examples: `read_file` on a 200-line file, `glob` with 50 matches,
`web_search` with 10 results.

### Medium (≤ 30 KB)

Default budget for most tools. Truncate aggressively above 30 KB —
the agent should use `offset`/`limit` for larger reads.

Examples: `read_file` on a 1000-line file, `bash` with normal output,
`web_fetch` on a long article.

### Large (≤ 200 KB)

For tools that genuinely need to return a lot of data. Truncate above
200 KB. The agent should consider whether it really needs all 200 KB
— usually a `grep` would have been better.

Examples: `read_file` on a 5000-line file (rare), `bash` with verbose
output (test suite logs).

### Unbounded (streamed)

For tools whose output is fundamentally unbounded (long-running
shell commands, websockets). The output is streamed to the TUI
line-by-line; the context window only gets a summary (last N lines +
total line count).

Examples: `background_shell`, future `web_fetch_stream`.

## How the budget is enforced

The budget is enforced in `packages/tool-system/src/truncation.ts`:

```typescript
function truncate(result: ToolResult, footprint: Footprint): ToolResult {
  const budget = FOOTPRINT_BUDGETS[footprint];
  if (result.content.length <= budget) return result;
  return {
    ...result,
    content:
      result.content.slice(0, budget) +
      `\n[truncated at ${budget} chars; use offset/limit to read more]`,
  };
}
```

The truncation is deterministic — the same input always produces the
same truncated output. This is important for reproducibility (ADR
0024 — frozen snapshot injection).

## Trade-offs

The footprint ladder has costs:

- **More tool calls.** The agent may need to call `read_file` 3 times
  (with `offset`/`limit`) instead of once. This costs more LLM tokens
  but saves context window.
- **Agent must be aware of the ladder.** A naive agent that calls
  `read_file` on a huge file and gets a truncated result may not know
  to use `offset`/`limit`. Goli-CLI's system prompt explicitly teaches
  the agent about the ladder.
- **Streaming complicates the wire format.** Streaming tools need a
  different protocol than buffered tools (see ADR 0042 — tool-result
  streaming).

The benefits outweigh the costs: the agent stays within the context
window, compactions are rare, and the agent is in control of its own
budget.

## See also

- [ADR 0025](../../decisions/0025-hard-character-budgets.md) — the
  design decision.
- [ADR 0023](../../decisions/0023-compaction-at-70-percent.md) —
  compaction (the fallback when budgets fail).
- [ADR 0024](../../decisions/0024-frozen-snapshot-injection.md) —
  frozen snapshots for reproducibility.
- [ADR 0042](../../decisions/0042-tool-result-streaming.md) —
  streaming for unbounded tools.
- [Reference: Tools](../reference/tools.md) — every tool's declared
  footprint.
- [`packages/tool-system/src/footprint-ladder.ts`](../../../packages/tool-system/src/footprint-ladder.ts)
  — the implementation.
