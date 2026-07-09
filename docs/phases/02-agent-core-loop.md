# Phase 2 — Agent Core Loop (Module 1)

**Status:** Pending
**Modules touched:** M1 (Agent Core Loop)
**Compliance gates:** none new

## Goal

Implement the ReAct single-threaded master loop, the GLM-5.2
OpenAI-compatible streaming client, the dynamic system-prompt
assembler, the TODO/planner engine, the 4-condition stop engine, the
retry/backoff layer, and per-iteration token accounting. End of
Phase 2: a real agent can be invoked with a prompt, call GLM-5.2,
receive streamed thinking + content + tool_calls, and either complete
or stop gracefully.

## Definition of Done

- [ ] `src/agent/glm-client.ts` — OpenAI-compatible streaming client with:
  - `base_url` swap (Z.ai prototype → self-hosted vLLM)
  - Streaming SSE parser for content / thinking / tool_calls
  - Defensive JSON parsing for tool-call arguments (never crashes)
  - Two reasoning-effort levels (`high`, `max`)
  - Request timeout, abort controller
- [ ] `src/agent/system-prompt.ts` — fragment-list assembler (≥9 fragments):
  - Identity, tool definitions, sandbox mode, language, git, TODO, memory, safety, output format
  - Conditionally included based on runtime state
  - Prefix-cache-friendly stable ordering
- [ ] `src/agent/loop.ts` — ReAct master loop:
  - Pre-check + compaction → thinking → self-critique → action → tool execution → post-processing
  - 4 stop conditions: natural completion, budget, stall, parse failures
- [ ] `src/agent/planner.ts` — TODO engine:
  - `plan_task` tool definition (JSON Schema)
  - One-`in_progress`-at-a-time enforcement
  - Injects current TODO into system prompt every iteration
- [ ] `src/agent/retry.ts` — error-classified retry:
  - Retryable: 429, 5xx, timeout
  - Non-retryable: 4xx
  - Jittered exponential backoff
- [ ] `src/agent/budget.ts` — token/cost/iteration/wallclock tracking
- [ ] `src/agent/stall-detector.ts` — 3-identical-call detection
- [ ] `src/agent/types.ts` — `ToolCall`, `Message`, `StopReason`, `AgentEvent`
- [ ] Wire agent loop into `src/cli/factory.ts` (replace Phase 1 stub)
- [ ] ≥80% unit test coverage on `src/agent/`
- [ ] Integration test: stubbed GLM endpoint + real loop execution
- [ ] ADR-0009 (single-threaded loop over multi-agent DAGs)
- [ ] ADR-0010 (defensive JSON parsing for tool calls)
- [ ] ADR-0011 (stall detection prevents $47K runaway)

## Steps (P2.x)

2.1 Write `src/agent/types.ts` — `ToolCall`, `Message`, `StopReason`, `AgentEvent`, `ConversationState`
2.2 Write `src/agent/json-repair.ts` — defensive JSON parser for tool-call arguments
2.3 Write `src/agent/glm-client.ts` — `GLMClient` class with streaming
2.4 Write `src/agent/system-prompt.ts` — `SystemPromptAssembler` with fragment list
2.5 Write `src/agent/planner.ts` — `Planner` + `PLAN_TASK_TOOL` schema
2.6 Write `src/agent/budget.ts` — `BudgetTracker` (tokens, cost, iterations, wallclock)
2.7 Write `src/agent/stall-detector.ts` — `StallDetector` (3 identical calls)
2.8 Write `src/agent/retry.ts` — `callWithRetry()` with jittered backoff
2.9 Write `src/agent/stop-engine.ts` — `shouldStop()` dispatch (4 conditions)
2.10 Write `src/agent/loop.ts` — `AgentLoop` master loop
2.11 Write integration test: stubbed GLM endpoint via `msw` + real loop
2.12 Write `tests/integration/agent-loop.test.ts` — happy path + budget stop + stall stop
2.13 Write ADRs 0009-0011
2.14 Update `src/cli/factory.ts` to use real `AgentLoop`
2.15 Update `src/cli/main.ts` to print streamed responses to stdout (Phase 2 plain mode)
2.16 Verify ≥80% coverage on `src/agent/`
2.17 Worklog entry for Phase 2

## Key Engineering Decisions

- **Single-threaded loop.** Not multi-agent. Multi-agent burns ~15× tokens,
  has 37% coordination failure rate. Phase 13 (M7) adds opt-in parallel
  subagents.
- **Reasoning-effort router.** `high` (default) vs `max` (for tasks matching
  `complexTriggers`). Halves routine token cost.
- **Prefix-cache-friendly message ordering.** Stable system-prompt
  fragment order, stable message order, variable content at end.
- **Budget defaults.** `maxTokens=800K` (80% of 1M, leaves compaction room),
  `maxCostUsd=$5`, `maxIterations=50`, `maxWallclock=1800s`.
- **Defensive JSON parsing.** Never let raw `JSON.parse` crash the loop.
  The model emits malformed JSON under heavy multi-tool turns.
- **Stall detection at 3 identical calls.** Prevents the Nov 2025
  LangChain incident (11-day runaway, $47K bill).

## Dependencies to add

- `msw` (MIT) — mock service worker for HTTP mocking in tests
- `@iarna/toml` (MIT) — full TOML parser (replaces Phase 1 hand-rolled)

(Both are SBOM-clean; see ADR-0004.)
