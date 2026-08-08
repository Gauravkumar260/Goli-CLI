# Test Plan — Goli-CLI

> **Standard:** IEEE 829-2008
> **Status:** v0.3 (Draft for `0.3.0-phase2-studio`)
> **Last updated:** 2026-07-25

## 1. Introduction

### 1.1 Purpose

This test plan describes the testing approach for Goli-CLI v1.0. It
covers unit, integration, e2e, performance, accessibility, security,
and eval testing.

### 1.2 Scope

This plan covers all five packages (`core`, `cli`, `evals`,
`vscode-ext`, `studio`). The `vscode-ext` and `studio` packages are
experimental; their test coverage targets are lower (see §5).

### 1.3 Definitions

- **Unit test** — tests a single function or class in isolation.
- **Integration test** — tests multiple modules together.
- **E2E test** — tests the full system (CLI + provider + tools).
- **Perf test** — tests performance budgets (latency, memory, CPU).
- **A11y test** — tests accessibility (contrast, keyboard nav, screen
  reader).
- **Security test** — tests sandbox escape, prompt injection, etc.
- **Eval** — runs the agent against a benchmark (SWE-bench, redteam).

## 2. Test items

| Item                   | Path                         | Test type                |
| ---------------------- | ---------------------------- | ------------------------ |
| `@goli-cli/core`       | `packages/agent-core/src/`         | Unit + integration       |
| `@goli-cli/cli`        | `apps/cli/src/`          | Unit + integration + e2e |
| `@goli-cli/evals`      | `packages/evals/src/`        | Unit + integration       |
| `@goli-cli/vscode-ext` | `apps/vscode-ext/src/`   | Unit (smoke)             |
| `@goli-cli/studio`     | `apps/studio/src/`       | Smoke + manual           |
| Perf baselines         | `bench/baseline.json`        | Perf                     |
| A11y                   | TUI + Studio                 | A11y                     |
| Security               | Sandbox, hooks, allowlist    | Security                 |
| Evals                  | SWE-bench, redteam, semantic | Eval                     |

## 3. Features to be tested

### 3.1 Functional

- Agent loop (ReAct, retry, loop detection, stall detection, JSON
  repair).
- Provider router (Anthropic, OpenAI, Gemini, Ollama, Mock,
  local-LLMs).
- Tools (read_file, write_file, edit_file, bash, grep, glob,
  web_search, web_fetch, ask_user, todo_write, spawn_subagent,
  notebook_edit, lsp__, spec__).
- Hooks (BeforeTool, AfterTool, all 6 built-in hooks).
- Sandbox (Landlock, Seatbelt, cgroups, network filter, path
  validation, TOCTOU defense).
- Approval engine (ask, yolo, plan modes; blast-radius calculator).
- Context engine (tree-sitter indexer, hybrid retrieval, compaction
  at 70%, frozen snapshot injection, footprint ladder).
- Memory (3-tier: ephemeral, persistent JSONL, external vector
  plugin; SICA loop; trajectory curator).
- Orchestration (worktree isolation, task splitter, swarm pipeline,
  parallel subagents).
- Evals (SWE-bench harness, semantic-error-rate, redteam, regression
  gate).
- Observability (OTel tracer, Langfuse client, alerts manager).
- CLI/TUI (Ink v5 + React 19, 20+ themes, screen-reader mode, vim
  mode, slash commands, headless mode).
- i18n (en, de, es, ja, zh-CN catalogs).
- Enterprise (SBOM gate, audit log, policy integrity, PII gating).
- Studio (Next.js 16 web console, socket.io runtime, Prisma +
  SQLite, Demo mode).

### 3.2 Non-functional

- Performance (cold startup ≤ 1.5s, idle 5s ≤ 50ms CPU, token-bar ≤
  16ms, heap ≤ 100 MB).
- Security (sandbox unescapable, allowlist enforced, PII redacted,
  audit log tamper-evident).
- Reliability (crash recovery, retry, loop detection, checkpointing).
- Usability (keyboard-only, WCAG 2.1 AA, prefers-reduced-motion).
- Portability (Linux, macOS, Windows; Node 20.18 + 22 LTS).

## 4. Approach

### 4.1 Test pyramid

```
              ┌──────────┐
              │   E2E    │  ~10 tests (slow, docker required)
              ├──────────┤
              │ Integration│  ~50 tests
              ├──────────┤
              │   Unit   │  ~3000 tests (fast, deterministic)
              └──────────┘
```

The vast majority of tests are unit tests — fast, deterministic,
colocated with source. Integration tests cover multi-module flows
(agent loop end-to-end, sandbox + tool, etc.). E2E tests cover the
full system in a Docker container.

### 4.2 Test runner

All tests use **Vitest 2.x**. Configuration:

- `vitest.config.ts` — unit + integration tests.
- `vitest.e2e.config.ts` — e2e tests (separate because they're slow).

Run:

```bash
npm test                # unit + integration
npm run test:e2e        # e2e (docker required)
npm run test:coverage   # with coverage
npm run test:perf       # perf baselines
```

### 4.3 Mocking

- **Mock provider** — a deterministic LLM provider for unit tests
  (`packages/llm-providers/src/mock.ts`). Never call a real LLM in a
  unit test.
- **`vitest-mock-extended`** — for mocking interfaces.
- **`ink-testing-library`** — for TUI component tests.
- **`@testing-library/react`** — for React component tests (Studio).

### 4.4 Fixtures

- `tests/fixtures/` — small test repos (10-100 files) for tool tests.
- `tests/fixtures/swebench/` — SWE-bench task fixtures.
- `tests/fixtures/redteam/` — prompt injection fixtures.

## 5. Coverage targets

| Package      | Lines | Branches               |
| ------------ | ----- | ---------------------- |
| `core`       | ≥ 80% | ≥ 75%                  |
| `cli`        | ≥ 80% | ≥ 75%                  |
| `evals`      | ≥ 70% | ≥ 65%                  |
| `vscode-ext` | ≥ 50% | ≥ 45% (smoke only)     |
| `studio`     | ≥ 40% | ≥ 35% (smoke + manual) |

Coverage is enforced on **new code only** (diff-coverage) by CI.
Project-wide numbers are informational.

## 6. Test environment

### 6.1 Hardware

- Unit / integration tests: any CI runner (2 vCPU, 4 GB RAM).
- E2E tests: Docker-capable runner (4 vCPU, 8 GB RAM).
- Perf tests: dedicated runner (8 vCPU, 16 GB RAM) for stable
  numbers.
- Eval tests (SWE-bench): GPU runner (1× A100) for the agent under
  test.

### 6.2 Software

- Node.js 20.18 LTS and 22 LTS (test matrix).
- Docker 24+ (for e2e).
- ripgrep 14+ (bundled fallback provided).
- git 2.30+.

### 6.3 Test data

- **No real PII** in test data. Use generated PII (e.g.
  `000-00-0000` for SSN — passes the regex but is not a real SSN).
- **No real API keys.** Use `test-key-...` placeholders.
- **No network access** in unit tests. Mock everything.

## 7. Test schedule

| Phase              | Tests run                                  | Frequency                        |
| ------------------ | ------------------------------------------ | -------------------------------- |
| Pre-commit (local) | Unit tests for changed files               | Every commit (via `lint-staged`) |
| PR CI              | All unit + integration + lint + typecheck  | Every PR push                    |
| Main CI            | All unit + integration + e2e + perf + SBOM | Every merge to `main`            |
| Nightly            | Full eval suite (SWE-bench + redteam)      | Nightly                          |
| Pre-release        | Full eval suite + manual smoke             | Before every release             |

## 8. Deliverables

- `packages/*/__tests__/*.test.ts` and `apps/*/__tests__/*.test.ts` — unit tests (colocated with source).
- `tests/integration/*.test.ts` — integration tests.
- `tests/e2e-docker/` — e2e tests.
- `bench/baseline.json` — perf baselines.
- `docs/coverage-report.md` — coverage report (regenerated weekly).
- `docs/a11y-report.md` — a11y audit (regenerated per release).
- `evals/output/<suite>/<timestamp>.json` — eval reports.

## 9. Risks and mitigations

| Risk                                                     | Mitigation                                                                                            |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Provider flakiness breaks CI                             | Mock provider for unit tests; retry for integration tests; ignore provider failures in e2e (use Mock) |
| Sandbox tests fail on CI runners without kernel features | Skip sandbox tests on runners without Landlock/Seatbelt; document the requirement                     |
| Eval regressions from model updates                      | Pin model versions in baselines; re-baseline deliberately                                             |
| Flaky perf tests                                         | Run perf tests on a dedicated runner; use ±15% tolerance; deflake script                              |
| E2E tests slow CI                                        | Run e2e only on `main` and nightly, not on every PR                                                   |

## 10. Revision history

| Date       | Version | Author          | Change                                               |
| ---------- | ------- | --------------- | ---------------------------------------------------- |
| 2026-07-07 | v0.1    | Lead Maintainer | Initial test plan                                    |
| 2026-07-13 | v0.2    | Lead Maintainer | Updated for 0.2.0 (Phase 2 ship); added eval section |
| 2026-07-25 | v0.3    | Lead Maintainer | Added Studio testing; refreshed coverage targets     |
