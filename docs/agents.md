# Goli-CLI — 11-Agent Swarm Reference

> The 11-agent swarm pipeline (Scout → Documenter) is the orchestration
> layer that decomposes complex, autonomous software-engineering tasks
> into a parallel-friendly DAG of specialized agents. Each agent owns a
> single responsibility and runs in its own worktree with an independent
> budget, tool whitelist, and approval tier.

This document is the canonical reference for the 11 agents: their roles,
budgets, toolsets, parallel-execution rules, and how they compose into
the swarm pipeline. The runtime definitions live in
`packages/orchestration/src/{types.ts,swarm-pipeline.ts}`.

---

## Agent roster

The 11 agents form a linear pipeline with parallel fan-out at the
research, implementation, and review stages. Each agent produces a
typed artifact that feeds the next stage.

| # | Agent           | Phase        | Tier | Budget (tokens) | Tools (key)                                                   | Parallel? |
|---|-----------------|--------------|------|-----------------|---------------------------------------------------------------|-----------|
| 1 | Scout           | Discovery    | T0   | 8 000           | `read_file`, `list_directory`, `grep`, `glob`                 | yes (×3)  |
| 2 | Researcher      | Discovery    | T0   | 12 000          | `web_search`, `web_fetch`, `read_file`, `lsp_hover`           | yes (×3)  |
| 3 | Architect       | Design       | T0   | 16 000          | `read_file`, `grep`, `lsp_references`, `lsp_diagnostics`      | no        |
| 4 | Planner         | Design       | T0   | 10 000          | `todo_write`, `read_file`                                     | no        |
| 5 | Implementer     | Build        | T1/T2| 32 000          | `edit_file`, `write_file`, `bash`, `notebook_edit`            | yes (×4)  |
| 6 | Debugger        | Build        | T1/T2| 24 000          | `bash`, `read_file`, `edit_file`, `lsp_diagnostics`           | yes (×2)  |
| 7 | QA/Tester       | Verify       | T1   | 20 000          | `bash`, `edit_file`, `read_file`                              | yes (×2)  |
| 8 | Security Auditor| Verify       | T0/T1| 18 000          | `read_file`, `grep`, `bash` (read-only)                       | yes (×2)  |
| 9 | Reviewer        | Verify       | T0   | 16 000          | `read_file`, `grep`, `lsp_references`, `ask_user`             | no        |
| 10| Orchestrator    | Coordination | T0   | 24 000          | `spawn_subagent`, `todo_write`, `ask_user`                    | no        |
| 11| Documenter      | Closure      | T1   | 14 000          | `write_file`, `edit_file`, `read_file`                        | no        |

---

## Per-agent reference

### 1. Scout
The Scout agent performs fast reconnaissance of the repository: file
inventory, dependency graph, hot-spots by churn, and entry-point
identification. It produces a `ScoutReport` artifact consumed by the
Architect and Planner. Scouts run in parallel (up to 3 concurrent)
when the workspace spans multiple top-level packages — each Scout
owns one package.

### 2. Researcher
The Researcher agent gathers external context: library docs, API
references, RFCs, and prior art. It uses `web_search` and `web_fetch`
and produces a `ResearchBrief` with cited URLs and a distilled summary.
Multiple Researchers run in parallel when the task touches several
unfamiliar libraries.

### 3. Architect
The Architect agent owns the high-level design: module boundaries,
data flow, public API contracts, and ADR-level decisions. It consumes
the `ScoutReport` and `ResearchBrief` and produces an `ArchitecturePlan`
that the Planner decomposes into tasks. There is exactly one Architect
per pipeline run (the design must be singular and coherent).

### 4. Planner
The Planner agent decomposes the `ArchitecturePlan` into a DAG of
concrete tasks with explicit dependencies, budgets, and tool
whitelists. It uses `todo_write` to emit the task list and produces a
`TaskGraph` artifact. The Planner is the single source of truth for
what work needs to be done and in what order.

### 5. Implementer
The Implementer agent does the bulk of the code changes. Each
Implementer owns one task from the `TaskGraph` and runs in its own
git worktree (see `orchestration/worktree/isolation.ts`). Up to 4
Implementers run in parallel on independent tasks. Each Implementer
has a per-task budget cap and must request approval for T1/T2 tools
unless the task is in `autoMode`.

### 6. Debugger
The Debugger agent fixes failing tests and runtime errors uncovered
by the QA/Tester. It consumes error output (stack traces, assertion
messages) and uses `bash` to reproduce, then `edit_file` to fix. Up to
2 Debuggers run in parallel when multiple failures are independent.

### 7. QA/Tester
The QA/Tester agent runs the test suite, linter, and type-checker
against each Implementer's branch and reports pass/fail per task. It
does not modify source files except to write or update tests that
cover the new behavior. Up to 2 QA/Testers run in parallel.

### 8. Security Auditor
The Security Auditor agent reviews diffs for vulnerabilities: secret
leakage, path-traversal, command injection, unsafe deserialization,
and overly-broad permissions. It runs `bash` in read-only sandbox mode
and produces a `SecurityReport` with severity-tagged findings.

### 9. Reviewer
The Reviewer agent performs the final code review: style, clarity,
ADR compliance, and architectural coherence. It consumes the diff and
the `ArchitecturePlan` and produces a `ReviewReport` with actionable
feedback. The Reviewer may block the merge by returning `block: true`
on critical findings.

### 10. Orchestrator
The Orchestrator agent coordinates the swarm: it spawns sub-agents
via `spawn_subagent`, tracks their progress, redistributes work on
failure, and aggregates results. The Orchestrator is the only agent
that can spawn other agents (depth limit 3 — see `loop.ts:361`).

### 11. Documenter
The Documenter agent writes the changelog, updates the README and
API docs, and produces a `ChangeSummary` artifact. It runs last in
the pipeline and consumes the merged diff plus the `ReviewReport`.

---

## Budget allocation

The swarm has a total token budget that is allocated across agents
according to their expected workload. The default allocation (sums to
100% of the per-run budget, configurable via `--swarm-budget`):

| Agent           | Token Budget | % of Total | Notes                                              |
|-----------------|--------------|------------|----------------------------------------------------|
| Scout           | 8 000        | 4%         | ×3 parallel = 24 000 max                           |
| Researcher      | 12 000       | 6%         | ×3 parallel = 36 000 max                           |
| Architect       | 16 000       | 8%         | singular                                           |
| Planner         | 10 000       | 5%         | singular                                           |
| Implementer     | 32 000       | 16%        | ×4 parallel = 128 000 max                          |
| Debugger        | 24 000       | 12%        | ×2 parallel = 48 000 max                           |
| QA/Tester       | 20 000       | 10%        | ×2 parallel = 40 000 max                           |
| Security Auditor| 18 000       | 9%         | ×2 parallel = 36 000 max                           |
| Reviewer        | 16 000       | 8%         | singular                                           |
| Orchestrator    | 24 000       | 12%        | singular — includes subagent spawn overhead        |
| Documenter      | 14 000       | 7%         | singular                                           |
| **Total**       | **194 000**  | **100%**   | (parallel agents share a pool, not additive)       |

When the per-run budget is exceeded, the Orchestrator is notified and
may downgrade high-effort agents (e.g., reduce Implementer parallelism
from 4 to 2) or skip optional stages (Security Auditor, Documenter).

---

## Parallel execution

Parallel execution is orchestrated by the Orchestrator via
`spawn_subagent`. Each subagent:

- Gets its own `ConversationState` (independent message history)
- Gets its own `BudgetTracker` (per-task token cap)
- Runs with `godMode: false` regardless of the parent's mode — every
  T1/T2 tool call inside a subagent goes through the approval gate
- Inherits the parent's `requestApproval` callback (so approvals
  surface in the same TUI)
- Has a depth limit of 3 (a subagent may spawn sub-subagents, but
  only up to 3 levels deep — see `loop.ts:361`, `maxSubagentDepth`)

Parallel agents that touch overlapping file paths are serialized by
the `parallel-execution.ts` `PATH_SCOPED_TOOLS` classifier to prevent
write-write conflicts. Read-only tools (T0) always parallelize.

The `spawn_subagent` tool itself is T2 (state-modifying — it spawns a
new process and consumes budget) and requires approval in `build`
mode. In `autoMode`, subagent spawns are auto-approved (along with
other T1 and T2 tools).

---

## Pipeline flow

```
            ┌──── Scout (×3) ────┐
            │                     │
            └── Researcher (×3) ──┤
                                  ▼
                            Architect (×1)
                                  │
                                  ▼
                            Planner (×1)
                                  │
                  ┌───────────────┼───────────────┐
                  ▼               ▼               ▼
            Implementer(×4)  Debugger(×2)   QA/Tester(×2)
                  │               │               │
                  └───────────────┼───────────────┘
                                  ▼
                          Security Auditor (×2)
                                  │
                                  ▼
                            Reviewer (×1)
                                  │
                                  ▼
                            Orchestrator (×1)
                                  │
                                  ▼
                            Documenter (×1)
```

The Orchestrator sits at the coordination layer but is listed last
because it is the *aggregation* point: it spawns the others, tracks
their completion, and hands the final artifact set to the Documenter.

---

## See also

- [docs/architecture.md](architecture.md) — module map and pipeline overview
- [docs/decisions/0039-parallel-subagents.md](decisions/0039-parallel-subagents.md) — ADR for parallel subagent execution
- [docs/decisions/0036-worktree-concurrency-not-security.md](decisions/0036-worktree-concurrency-not-security.md) — worktree isolation rationale
- [packages/orchestration/src/types.ts](../packages/orchestration/src/types.ts) — runtime type definitions
- [packages/orchestration/src/swarm-pipeline.ts](../packages/orchestration/src/swarm-pipeline.ts) — pipeline implementation
