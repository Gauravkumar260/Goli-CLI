# CLAUDE.md — `@goli-cli/evals`

> **Audience:** Claude Code working in `packages/evals/`.
> **Parent:** [`/CLAUDE.md`](../../../CLAUDE.md).

## Package purpose

`@goli-cli/evals` is the eval harness — it runs the agent against
benchmarks (SWE-bench, semantic-error-rate, redteam) and produces JSON
reports. It is used in CI to catch regressions and locally to measure
the impact of a change.

The package imports `@goli-cli/core` for the agent loop. It does not
import `@goli-cli/cli` (evals run headless).

## Critical files

| File                              | Purpose                            |
| --------------------------------- | ---------------------------------- |
| `src/index.ts`                    | Public barrel.                     |
| `src/swebench/harness.ts`         | SWE-bench harness.                 |
| `src/semantic-check/evaluator.ts` | LLM-graded pass/fail.              |
| `src/redteam/promptfoo.ts`        | Prompt injection tests.            |
| `src/regression/gate.ts`          | Block releases on regressions.     |
| `src/types.ts`                    | Eval types (Task, Result, Report). |

## Eval workflow

```
1. Pick a task (SWE-bench / redteam / regression).
2. Spin up a clean workspace (git worktree).
3. Run the agent with the task prompt (headless mode).
4. Capture the agent's tool calls + final answer.
5. Grade:
   - SWE-bench: run the test suite; pass/fail.
   - Semantic: LLM-graded pass/fail with rubric.
   - Redteam: did the agent execute the injected command?
6. Write a JSON report to evals/output/<suite>/<timestamp>.json.
7. Compare against the baseline; fail CI on regression.
```

## Architecture rules

1. **Evals run headless.** Never spin up the TUI in an eval.
2. **Evals are deterministic** given the same model + seed. The Mock
   provider is used for unit tests; real providers are used for
   regression tests.
3. **The regression gate is binary.** If the solve rate drops > 2
   percentage points from the baseline, the gate fails. No "soft"
   failures.
4. **Redteam evals are isolated.** They run in a separate container
   with no network access (the agent under test should not be able to
   exfiltrate the prompt injection).

## Patterns to follow

- **Use the Mock provider** for unit tests. It's deterministic and
  doesn't burn API quota.
- **Capture trajectories** — every eval run produces a JSONL trajectory
  that can be replayed for debugging or used for fine-tuning.
- **Pin model versions** — the baseline is recorded against a specific
  model version (e.g. `ollama/gpt-oss:120b@2026-07-01`). Re-run
  baselines when the model is updated.

## Common pitfalls

- **Forgetting to clean the worktree** — always `git worktree remove`
  in a `finally` block. Leaked worktrees fill the disk.
- **Running redteam evals with network access** — the prompt injection
  could exfiltrate the test prompt. Always run in a network-isolated
  container.
- **Comparing against a stale baseline** — the baseline is in
  `bench/baseline.json`. Update it deliberately, never accidentally.

## Tests

- Unit tests for the harness itself (`*.test.ts`).
- The harness runs against the Mock provider in CI; full SWE-bench runs
  are nightly.

## See also

- [docs/decisions/0031-mini-swe-agent.md](../../../docs/decisions/0031-mini-swe-agent.md)
- [docs/decisions/0032-langfuse-over-langsmith.md](../../../docs/decisions/0032-langfuse-over-langsmith.md)
- [docs/decisions/0033-semantic-error-rate.md](../../../docs/decisions/0033-semantic-error-rate.md)
- [bench/baseline.json](../../../bench/baseline.json) — current
  baselines.
