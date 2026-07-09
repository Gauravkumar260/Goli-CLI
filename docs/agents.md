# Goli-CLI Agents — The 11-Agent Swarm

> Detailed reference for each agent in the Scout → Documenter pipeline. For the high-level architecture, see [Architecture](architecture.md).

## Overview

Goli-CLI decomposes complex software-engineering tasks into 11 specialized agent roles. Each agent is a role-specialized instance of the same `AgentLoop` class, with:
- A **role-specific system prompt** (assembled by `SystemPromptAssembler`)
- A **subset of the tool registry** (e.g., the Security Auditor has `read_file` + `grep` but not `write_file`)
- A **budget allocation** (tokens + cost + iterations)
- A **handoff contract** (what it produces for the next agent)

The pipeline is sequential by default, but the Orchestrator can spawn parallel subagents via `spawn_subagent` for independent subtasks.

## The Pipeline

```
Scout → Researcher → Architect → Planner → Implementer →
Debugger → QA/Tester → Security Auditor → Reviewer →
Orchestrator → Documenter
```

| # | Agent | Role | Key Tools | Handoff |
|---|---|---|---|---|
| 1 | Scout | Explore the repo, identify relevant files | `read_file`, `list_directory`, `grep`, `lsp_references` | File list + relevance map |
| 2 | Researcher | Gather external context | `web_search`, `web_fetch`, `read_file` | Context brief |
| 3 | Architect | Design the solution approach | `read_file`, `lsp_hover`, `spawn_subagent` | Design doc |
| 4 | Planner | Break the design into atomic steps | `todo_write`, `read_file` | TODO list |
| 5 | Implementer | Write the code changes | `write_file`, `edit_file`, `bash` | Diff + file changes |
| 6 | Debugger | Run tests, fix failures | `bash`, `read_file`, `edit_file` | Test results + fixes |
| 7 | QA/Tester | Write new tests, verify edge cases | `write_file`, `bash`, `read_file` | Test suite + coverage |
| 8 | Security Auditor | Check for vulns, secrets, unsafe patterns | `read_file`, `grep`, `bash` (read-only) | Security report |
| 9 | Reviewer | Review the diff for quality | `read_file`, `bash` (`git diff`) | Review comments |
| 10 | Orchestrator | Coordinate handoffs, manage budget | `spawn_subagent`, `todo_write` | Pipeline state |
| 11 | Documenter | Update README, CHANGELOG, inline docs | `write_file`, `edit_file`, `read_file` | Updated docs |

## Agent Details

### 1. Scout

**Role:** Repository reconnaissance. The Scout explores the codebase to identify which files are relevant to the user's task, without making any changes.

**System prompt focus:** "You are a Scout. Your job is to explore the repository and identify the minimal set of files needed to accomplish the task. Do NOT modify any files. Report file paths with a one-line relevance explanation."

**Tools:** `read_file`, `list_directory`, `grep`, `lsp_references`, `lsp_goto_definition`

**Budget:** 10% of total tokens, max 5 iterations

**Handoff:** A structured file list:
```json
{
  "relevant_files": [
    {"path": "src/auth/login.ts", "reason": "Contains the login function to refactor"},
    {"path": "src/auth/session.ts", "reason": "Session management — will be replaced by JWT"},
    {"path": "tests/auth/login.test.ts", "reason": "Existing tests that must still pass"}
  ],
  "irrelevant_dirs": ["node_modules", "dist", "coverage"]
}
```

### 2. Researcher

**Role:** Gather external context. The Researcher uses web search and doc fetching to supplement the codebase context with external knowledge (library docs, API references, prior art).

**System prompt focus:** "You are a Researcher. Your job is to gather external context that will help the Architect design the solution. Use web search for current best practices, library docs, and known pitfalls. Cite your sources."

**Tools:** `web_search`, `web_fetch`, `read_file`

**Budget:** 10% of total tokens, max 5 iterations

**Handoff:** A context brief with citations.

### 3. Architect

**Role:** Design the solution approach. The Architect takes the Scout's file list + the Researcher's context brief and produces a design document.

**System prompt focus:** "You are an Architect. Your job is to design the solution approach. Consider alternatives, trade-offs, and edge cases. Do NOT write implementation code — produce a design doc that the Planner can break into steps."

**Tools:** `read_file`, `lsp_hover`, `spawn_subagent` (for parallel design exploration)

**Budget:** 15% of total tokens, max 8 iterations

**Handoff:** A design document with:
- Problem statement
- Proposed approach (with alternatives considered)
- Affected files + expected changes
- Risks + mitigations

### 4. Planner

**Role:** Break the design into atomic, testable steps. The Planner produces a TODO list that the Implementer executes.

**System prompt focus:** "You are a Planner. Break the design into atomic steps. Each step must be independently verifiable. Use the `todo_write` tool to create the TODO list."

**Tools:** `todo_write`, `read_file`

**Budget:** 5% of total tokens, max 3 iterations

**Handoff:** A TODO list via `todo_write` tool.

### 5. Implementer

**Role:** Write the code changes. The Implementer executes the Planner's TODO list, making file edits and running commands.

**System prompt focus:** "You are an Implementer. Execute the TODO list step by step. After each step, verify the change works before moving to the next. Use `edit_file` for surgical changes, `write_file` for new files."

**Tools:** `write_file`, `edit_file`, `bash` (sandboxed), `read_file`

**Budget:** 30% of total tokens, max 20 iterations

**Handoff:** A diff of all file changes.

### 6. Debugger

**Role:** Run tests and fix failures. The Debugger executes the test suite, identifies failures, and fixes them.

**System prompt focus:** "You are a Debugger. Run the test suite. For each failure, identify the root cause and fix it. Do NOT weaken tests — if a test is wrong, fix the test; if the code is wrong, fix the code."

**Tools:** `bash` (sandboxed), `read_file`, `edit_file`

**Budget:** 15% of total tokens, max 10 iterations

**Handoff:** Green test suite + list of fixes applied.

### 7. QA/Tester

**Role:** Write new tests and verify edge cases. The QA/Tester adds test coverage for the changes.

**System prompt focus:** "You are a QA/Tester. Write tests for the new functionality. Cover happy path, edge cases, and error conditions. Run the full suite to verify no regressions."

**Tools:** `write_file`, `bash` (sandboxed), `read_file`

**Budget:** 10% of total tokens, max 5 iterations

**Handoff:** New test files + updated coverage report.

### 8. Security Auditor

**Role:** Check for security vulnerabilities, secrets, and unsafe patterns. Read-only — no file modifications.

**System prompt focus:** "You are a Security Auditor. Review the diff for: hardcoded secrets, SQL injection, path traversal, unsafe deserialization, missing input validation, and OWASP Top 10 issues. Report findings by severity."

**Tools:** `read_file`, `grep`, `bash` (read-only: `git diff`, `git log`)

**Budget:** 5% of total tokens, max 3 iterations

**Handoff:** A security report with severity ratings.

### 9. Reviewer

**Role:** Review the diff for code quality. The Reviewer checks style, naming, error handling, and adherence to project conventions.

**System prompt focus:** "You are a Reviewer. Review the diff for: code quality, naming conventions, error handling, test coverage, and adherence to project conventions. Be specific — cite line numbers."

**Tools:** `read_file`, `bash` (`git diff`, `git log`)

**Budget:** 5% of total tokens, max 3 iterations

**Handoff:** Review comments with line references.

### 10. Orchestrator

**Role:** Coordinate the pipeline. The Orchestrator manages handoffs, tracks budget, and can spawn parallel subagents for independent subtasks.

**System prompt focus:** "You are the Orchestrator. Coordinate the agent pipeline. Track budget and halt if exceeded. Spawn parallel subagents for independent subtasks via `spawn_subagent`."

**Tools:** `spawn_subagent`, `todo_write`, `read_file`

**Budget:** 5% of total tokens (overhead), max 3 iterations

**Handoff:** Final pipeline state + summary.

### 11. Documenter

**Role:** Update documentation. The Documenter updates README, CHANGELOG, and inline docs to reflect the changes.

**System prompt focus:** "You are a Documenter. Update the README, CHANGELOG, and inline JSDoc/TSDoc comments to reflect the changes. Do NOT modify implementation code — only docs."

**Tools:** `write_file`, `edit_file`, `read_file`

**Budget:** 5% of total tokens, max 3 iterations

**Handoff:** Updated documentation files.

## Parallel Execution

The Orchestrator can spawn parallel subagents for independent subtasks. Example: if the Implementer needs to refactor 3 independent modules, the Orchestrator can spawn 3 Implementer subagents in parallel.

```
Orchestrator
    ├── spawn_subagent(Implementer, "refactor auth/")
    ├── spawn_subagent(Implementer, "refactor user/")
    └── spawn_subagent(Implementer, "refactor api/")
```

Each subagent has its own budget and tool subset. Results are merged by the Orchestrator.

## Budget Allocation

The default budget split (configurable in `config/default.toml`):

| Agent | Token Budget | Max Iterations |
|---|---|---|
| Scout | 10% | 5 |
| Researcher | 10% | 5 |
| Architect | 15% | 8 |
| Planner | 5% | 3 |
| Implementer | 30% | 20 |
| Debugger | 15% | 10 |
| QA/Tester | 10% | 5 |
| Security Auditor | 5% | 3 |
| Reviewer | 5% | 3 |
| Orchestrator | 5% | 3 |
| Documenter | 5% | 3 |

Total: 100% of the configured `budgetTokens` (default: 2M tokens).

## See Also

- [Architecture](architecture.md) — module map + agent loop internals
- [API Reference](api/_generated/index.html) — `AgentLoop`, `SystemPromptAssembler`, `ToolRegistry`
- `packages/core/src/orchestration/swarm-pipeline.ts` — pipeline implementation
- `packages/core/src/orchestration/types.ts` — agent role types
