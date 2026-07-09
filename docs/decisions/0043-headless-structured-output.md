# ADR-0043: Headless Structured Output (H19)

**Date:** 2026-07-05
**Status:** Accepted
**Hermes Item:** H19 — Headless Structured Output

## Context

GOLI-CLI's headless mode (`goli -p "prompt"`) previously printed
only the response text to stdout and a usage summary to stderr.
Scripts that needed to extract tool calls, token usage, or cost had
to scrape the text output — fragile and lossy.

Claude Code's `--output-format json` is the standard for CI/CD
integration: a structured JSON object with response, tool calls,
tokens, cost, iterations, duration, and stop reason. GOLI-CLI lacked
this.

## Decision

Add a `--output-format <fmt>` CLI flag supporting three values:

### `text` (default)

Plain text response to stdout, usage summary to stderr. Backward-
compatible with the existing behavior.

### `json`

A structured JSON object to stdout:

```json
{
  "ok": true,
  "stopReason": "completed",
  "response": "The bug is fixed...",
  "toolCalls": [
    {
      "name": "read_file",
      "args": { "file_path": "/tmp/foo.txt" },
      "result": "file contents...",
      "ok": true,
      "durationMs": 12
    }
  ],
  "tokens": { "input": 0, "output": 0, "thinking": 0, "total": 1234 },
  "costUsd": 0.0056,
  "iterations": 3,
  "durationMs": 4567,
  "todos": [{ "content": "Fix bug", "status": "completed", "priority": "high" }]
}
```

Tool call results are truncated to 1000 characters in the JSON output
(to keep output manageable for long bash outputs).

### `stream-json`

Newline-delimited JSON events (one per `AgentEvent`). Currently falls
back to `text` for the final output because `AgentLoop.runStream()`
only yields `loop-start` and `stop` events (H9 callback streaming is
not yet fully wired). When H9 is complete, `stream-json` will emit
per-iteration events (thinking, content-delta, tool-call-start,
tool-call-result).

## Consequences

**Positive:**

- Scripts can parse tool calls, tokens, and cost without scraping.
- Backward-compatible: `text` is the default.
- Truncation prevents giant JSON for long bash outputs.
- `stream-json` is forward-compatible — when H9 lands, the format
  is already specified.

**Negative:**

- `tokens.input` / `tokens.output` / `tokens.thinking` are always 0
  in the JSON output because `AgentLoopResult` doesn't break them
  down (only `totalTokens`). Mitigation: extend `AgentLoopResult`
  in a follow-up to expose the breakdown.
- `stream-json` doesn't actually stream yet (falls back to text).
  Mitigation: the format is specified; the implementation is a
  follow-up dependent on H9.
- Tool result truncation loses data. Mitigation: 1000 chars is enough
  for most use cases; full results are in the conversation transcript.

## Alternatives Considered

### A. Always JSON (no text mode)

Rejected: breaks every existing script that pipes `goli -p` output.

### B. XML output

Rejected: JSON is the industry standard; XML is more verbose and
harder to parse in shell scripts.

### C. Separate `--json` flag (boolean)

Rejected: less extensible. `--output-format` allows future formats
(`yaml`, `csv`, etc.) without adding more boolean flags.

## Implementation

- `packages/cli/src/commands/headless-output.ts` — `formatAsJson`,
  `formatAsText`, `formatUsageSummary`, `parseOutputFormat`,
  `HeadlessJsonOutput`, `ToolCallEntry`, `OutputFormat`
- `packages/cli/src/index.ts` — added `--output-format` flag, wired
  into `runHeadless()`
- `tests/unit/headless-output.test.ts` — 14 unit tests

## Follow-up

- Extend `AgentLoopResult` to expose `inputTokens`, `outputTokens`,
  `thinkingTokens` separately (currently only `totalTokens`).
- Implement `stream-json` properly once H9 (callback streaming) is
  wired into `AgentLoop.runStream()`.
- Add `--output-format json` to other CLI subcommands (`audit`,
  `status`, `usage`) for consistency.
- Document the JSON schema in the README.
