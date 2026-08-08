# Goli-CLI Test Coverage Report

> Generated: 2026-07-05 (iteration 13, T-017)
> Last reviewed: 2026-07-13 (current test count: 3,376 — coverage
> percentages below are from the original 2026-07-05 run; rerun
> `npm run test:coverage` for fresh numbers)
> Task: T-017 — Measure test coverage + fix gaps (A4 partial)

## Current State

| Metric     | Actual | Threshold (CI) | A4 Target | Gap    |
| ---------- | ------ | -------------- | --------- | ------ |
| Statements | 65.8%  | 60%            | 80%       | -14.2% |
| Branches   | ~62%   | 60%            | 80%       | -18%   |
| Functions  | ~68%   | 60%            | 80%       | -12%   |
| Lines      | 65.8%  | 60%            | 80%       | -14.2% |

**A4 status: PARTIAL.** Coverage is now measured (`npm run test:coverage`) and a CI threshold is enforced (60% — below current actual, so CI is green). The 80% target requires closing the gaps listed below.

**Current test suite size: 3376 tests** (across unit, integration, and e2e suites), including 17 new provider integration tests added in Loop Run 12 (see `packages/agent-core/__tests__/provider-integration.test.ts`) covering the Ollama/OpenAI/Anthropic/Gemini provider routing, the `ProviderBackedModelClient` adapter, env-var-driven provider selection via `GOLI_DEFAULT_MODEL`, and the sync vs async provider creation paths.

## How to Measure

```bash
npm run test:coverage
```

This runs the full test suite with `--coverage` and writes reports to `coverage/` (text summary to stdout, JSON to `coverage/coverage-final.json`, HTML to `coverage/index.html`).

## Coverage Gaps (sorted by impact)

### Tier 1: Major gaps (< 40% coverage)

| File                                                  | Coverage | Why it's low                                                                          | Fix plan                                                                                          |
| ----------------------------------------------------- | -------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `packages/tool-system/src/mcp/client.ts`               | 3.3%     | MCPClientManager requires a real MCP server to connect to; no mock transport in tests | Add a mock stdio transport test that exercises connect/list-tools/call-tool without a real server |
| `apps/vscode-ext/src/extension.ts`                | 0%       | VS Code extension requires the `vscode` module (only available inside VS Code)        | Mock the `vscode` module in tests, or mark as excluded from coverage                              |
| `apps/vscode-ext/src/agent_panel.ts`              | 0%       | Same as above                                                                         | Same as above                                                                                     |
| `apps/vscode-ext/src/batch_diff.ts`               | 0%       | Same as above                                                                         | Same as above                                                                                     |
| `packages/shared/src/optional-deps.d.ts`          | 0%       | Ambient module declaration — no runtime code                                          | Exclude from coverage (it's a `.d.ts` file, not executable)                                       |
| `packages/tool-system/src/hooks/builtin/checkpoint.ts` | 33.8%    | Checkpoint logic requires a running agent loop to test end-to-end                     | Add unit tests for the checkpoint creation/restore logic in isolation                             |

### Tier 2: Moderate gaps (40-70% coverage)

| File                                                                      | Coverage | Why it's low                                                                       | Fix plan                                                             |
| ------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `packages/tool-system/src/core/web-fetch.ts`                               | 37.7%    | z-ai-web-dev-sdk is optional (not installed in test env); the SDK path is untested | Mock the SDK import and test the happy path + fallback               |
| `packages/tool-system/src/core/web-search.ts`                              | 57%      | Same as web-fetch                                                                  | Same as above                                                        |
| `packages/tool-system/src/hooks/builtin/block-writes-outside-workspace.ts` | 59.4%    | Some edge cases in path validation untested                                        | Add boundary tests for symlink escapes, .. traversal, godMode bypass |
| `packages/shared/src/logger.ts`                                       | 61.5%    | Logger has many code paths (file rotation, lifecycle log, JSON vs text format)     | Add tests for each format + rotation                                 |
| `packages/tool-system/src/core/write-file.ts`                              | 75%      | Auto-format failure path untested                                                  | Add test for formatter failure (file with syntax errors)             |

### Tier 3: Near target (70-80% coverage)

| File                                         | Coverage | Fix plan                                               |
| -------------------------------------------- | -------- | ------------------------------------------------------ |
| `packages/tool-system/src/hooks/engine.ts`    | 74.6%    | Add tests for hook priority ordering + error isolation |
| `packages/tool-system/src/core/spec-write.ts` | 87.9%    | Add test for spec registry update path                 |
| `packages/tool-system/src/core/todo-write.ts` | 83.2%    | Add tests for todo reordering + dependency resolution  |
| `packages/shared/src/errors.ts`          | 85.5%    | Add tests for error chain serialization                |

## CI Integration

The coverage threshold is set in `vitest.config.ts` at 60% (below current actual of 65.8%). This means:

- `npm run test:coverage` exits 0 (CI green)
- Any regression that drops coverage below 60% will fail CI
- The threshold should be raised as coverage improves: 65% → 70% → 75% → 80% (A4 target)

## Path to A4 (80% coverage)

Conservative estimate: **3-5 additional iterations** of focused test-writing:

1. **Iter 14**: Mock the `vscode` module + add vscode-ext unit tests → +3% (vscode-ext is 0% → 50%)
2. **Iter 15**: Add MCPClientManager mock transport tests → +4% (client.ts 3% → 70%)
3. **Iter 16**: Add web-fetch + web-search SDK mock tests → +2%
4. **Iter 17**: Add checkpoint + logger + hook engine tests → +3%
5. **Iter 18**: Add write-file + spec-write + todo-write edge cases → +3%

Projected: 65.8% → ~81% (A4 met)

## CI on 3 OSes (A4 second requirement)

A4 also requires "CI is green on 3 OSes." Currently `.github/workflows/ci.yml` runs on Linux only. Adding macOS + Windows runners requires:

- Adding `os: [ubuntu-latest, macos-latest, windows-latest]` to the CI matrix
- Testing that the sandbox code (cgroups, landlock, seatbelt) degrades gracefully on non-Linux
- Testing that path handling works on Windows (backslashes, drive letters)

This is out of scope for a single iteration but tracked as a follow-up.

## See also

- `vitest.config.ts` — coverage configuration + thresholds
- `package.json` — `test:coverage` script
- `coverage/index.html` — detailed HTML report (generated by `npm run test:coverage`)
