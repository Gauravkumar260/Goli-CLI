# Test Strategy — Goli-CLI

> **Status:** v0.3
> **Companion to:** [Test Plan](test-plan.md) · [QA Strategy](qa-strategy.md)

The test strategy describes **how** we test, not **what** we test
(that's the test plan) or **why we test the way we do** (that's the QA
strategy). It's the playbook for an engineer writing or reviewing
tests.

## 1. Testing principles

### 1.1 Test behavior, not implementation

Tests should assert what the code does, not how it does it. A test
that asserts "the agent loop calls `provider.chat` with these exact
arguments" is brittle — it breaks when we refactor the call site. A
test that asserts "the agent loop produces these tool calls given
this prompt" is robust.

**Anti-pattern:** asserting on the internal state of a function.
**Pattern:** asserting on the observable output of a function.

### 1.2 Tests are documentation

A new contributor should be able to read a test and understand what
the unit under test does. Test names are sentences:
`it('returns "restricted" when the prompt contains an SSN')`. Test
bodies are minimal — set up, call, assert. If a test is hard to read,
the unit under test is probably hard to use.

### 1.3 One assertion per test (when possible)

A test with one assertion has one reason to fail. A test with ten
assertions has ten. When the test fails, you don't know which
assertion broke. If you must have multiple assertions, group them
with a comment.

### 1.4 Tests are fast

A unit test that takes >100ms is a smell. The whole unit test suite
should run in <30s. Slow tests get skipped, and skipped tests don't
catch regressions.

If a test is slow because it's waiting for I/O, mock the I/O. If
it's slow because it's CPU-bound, move it to an integration test.

### 1.5 Tests are deterministic

A test that passes on Tuesday and fails on Wednesday is worse than no
test at all. Sources of non-determinism:

- Real time (use `vi.useFakeTimers()`).
- Random numbers (use a seeded RNG).
- Network (mock it).
- Filesystem ordering (sort before comparing).
- Concurrent execution (use `Promise.all` deterministically, or
  serialize).

## 2. Test pyramid

Goli-CLI follows the classic test pyramid:

```
              ┌──────────┐
              │   E2E    │  ~10 tests
              ├──────────┤
              │ Integration│  ~50 tests
              ├──────────┤
              │   Unit   │  ~3000 tests
              └──────────┘
```

- **Unit tests** are the foundation. Fast, deterministic, exhaustive.
  Colocated with source (`loop.ts` + `loop.test.ts`).
- **Integration tests** cover multi-module flows. Slower (may spin up
  a real Prisma DB, a real socket.io server, etc.). Live in
  `tests/integration/`.
- **E2E tests** cover the full system. Slowest (Docker container,
  real filesystem, real network mock). Live in `tests/e2e-docker/`.

## 3. What to unit-test

### 3.1 Pure functions

Every pure function gets unit tests for:

- Happy path (1-2 tests).
- Edge cases (empty input, null/undefined, max-size, off-by-one).
- Error cases (invalid input, abort signal).

### 3.2 State machines

State machines get tested by enumerating all transitions:

```typescript
describe("TurnStateMachine", () => {
  it.each([
    ["idle", "streaming", "token"],
    ["streaming", "tool_running", "tool_start"],
    ["tool_running", "permission_pending", "permission_request"],
    ["permission_pending", "tool_running", "permission_allow"],
    // ... every legal transition
  ])("transitions from %s to %s on %s", (from, to, event) => {
    // ...
  });

  it.each([
    ["idle", "tool_running"], // illegal — must go through streaming
    ["permission_pending", "idle"], // illegal — must resolve first
    // ... every illegal transition
  ])("does not transition from %s to %s", (from, to) => {
    // ...
  });
});
```

### 3.3 Hooks

Hooks are tested with a mock tool context:

```typescript
describe("block-writes-outside-workspace", () => {
  it("blocks writes outside the workspace", async () => {
    const result = await hook.run({
      input: { path: "/etc/passwd", content: "..." },
      ctx: mockToolContext({ workspaceRoot: "/home/user/project" }),
    });
    expect(result).toEqual({
      action: "block",
      reason: "path is outside the workspace",
    });
  });
});
```

### 3.4 Tools

Tools are tested with a mock sandbox and a mock logger:

```typescript
describe("read_file", () => {
  it("reads a file inside the workspace", async () => {
    const result = await read_file.execute(
      { path: "src/foo.ts" },
      mockToolContext({ workspaceRoot: "/home/user/project" }),
    );
    expect(result.ok).toBe(true);
    expect(result.content).toContain("export function foo()");
  });

  it("blocks reads outside the workspace", async () => {
    const result = await read_file.execute(
      { path: "/etc/passwd" },
      mockToolContext({ workspaceRoot: "/home/user/project" }),
    );
    expect(result.ok).toBe(false);
    expect(result.content).toMatch(/outside the workspace/);
  });
});
```

## 4. What to integration-test

### 4.1 Agent loop end-to-end

`tests/integration/agent-loop-e2e.test.ts` runs the full agent loop
with a Mock provider and asserts the sequence of events:

```typescript
it("streams tokens, calls a tool, and emits a final message", async () => {
  const events = [];
  for await (const event of loop.run({ prompt: "read foo.ts" })) {
    events.push(event);
  }
  expect(events).toMatchObject([
    { type: "agent:start" },
    { type: "agent:token", text: "Reading" },
    { type: "agent:token", text: " foo" },
    { type: "agent:token", text: "." },
    { type: "agent:token", text: "ts" },
    { type: "agent:tool_start", name: "read_file" },
    { type: "agent:tool_end", result: { ok: true } },
    { type: "agent:final" },
    { type: "agent:end" },
  ]);
});
```

### 4.2 Sandbox + tool

`tests/integration/core-tools.test.ts` runs each tool with the real
sandbox and asserts the sandbox enforces its invariants.

### 4.3 Crash recovery

`tests/integration/crash-recovery.test.ts` kills the agent mid-run
and asserts the session can be resumed.

## 5. What to e2e-test

### 5.1 Full CLI run

`tests/e2e-docker/run-docker-e2e.sh` runs `goli -p "..."` in a Docker
container and asserts the JSON output matches expectations.

### 5.2 API server

`tests/e2e/api-server.test.ts` starts the API server and asserts
endpoints respond correctly.

## 6. Performance testing

Perf tests live in `tests/integration/perf-baseline.test.ts`. They assert:

- Cold startup ≤ 1.5s wall, ≤ 2.0s CPU.
- Idle 5s ≤ 50ms CPU.
- Token-bar update ≤ 16ms.
- Heap (idle) ≤ 100 MB.

Perf tests run on a dedicated runner (not shared with other CI jobs)
for stable numbers. ±15% tolerance; if a test exceeds tolerance, the
`deflake.js` script reruns it up to 3 times.

## 7. Accessibility testing

### 7.1 Contrast

`scripts/a11y-audit.ts` checks every theme against WCAG 2.1 AA
contrast ratios. Run with `npm run a11y:audit`.

### 7.2 Keyboard navigation

`apps/cli/__tests__/screen-reader-layout.test.tsx` asserts every interactive
element has a keyboard equivalent.

### 7.3 Screen reader

`apps/cli/__tests__/screen-reader-layout.test.tsx` asserts the screen-reader
layout is linear (no spinners, no progress bars, no alt-screen).

## 8. Security testing

### 8.1 Sandbox escape

`packages/sandbox/__tests__/toctou-path-safety.test.ts` and
`packages/tool-system/__tests__/path-safety.test.ts` assert the sandbox blocks path
traversal and TOCTOU attacks.

### 8.2 Prompt injection

`tests/integration/agent-loop-e2e.test.ts` includes a prompt
injection fixture (a tool result containing "ignore previous
instructions") and asserts the agent doesn't comply.

### 8.3 Network egress

`packages/sandbox/__tests__/network-egress.test.ts` asserts the sandbox blocks
outbound network from `bash`, and allows it for `web_fetch`.

## 9. Eval testing

### 9.1 SWE-bench

`packages/evals/src/swebench/harness.ts` runs the agent against
SWE-bench tasks. Baseline: ≥ 30% solve rate on SWE-bench Lite.

### 9.2 Semantic error rate

`packages/evals/src/semantic-check/evaluator.ts` uses an LLM to
grade agent outputs against a rubric. Baseline: ≤ 5% semantic error
rate on the regression suite.

### 9.3 Redteam

`packages/evals/src/redteam/promptfoo.ts` runs prompt injection
tests. Baseline: 0% successful injections.

## 10. Test review checklist

When reviewing a PR, check:

- [ ] New code has tests (unit, integration, or e2e as appropriate).
- [ ] Tests follow the naming convention (`it('does X when Y')`).
- [ ] Tests are deterministic (no real time, no random, no network).
- [ ] Tests are fast (<100ms each for unit, <5s for integration).
- [ ] Tests cover edge cases (empty, null, max-size, off-by-one).
- [ ] Tests cover error cases (invalid input, abort, network failure).
- [ ] Coverage ≥ 80% for `core` and `cli` (diff-coverage enforced).
- [ ] No `console.log` in tests (use the test framework's logging).
- [ ] No `@ts-ignore` in tests.
- [ ] Test file is colocated with source (`<name>.test.ts`).

## 11. See also

- [Test Plan](test-plan.md) — the _what_.
- [QA Strategy](qa-strategy.md) — the _why_.
- [Coverage report](../coverage-report.md) — current numbers.
- [STYLEGUIDE.md §6 Testing](../../STYLEGUIDE.md) — testing rules in
  the style guide.
