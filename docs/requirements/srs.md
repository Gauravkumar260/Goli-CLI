# Software Requirements Specification (SRS) — Goli-CLI

> **Standard:** IEEE 830-1998 / ISO/IEC/IEEE 29148:2018
> **Status:** v0.3 (Draft for 0.3.0-phase2-studio)
> **Last updated:** 2026-07-25

## 1. Introduction

### 1.1 Purpose

This SRS specifies the functional and non-functional requirements for
Goli-CLI v1.0. It is the authoritative reference for what the system must
do. Every requirement has a unique ID (`FR-NNN` for functional,
`NFR-NNN` for non-functional) and is traceable to tests in the
repository.

### 1.2 Scope

Goli-CLI is a terminal-based AI coding agent. The SRS covers:

- The CLI/TUI surface (`@goli-cli/cli`).
- The agent core, providers, tools, sandbox, memory, and orchestration
  (`@goli-cli/core`).
- The evals harness (`@goli-cli/evals`).
- The VS Code extension (`@goli-cli/vscode-ext`, experimental).
- The web console (`@goli-cli/studio`, experimental, **not** part of
  v1.0 SRS scope — see its own README).

### 1.3 Definitions, acronyms, abbreviations

| Term            | Definition                                                     |
| --------------- | -------------------------------------------------------------- |
| ADR             | Architectural Decision Record                                  |
| AGENTS.md       | Living-patterns Markdown file read by the agent at runtime     |
| AppMode         | One of `build` / `plan` / `god` / `local-llms`                 |
| FR / NFR        | Functional / Non-Functional Requirement                        |
| Hooks           | Deterministic pre/post-tool callbacks (vs. prompt-only safety) |
| JSONL           | JSON Lines — one JSON object per line, append-only             |
| MCP             | Model Context Protocol                                         |
| Permission mode | One of `ask` / `yolo` / `plan`                                 |
| ReAct           | Reason + Act agent loop pattern                                |
| SICA            | Self-Improvement through Critique and Adjustment               |
| TUI             | Terminal User Interface                                        |
| TTI             | Time-To-Interactive                                            |

### 1.4 References

- [IEEE 830-1998](https://standards.ieee.org/ieee/830/1998/)
- [ISO/IEC/IEEE 29148:2018](https://www.iso.org/standard/45162.html)
- [Diátaxis documentation framework](https://diataxis.fr/)
- [MADR — Markdown Any Decision Records](https://adr.github.io/madr/)
- [Contributor Covenant 2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct.html)

### 1.5 Overview

Section 2 describes the system in narrative form. Section 3 lists
functional requirements. Section 4 lists non-functional requirements.
Section 5 is the requirements traceability matrix.

## 2. Overall description

### 2.1 Product perspective

Goli-CLI is a standalone CLI tool distributed via `npm install -g
goli-cli` and `npx goli-cli`. It is an npm workspaces monorepo. The
product consists of five packages: `core`, `cli`, `evals`, `vscode-ext`
(experimental), and `studio` (experimental).

### 2.2 Product functions

The system provides:

1. A terminal-based conversational interface for coding tasks.
2. A multi-provider LLM client (Anthropic, OpenAI, Gemini, Ollama).
3. A deterministic tool layer (read, write, edit, bash, grep, glob, …).
4. A kernel-enforced sandbox for tool execution.
5. A multi-agent swarm for complex tasks (11 agents).
6. A 3-tier memory system with self-improvement (SICA).
7. An evals harness (SWE-bench, semantic-error-rate, redteam).
8. An audit log and SBOM gate for enterprise compliance.

### 2.3 User characteristics

Users are professional software engineers comfortable with the terminal,
with at least 2 years of Git experience. They may or may not have ML
background; the SICA and trajectory export features are designed for ML
engineers but not required for normal use.

### 2.4 Constraints

- Node.js ≥ 20.18 (LTS).
- TypeScript 5.7+ strict mode.
- MIT license; SBOM gate forbids GPL/AGPL dependencies.
- No closed-vendor ToS lock-in for the default configuration.
- The CLI surface is terminal-only (no GUI for v1.0).

### 2.5 Assumptions and dependencies

- The user has a working LLM provider (Ollama Cloud account, Anthropic
  API key, OpenAI API key, or local Ollama).
- The user has `ripgrep 14+` installed (bundled fallback provided).
- The user has `git` installed for checkpointing.
- macOS users have Xcode CLT for Seatbelt; Linux users have `libcap`
  for Landlock; Windows users have WSL2 for cgroups.

### 2.6 Apportioning of requirements

| Package      | v1.0 required? | Notes                                    |
| ------------ | -------------- | ---------------------------------------- |
| `core`       | ✅             | All FR/NFR in §3, §4                     |
| `cli`        | ✅             | All FR/NFR in §3, §4                     |
| `evals`      | ✅             | Subset (SWE-bench + semantic-error-rate) |
| `vscode-ext` | ❌ (post-1.0)  | Best-effort; not in SRS scope            |
| `studio`     | ❌ (post-1.0)  | Best-effort; not in SRS scope            |

## 3. Functional requirements

> Each requirement ID is stable. Once assigned, IDs are never re-used.

### 3.1 Agent loop

| ID     | Requirement                                                                                                                                   | Priority |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| FR-001 | The system SHALL implement a ReAct agent loop that streams tokens, parses tool calls, executes them, and feeds results back to the model.     | Must     |
| FR-002 | The system SHALL be single-threaded within one agent run; concurrency is cooperative via `Promise.all` and `AbortController`.                 | Must     |
| FR-003 | The system SHALL support cancellation at any point via Ctrl-C; cancellation SHALL propagate to in-flight tool calls.                          | Must     |
| FR-004 | The system SHALL detect and break out of tool-call loops (threshold ≥ 5 repeated calls) and content loops (threshold ≥ 10 repeated messages). | Must     |
| FR-005 | The system SHALL detect stalls (no token for ≥ 30s while the loop is running) and emit a stall event.                                         | Should   |
| FR-006 | The system SHALL retry transient provider errors (5xx, 429, network) with exponential backoff and jitter, up to 5 attempts.                   | Must     |
| FR-007 | The system SHALL classify provider errors as terminal, retryable, or validation-required, and behave accordingly.                             | Must     |
| FR-008 | The system SHALL repair malformed JSON in tool-call arguments (best-effort) before failing the call.                                          | Should   |

### 3.2 Providers

| ID     | Requirement                                                                                                                                                   | Priority |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| FR-010 | The system SHALL support the following providers: Anthropic, OpenAI, Google Gemini, Ollama (local + cloud), and a Mock provider for tests.                    | Must     |
| FR-011 | The default model SHALL be `ollama/gpt-oss:120b` (open-weight) unless overridden by `GOLI_DEFAULT_MODEL`.                                                     | Must     |
| FR-012 | The system SHALL route prompts to providers based on the configured model string (`anthropic/claude-3-5-sonnet`, `openai/gpt-4o`, `ollama/llama3:70b`, etc.). | Must     |
| FR-013 | The system SHALL support a local-LLMs router that routes based on (1) PII sensitivity, (2) complexity, (3) availability.                                      | Should   |
| FR-014 | The system SHALL implement per-deployment circuit breakers (CLOSED → OPEN → HALF_OPEN → CLOSED) for the local-LLMs router.                                    | Should   |
| FR-015 | The system SHALL redact PII (SSN, email, credit card, IBAN, API key, IPv4) before sending to cloud providers, and restore placeholders in tool results.       | Must     |
| FR-016 | The system SHALL support an OpenAI-compatible client for self-hosted vLLM / LiteLLM endpoints.                                                                | Should   |

### 3.3 Tools

| ID     | Requirement                                                                                                                                                                                                                                         | Priority |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| FR-020 | The system SHALL provide the following built-in tools: `read_file`, `write_file`, `edit_file`, `list_directory`, `bash`, `grep`, `glob`, `web_search`, `web_fetch`, `ask_user`, `todo_write`, `spawn_subagent`, `notebook_edit`, `lsp_*`, `spec_*`. | Must     |
| FR-021 | The system SHALL enforce an allowlist first for `bash` commands; non-allowlisted commands require explicit user approval.                                                                                                                           | Must     |
| FR-022 | The system SHALL support diff-first editing: `edit_file` produces a unified diff that the user reviews before applying.                                                                                                                             | Must     |
| FR-023 | The system SHALL truncate tool results to a configurable budget (default 30 KB) with a "[truncated]" marker.                                                                                                                                        | Must     |
| FR-024 | The system SHALL support parallel tool execution when the model emits multiple tool calls in one turn.                                                                                                                                              | Must     |
| FR-025 | The system SHALL support a self-registering tool registry so MCP servers and plugins can add tools at runtime.                                                                                                                                      | Must     |
| FR-026 | The system SHALL stream tool output to the TUI in real-time (line-buffered) for long-running tools.                                                                                                                                                 | Should   |

### 3.4 Hooks

| ID     | Requirement                                                                                                                                                                            | Priority |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| FR-030 | The system SHALL fire hooks at the following events: `BeforeTool`, `AfterTool`, `BeforeAgent`, `AfterAgent`, `SessionStart`, `SessionEnd`, `PreCompress`, `BeforeModel`, `AfterModel`. | Must     |
| FR-031 | The system SHALL provide built-in hooks: `block-writes-outside-workspace`, `block-destructive`, `block-secrets`, `auto-format`, `git-checkpoint`, `audit-log`.                         | Must     |
| FR-032 | Hooks SHALL be deterministic (TypeScript functions), not prompt-based.                                                                                                                 | Must     |
| FR-033 | A hook SHALL be able to block a tool call, modify its input, or modify its output.                                                                                                     | Must     |

### 3.5 Sandbox

| ID     | Requirement                                                                                                                 | Priority |
| ------ | --------------------------------------------------------------------------------------------------------------------------- | -------- |
| FR-040 | The system SHALL enforce a kernel-level sandbox on Linux (Landlock), macOS (Seatbelt), and Windows (Job Object).            | Must     |
| FR-041 | The sandbox SHALL restrict filesystem writes to the workspace root.                                                         | Must     |
| FR-042 | The sandbox SHALL block all network egress from tool execution (with an explicit allowlist for `web_search` / `web_fetch`). | Must     |
| FR-043 | The system SHALL defend against TOCTOU (time-of-check/time-of-use) attacks on path validation.                              | Must     |
| FR-044 | The system SHALL support a `--no-sandbox` flag for development use only; it SHALL print a warning when used.                | Should   |

### 3.6 Memory

| ID     | Requirement                                                                                                                   | Priority |
| ------ | ----------------------------------------------------------------------------------------------------------------------------- | -------- |
| FR-050 | The system SHALL implement 3-tier memory: ephemeral (in-process), persistent (JSONL on disk), external (vector plugin).       | Must     |
| FR-051 | Sessions SHALL be stored as JSONL files under `~/.goli/sessions/`, one file per session, append-only.                         | Must     |
| FR-052 | The system SHALL support session search (full-text + semantic) across all stored sessions.                                    | Should   |
| FR-053 | The system SHALL support session resume and branch (`goli --resume <id>`, `goli --branch <id>`).                              | Must     |
| FR-054 | The system SHALL support context compaction at 70% of the context window (`docs/decisions/0023-compaction-at-70-percent.md`). | Must     |

### 3.7 SICA (self-improvement)

| ID     | Requirement                                                                                                                                                     | Priority |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| FR-060 | The system SHALL implement a SICA loop: overseer criticizes the agent's behavior, the agent adjusts, the overfit-detector prevents overfitting to the overseer. | Should   |
| FR-061 | The SICA loop SHALL maintain an immutable safety registry: any behavior the overseer flags as unsafe is permanently blocked.                                    | Must     |
| FR-062 | The SICA loop SHALL rate-limit overseer interventions to prevent thrashing.                                                                                     | Must     |

### 3.8 Orchestration (multi-agent)

| ID     | Requirement                                                                                                                                      | Priority |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| FR-070 | The system SHALL support an 11-agent swarm (Scout, Architect, Coder, Reviewer, Tester, Documenter, etc.) orchestrated via a sequential pipeline. | Should   |
| FR-071 | The system SHALL support parallel subagents with isolation (each subagent has its own context window and tool registry).                         | Should   |
| FR-072 | The system SHALL support git worktrees as a concurrency primitive (one worktree per subagent).                                                   | Should   |
| FR-073 | The system SHALL support a cloud execution mode via E2B for long-running subagents.                                                              | Optional |

### 3.9 Evals and observability

| ID     | Requirement                                                                                                              | Priority |
| ------ | ------------------------------------------------------------------------------------------------------------------------ | -------- |
| FR-080 | The system SHALL ship a SWE-bench harness that runs the agent against the SWE-bench task suite and reports a solve rate. | Must     |
| FR-081 | The system SHALL implement a semantic-error-rate metric (LLM-graded pass/fail).                                          | Must     |
| FR-082 | The system SHALL ship a redteam harness using promptfoo.                                                                 | Should   |
| FR-083 | The system SHALL emit OpenTelemetry traces for every agent run, tool call, and provider call.                            | Must     |
| FR-084 | The system SHALL integrate with Langfuse for trajectory visualization.                                                   | Should   |

### 3.10 CLI / TUI

| ID     | Requirement                                                                                       | Priority |
| ------ | ------------------------------------------------------------------------------------------------- | -------- |
| FR-090 | The system SHALL provide a TUI built with Ink v5 + React 19.                                      | Must     |
| FR-091 | The TUI SHALL support 20+ built-in themes (11 dark, 8 light, no-color) and 2 colorblind variants. | Must     |
| FR-092 | The TUI SHALL support a screen-reader mode (`--screen-reader`) with a flattened layout.           | Must     |
| FR-093 | The TUI SHALL support vim mode, kitty keyboard protocol, mouse scroll, and reverse-search.        | Should   |
| FR-094 | The TUI SHALL provide a slash-command palette with custom user commands.                          | Must     |
| FR-095 | The system SHALL provide a headless mode (`goli -p "..." --no-tui`) for scripting.                | Must     |
| FR-096 | The system SHALL provide a structured headless output mode (`--headless-output json`) for CI.     | Must     |

### 3.11 Enterprise compliance

| ID     | Requirement                                                                                                                | Priority |
| ------ | -------------------------------------------------------------------------------------------------------------------------- | -------- |
| FR-100 | The system SHALL generate an SBOM (SPDX JSON) and fail CI if any dependency is GPL/AGPL.                                   | Must     |
| FR-101 | The system SHALL emit an audit log (`--audit-log path`) recording every tool call, permission decision, and provider call. | Must     |
| FR-102 | The system SHALL support a TOML policy file with SHA-256 integrity verification.                                           | Must     |
| FR-103 | The system SHALL support PII gating for cloud providers (see FR-015).                                                      | Must     |
| FR-104 | The system SHALL provide a `legal/` directory with a privacy policy aligned to GDPR and EU AI Act.                         | Must     |

## 4. Non-functional requirements

### 4.1 Performance

| ID      | Requirement                         | Budget                    |
| ------- | ----------------------------------- | ------------------------- |
| NFR-001 | Cold startup (no args)              | ≤ 1.5s wall, ≤ 2.0s CPU   |
| NFR-002 | Idle 5s                             | ≤ 50ms CPU                |
| NFR-003 | Token-bar update                    | ≤ 16ms (1 frame at 60fps) |
| NFR-004 | Heap (idle session)                 | ≤ 100 MB                  |
| NFR-005 | Heap (large chat resume, 1000 msgs) | ≤ 1 GB                    |
| NFR-006 | TTI (10k-file repo indexing)        | ≤ 5s                      |

### 4.2 Security

| ID      | Requirement                                                                                        |
| ------- | -------------------------------------------------------------------------------------------------- |
| NFR-010 | The sandbox SHALL be unescapable on a default-configured OS kernel.                                |
| NFR-011 | The system SHALL NOT execute `bash` commands outside the allowlist without explicit user approval. |
| NFR-012 | The system SHALL NOT transmit PII to cloud providers without redaction.                            |
| NFR-013 | The system SHALL verify the integrity of policy files on every load.                               |
| NFR-014 | The audit log SHALL be append-only and tamper-evident (chained hashes).                            |

### 4.3 Reliability

| ID      | Requirement                                                                            |
| ------- | -------------------------------------------------------------------------------------- |
| NFR-020 | The system SHALL recover from a crash mid-run and resume the session on next start.    |
| NFR-021 | The system SHALL retry transient provider failures (FR-006) without user intervention. |
| NFR-022 | The system SHALL detect and break out of infinite loops (FR-004).                      |
| NFR-023 | The system SHALL checkpoint session state to disk at least every 5 turns.              |

### 4.4 Usability

| ID      | Requirement                                                                                                           |
| ------- | --------------------------------------------------------------------------------------------------------------------- |
| NFR-030 | The TUI SHALL be operable with keyboard only (no mouse required).                                                     |
| NFR-031 | The TUI SHALL meet WCAG 2.1 AA contrast ratios in all themes.                                                         |
| NFR-032 | The TUI SHALL respect `prefers-reduced-motion` (DEMO animations off).                                                 |
| NFR-033 | The CLI SHALL provide `--help` output for every command, with examples.                                               |
| NFR-034 | The CLI SHALL provide exit codes per Unix convention (0 = success, 1 = runtime error, 2 = usage error, 130 = SIGINT). |

### 4.5 Portability

| ID      | Requirement                                                                         |
| ------- | ----------------------------------------------------------------------------------- |
| NFR-040 | The system SHALL run on Linux (glibc 2.31+), macOS (12+), and Windows (10+ / WSL2). |
| NFR-041 | The system SHALL run on Node.js 20.18 LTS and 22 LTS.                               |
| NFR-042 | The system SHALL NOT require a specific shell (bash/zsh/fish/nu all supported).     |
| NFR-043 | The system SHALL provide shell completions for bash, zsh, fish, and PowerShell.     |

### 4.6 Maintainability

| ID      | Requirement                                                                              |
| ------- | ---------------------------------------------------------------------------------------- |
| NFR-050 | The codebase SHALL pass `npm run verify` (typecheck + lint + format + test) on every PR. |
| NFR-051 | Line coverage for `packages/core` and `packages/cli` SHALL be ≥ 80%.                     |
| NFR-052 | Branch coverage for `packages/core` and `packages/cli` SHALL be ≥ 75%.                   |
| NFR-053 | Every exported function SHALL have a TSDoc comment with `@param`, `@returns`, `@throws`. |
| NFR-054 | Every ADR SHALL be referenced by at least one test or source file.                       |

### 4.7 Internationalization

| ID      | Requirement                                                                                            |
| ------- | ------------------------------------------------------------------------------------------------------ |
| NFR-060 | The TUI SHALL support locale catalogs in `en`, `de`, `es`, `ja`, `zh-CN`.                              |
| NFR-061 | Locale selection SHALL be automatic from `LANG` / `LC_ALL`, with `--locale` override.                  |
| NFR-062 | All user-facing strings SHALL be looked up via the `t()` function; hardcoded strings are a lint error. |

## 5. Requirements traceability matrix

> Format: `<req-id>` → `<test file>:<test name>` (or `PLANNED` if not yet
> implemented). This section is regenerated by
> `scripts/gen-traceability-matrix.ts` (planned).

| Req               | Test                                                                       | Status     |
| ----------------- | -------------------------------------------------------------------------- | ---------- |
| FR-001            | `tests/integration/agent-loop-e2e.test.ts`                                 | ✅         |
| FR-002            | `tests/unit/next-gen-engine.test.ts` (single-threaded invariant)           | ✅         |
| FR-003            | `tests/integration/crash-recovery.test.ts` (SIGINT)                        | ✅         |
| FR-004            | `tests/unit/loop-detector-t065.test.ts`                                    | ✅         |
| FR-005            | `tests/unit/stall-detector.test.ts`                                        | ✅         |
| FR-006            | `tests/unit/retry.test.ts`                                                 | ✅         |
| FR-007            | `tests/unit/error-classifier.test.ts`                                      | ✅         |
| FR-008            | `tests/unit/json-repair.test.ts`                                           | ✅         |
| FR-010            | `tests/unit/provider-integration.test.ts`                                  | ✅         |
| FR-013            | `tests/unit/local-llms-router.test.ts`                                     | ✅         |
| FR-015            | `tests/unit/local-llms-router.test.ts` (PII redaction)                     | ✅         |
| FR-020            | `tests/unit/tool-registry.test.ts`                                         | ✅         |
| FR-021            | `tests/unit/allowlist-t094.test.ts`                                        | ✅         |
| FR-022            | `tests/unit/diff-first-editing.test.ts`                                    | ✅         |
| FR-023            | `tests/unit/truncation.test.ts`                                            | ✅         |
| FR-024            | `tests/unit/parallel-execution.test.ts`                                    | ✅         |
| FR-025            | `tests/unit/self-registering-registry.test.ts`                             | ✅         |
| FR-030            | `tests/unit/hook-engine.test.ts`                                           | ✅         |
| FR-031            | `tests/unit/builtin-hooks.test.ts`                                         | ✅         |
| FR-040            | `tests/unit/toctou-path-safety.test.ts` + `tests/unit/path-safety.test.ts` | ✅         |
| FR-041            | `tests/unit/build-mode-permission.test.ts`                                 | ✅         |
| FR-042            | `tests/unit/network-egress.test.ts`                                        | ✅         |
| FR-050            | `tests/unit/memory-system.test.ts`                                         | ✅         |
| FR-051            | `tests/unit/session-jsonl-store.test.ts`                                   | ✅         |
| FR-053            | `tests/unit/session-search-store.test.ts`                                  | ✅         |
| FR-054            | `tests/unit/advanced-compression.test.ts`                                  | ✅         |
| FR-060            | `tests/unit/sica.test.ts`                                                  | ✅         |
| FR-070            | `tests/unit/orchestration.test.ts`                                         | ✅         |
| FR-071            | `tests/unit/parallel-subagents.test.ts`                                    | ✅         |
| FR-080            | `tests/integration/core-tools.test.ts` (subset)                            | ⚠️ Partial |
| FR-081            | `tests/unit/evals-observability.test.ts`                                   | ✅         |
| FR-083            | `tests/unit/callback-streaming.test.ts`                                    | ✅         |
| FR-090            | `tests/unit/tui-smoke.test.tsx`                                            | ✅         |
| FR-091            | `tests/unit/skin-themes-t043.test.ts`                                      | ✅         |
| FR-092            | `tests/unit/screen-reader-layout.test.tsx`                                 | ✅         |
| FR-095            | `tests/unit/headless-output.test.ts`                                       | ✅         |
| FR-096            | `tests/unit/headless-output.test.ts`                                       | ✅         |
| FR-100            | `scripts/check-sbom.sh` + `tests/unit/lint-enforcement.test.ts`            | ✅         |
| FR-101            | `tests/unit/audit-log.test.ts`                                             | ✅         |
| FR-102            | `tests/unit/policy-integrity-t064.test.tsx`                                | ✅         |
| NFR-001 / NFR-002 | `tests/unit/perf-baseline.test.ts`                                         | ✅         |
| NFR-030           | `tests/unit/screen-reader-layout.test.tsx`                                 | ✅         |
| NFR-031           | `tests/unit/a11y-contrast-fixes.test.ts` + `scripts/a11y-audit.ts`         | ✅         |
| NFR-034           | `tests/unit/cli-args.test.ts`                                              | ✅         |
| NFR-050           | CI pipeline (`npm run verify`)                                             | ✅         |
| NFR-060           | `tests/unit/i18n.test.ts`                                                  | ✅         |

## 6. Revision history

| Date       | Version | Author          | Change                                                                         |
| ---------- | ------- | --------------- | ------------------------------------------------------------------------------ |
| 2026-07-07 | v0.1    | Lead Maintainer | Initial SRS for 0.1.0                                                          |
| 2026-07-13 | v0.2    | Lead Maintainer | Updated for 0.2.0 (Phase 2 ship); added FR-013..016, FR-060..062, FR-070..073  |
| 2026-07-25 | v0.3    | Lead Maintainer | Added Goli Studio reference (out of v1.0 scope); refreshed traceability matrix |
