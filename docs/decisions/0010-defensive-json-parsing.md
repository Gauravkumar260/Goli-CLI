# ADR-0010: Defensive JSON Parsing for Tool-Call Arguments

**Status:** Accepted
**Phase:** P2
**Date:** 2026-07-03

## Context

GLM-5.2 (like all LLMs) emits tool-call `arguments` as a JSON string.
Under heavy multi-tool turns (5+ concurrent tool calls), the model can
produce malformed JSON:

- Missing closing braces (`{"file_path": "/tmp/test.ts"`)
- Trailing commas (`{"a": 1, "b": 2,}`)
- Unescaped newlines inside strings (`{"path": "foo\nbar"}`)
- Mid-stream truncation (streaming chunks split mid-JSON)
- Markdown code fences around JSON (```` ```json\n{...}\n``` ````)
- Prose wrapper (`"Here are the arguments: {...}"`)

A bare `JSON.parse` would throw on any of these, crashing the agent
loop. This is unacceptable — the loop must never crash on model output.

## Decision

GOLI-CLI uses a **defensive JSON parser** (`packages/core/src/agent/json-repair.ts`)
that:

1. **Tries `JSON.parse` first** (fast path for well-formed JSON).
2. **Applies repairs** if the initial parse fails:
   - Strips markdown code fences
   - Extracts JSON from prose wrappers
   - Removes trailing commas
   - Escapes literal newlines inside strings
   - Adds missing closing braces/brackets
3. **Returns `undefined`** if all repairs fail (never throws).
4. **Wraps in `parseToolCallArgs`** which returns a discriminated union:
   `{ ok: true, value } | { ok: false, error }`.

The agent loop uses `parseToolCallArgs` to parse every tool call. On
failure, it sets `toolCall.parseError` and returns the error to the
model so the model can re-emit a valid tool call.

## Consequences

**Positive:**
- The agent loop never crashes on malformed JSON.
- The model gets feedback ("failed to parse — re-emit valid JSON")
  and can self-correct.
- Repair strategies handle the most common malformations (>90% of
  cases in testing).

**Negative:**
- Repair heuristics can occasionally produce unexpected results (e.g.
  extracting the wrong JSON object from prose). Mitigation: the
  repairs are conservative and return `undefined` if uncertain.
- The repair logic is custom code that needs maintenance. Mitigation:
  Phase 2 will consider switching to `jsonrepair` (MIT, SBOM-clean) if
  our hand-rolled repairs prove insufficient.

## Implementation

- `packages/core/src/agent/json-repair.ts` — `repairJson` + `parseToolCallArgs`
- 14 unit tests covering all repair strategies
- `GLMClient` uses `parseToolCallArgs` in both streaming and non-streaming paths
- `AgentLoop` checks `toolCall.parseError` and returns feedback to the model

## References

- Upstream `module-1-agent-core-loop.md` — defensive JSON parsing section
- `jsonrepair` library (MIT): <https://github.com/josdejong/jsonrepair>
