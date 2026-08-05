# Functional Requirements Document (FRD) — Goli-CLI

> **Status:** v0.3
> **Last updated:** 2026-07-25
> **Companion to:** [PRD](prd.md) · [SRS](srs.md)

This document captures Goli-CLI's functional requirements as **user
stories** in the Connextra format (`As a <role>, I want <feature>, so
that <benefit>`), with **acceptance criteria** in Given/When/Then form.
It is the bridge between the PRD's product vision and the SRS's formal
requirements: every story here traces to one or more SRS requirement IDs.

Stories are grouped by epic. Each story has a stable ID (`US-NNN`).

## Epic 1: Agent loop

### US-001 — Stream tokens to the terminal

**As a** user
**I want** the agent's tokens to stream to my terminal as they are
generated
**So that** I see progress instead of waiting 30 seconds for a complete
response.

**Acceptance criteria:**

- Given the agent is generating a response, when the provider emits a
  token, then the TUI renders that token within 50ms.
- Given the user presses Ctrl-C, when the agent is mid-stream, then the
  stream stops within 200ms and the partial response is preserved.
- SRS trace: `FR-001`, `FR-003`, `NFR-002`.

### US-002 — Recover from a transient provider error

**As a** user on a flaky connection
**I want** the agent to retry transient provider errors automatically
**So that** I don't have to re-run the prompt.

**Acceptance criteria:**

- Given the provider returns a 503, when the agent retries, then the
  user sees a "retrying (attempt 2/5)" indicator.
- Given the provider returns a 400 (validation required), when the agent
  classifies it, then no retry is attempted and the user is shown the
  error.
- SRS trace: `FR-006`, `FR-007`.

### US-003 — Break out of a tool-call loop

**As a** user
**I want** the agent to detect when it is calling the same tool with the
same arguments repeatedly
**So that** it doesn't burn my token budget on a stuck loop.

**Acceptance criteria:**

- Given the agent calls `read_file("foo.ts")` 5 times in a row with the
  same args, when the 5th call completes, then the loop detector fires
  and the agent is told "you appear to be in a loop; try a different
  approach".
- Given the agent emits the same message text 10 times in a row, when
  the 10th message completes, then the loop detector fires.
- SRS trace: `FR-004`.

## Epic 2: Providers

### US-010 — Use my Anthropic API key

**As a** user with an Anthropic API key
**I want** to set `GOLI_DEFAULT_MODEL=anthropic/claude-3-5-sonnet` and
have Goli-CLI use it
**So that** I can use the model I'm already paying for.

**Acceptance criteria:**

- Given `ANTHROPIC_API_KEY` is set and `GOLI_DEFAULT_MODEL` is
  `anthropic/claude-3-5-sonnet`, when I run `goli -p "hello"`, then the
  request goes to `api.anthropic.com` with the Sonnet model.
- Given I don't have `ANTHROPIC_API_KEY` set, when I try to use an
  Anthropic model, then the CLI prints a clear error: "ANTHROPIC_API_KEY
  is not set; set it or use a different model".
- SRS trace: `FR-010`, `FR-012`.

### US-011 — Default to an open-weight model

**As a** user who doesn't want to be locked into a vendor
**I want** the default model to be open-weight
**So that** I can run Goli-CLI without agreeing to a closed-vendor ToS.

**Acceptance criteria:**

- Given no `GOLI_DEFAULT_MODEL` is set, when I run `goli -p "hello"`,
  then the request goes to `ollama/gpt-oss:120b`.
- Given the Ollama Cloud endpoint is unreachable, when the request fails,
  then the CLI prints "Ollama Cloud is unreachable; set
  GOLI_DEFAULT_MODEL to use a different provider".
- SRS trace: `FR-011`.

### US-012 — Route PII away from cloud providers

**As a** user in a regulated industry
**I want** the local-LLMs router to detect PII in my prompt and route it
to a local model
**So that** PII never leaves my machine.

**Acceptance criteria:**

- Given my prompt contains an SSN (`123-45-6789`), when the
  local-llms-router runs, then the prompt is routed to a local model and
  the cloud tier is never called.
- Given my prompt contains an email, when the local-llms-router runs,
  then the email is redacted to `[EMAIL_1]` before being sent to the
  cloud, and the email is restored in the agent's tool result.
- SRS trace: `FR-013`, `FR-015`.

## Epic 3: Tools

### US-020 — Edit a file with a diff review

**As a** user
**I want** `edit_file` to show me a unified diff before applying
**So that** I can catch mistakes before they hit disk.

**Acceptance criteria:**

- Given the agent calls `edit_file` with `old_str` and `new_str`, when
  the tool executes, then a diff is shown in the TUI with a "y/n" prompt.
- Given the user presses `y`, when the diff is approved, then the file
  is written and a git checkpoint is created.
- Given the user presses `n`, when the diff is rejected, then the agent
  is told "user rejected the edit" and can try a different approach.
- SRS trace: `FR-022`.

### US-021 — Use an allowlist for bash commands

**As a** security-conscious user
**I want** `bash` to allowlist safe commands (ls, cat, git status) and
require approval for everything else
**So that** the agent can't run `rm -rf /` without my knowledge.

**Acceptance criteria:**

- Given the agent calls `bash` with `git status`, when the allowlist is
  checked, then the command runs without approval.
- Given the agent calls `bash` with `rm -rf /`, when the allowlist is
  checked, then a permission prompt is shown with a destructive-action
  warning.
- Given the user denies the prompt, when the agent is told, then it
  tries a different approach.
- SRS trace: `FR-021`, `NFR-011`.

### US-022 — See tool output stream in real-time

**As a** user running a long bash command
**I want** to see the output stream to the TUI as it is produced
**So that** I can Ctrl-C if it's going off the rails.

**Acceptance criteria:**

- Given the agent calls `bash` with `npm test`, when the test runner
  emits a line, then the line appears in the TUI within 100ms.
- Given the user presses Ctrl-C mid-tool, when the SIGINT is received,
  then the child process is killed within 200ms and the agent is told
  "tool was cancelled by the user".
- SRS trace: `FR-026`, `FR-003`.

## Epic 4: Hooks

### US-030 — Block writes outside the workspace

**As a** user
**I want** a built-in hook that blocks `write_file` outside my workspace
**So that** the agent can't accidentally modify `~/.ssh/authorized_keys`.

**Acceptance criteria:**

- Given the agent calls `write_file("/etc/passwd", ...)`, when the
  `block-writes-outside-workspace` hook fires, then the call is blocked
  with error "path is outside the workspace".
- Given the agent calls `write_file("./src/foo.ts", ...)`, when the
  hook fires, then the call is allowed (the path resolves to inside the
  workspace).
- SRS trace: `FR-031`, `FR-040`, `FR-041`, `NFR-011`.

### US-031 — Auto-format files after write

**As a** user
**I want** a built-in hook that runs Prettier after every `write_file`
**So that** my code is always formatted.

**Acceptance criteria:**

- Given the agent calls `write_file("./src/foo.ts", ...)`, when the
  `auto-format` hook fires after the write, then Prettier is run on
  `foo.ts`.
- Given Prettier is not installed, when the hook runs, then it no-ops
  with a debug log (not an error).
- SRS trace: `FR-031`.

## Epic 5: Sandbox

### US-040 — Run on Linux with Landlock

**As a** Linux user
**I want** the sandbox to use Landlock by default
**So that** I don't need root or a separate binary.

**Acceptance criteria:**

- Given the user is on Linux ≥ 5.13, when Goli-CLI starts, then a
  Landlock sandbox is enabled automatically.
- Given the user is on Linux < 5.13, when Goli-CLI starts, then a
  warning is printed and the sandbox falls back to a userspace
  path-validation layer.
- SRS trace: `FR-040`.

### US-041 — Block network egress from tools

**As a** user
**I want** the sandbox to block all network egress from `bash`
**So that** the agent can't exfiltrate my code.

**Acceptance criteria:**

- Given the agent calls `bash` with `curl https://evil.com`, when the
  sandbox is active, then the curl fails with ECONNREFUSED.
- Given the agent calls `web_fetch` (an allowlisted tool), when the
  sandbox is active, then the request goes through.
- SRS trace: `FR-042`, `NFR-011`.

## Epic 6: Memory

### US-050 — Resume a session

**As a** user
**I want** to resume a previous session by ID
**So that** I can pick up where I left off.

**Acceptance criteria:**

- Given a previous session with ID `abc-123` exists, when I run `goli
--resume abc-123`, then the TUI loads the full transcript and the
  agent's context window is restored.
- Given the session ID doesn't exist, when I run `goli --resume xxx`,
  then the CLI prints "session xxx not found" and exits 1.
- SRS trace: `FR-053`.

### US-051 — Search across sessions

**As a** user
**I want** to search my past sessions for a keyword
**So that** I can find a conversation I had last week.

**Acceptance criteria:**

- Given I run `goli sessions search "redis"`, when the search runs,
  then a list of matching sessions is shown with the matching line
  highlighted.
- Given no sessions match, when the search runs, then "no matches" is
  printed and exit 0.
- SRS trace: `FR-052`.

## Epic 7: SICA (self-improvement)

### US-060 — See when the overseer intervenes

**As a** user
**I want** to be notified when the SICA overseer intervenes in the
agent's behavior
**So that** I understand why the agent changed course.

**Acceptance criteria:**

- Given SICA is enabled, when the overseer intervenes, then a
  yellow-bordered "SICA intervention" card appears in the TUI with the
  overseer's critique.
- Given the user clicks "dismiss" on the card, when it is dismissed,
  then the card collapses but the intervention is still in the audit log.
- SRS trace: `FR-060`.

## Epic 8: Orchestration

### US-070 — Spawn a subagent for a subtask

**As a** user with a complex task
**I want** the agent to spawn subagents for subtasks
**So that** each subagent can focus on one thing.

**Acceptance criteria:**

- Given the agent calls `spawn_subagent` with a subtask description,
  when the subagent runs, then a new context window is created with its
  own tool registry.
- Given the subagent completes, when it returns its result, then the
  parent agent's context is augmented with the subagent's summary (not
  the full transcript).
- SRS trace: `FR-071`.

## Epic 9: Evals

### US-080 — Run SWE-bench

**As a** maintainer
**I want** to run SWE-bench against the current build
**So that** I can catch regressions in solve rate.

**Acceptance criteria:**

- Given I run `npm run evals -- --suite swebench-lite`, when the harness
  runs, then a JSON report is written to `evals/output/swebench-lite.json`
  with per-task pass/fail.
- Given the solve rate drops > 2 percentage points from the baseline,
  when CI runs, then the eval job fails.
- SRS trace: `FR-080`.

## Epic 10: CLI / TUI

### US-090 — Use a screen reader

**As a** user with a visual impairment
**I want** a screen-reader mode that flattens the TUI
**So that** my screen reader can read the output linearly.

**Acceptance criteria:**

- Given I run `goli --screen-reader`, when the TUI starts, then the
  layout is flattened (no spinners, no progress bars, no alt-screen) and
  all output is plain text.
- Given the agent emits a tool call, when the screen-reader mode is
  active, then the tool name and arguments are printed as a single line
  of text.
- SRS trace: `FR-092`, `NFR-030`, `NFR-031`.

### US-091 — Run in headless mode

**As a** CI user
**I want** a headless mode that takes a prompt and outputs structured
JSON
**So that** I can integrate Goli-CLI into my CI pipeline.

**Acceptance criteria:**

- Given I run `goli -p "fix the bug" --headless-output json`, when the
  agent completes, then a single JSON object is printed to stdout with
  `{ runId, prompt, turns, toolCalls, finalText, exitCode }`.
- Given the agent errors, when in headless mode, then the JSON object
  has `exitCode: 1` and `error: "<message>"`.
- SRS trace: `FR-095`, `FR-096`, `NFR-034`.

## Epic 11: Enterprise compliance

### US-100 — Generate an SBOM

**As a** platform engineer
**I want** Goli-CLI to generate an SBOM in SPDX JSON
**So that** my security team can audit our dependencies.

**Acceptance criteria:**

- Given I run `npm run sbom:gen`, when Syft scans the repo, then
  `sbom/spdx.json` is written.
- Given the SBOM contains a GPL/AGPL dependency, when I run
  `npm run sbom:check`, then the check fails with a list of offending
  packages.
- SRS trace: `FR-100`.

### US-101 — Audit log

**As a** platform engineer in a regulated industry
**I want** an append-only audit log of every tool call and permission
decision
**So that** I can answer auditor questions.

**Acceptance criteria:**

- Given I run `goli --audit-log /var/log/goli/audit.jsonl`, when the
  agent runs, then every tool call, permission decision, and provider
  call is appended to the audit log.
- Given the audit log is tampered with (a line is modified), when the
  chained-hash verifier runs, then it reports the line number of the
  first tampered entry.
- SRS trace: `FR-101`, `NFR-014`.

## Revision history

| Date       | Version | Author          | Change                                                                           |
| ---------- | ------- | --------------- | -------------------------------------------------------------------------------- |
| 2026-07-07 | v0.1    | Lead Maintainer | Initial FRD                                                                      |
| 2026-07-13 | v0.2    | Lead Maintainer | Added Epic 7 (SICA), Epic 8 (Orchestration)                                      |
| 2026-07-25 | v0.3    | Lead Maintainer | Aligned with 0.3.0-phase2-studio; added US-012 (PII gating), refreshed SRS trace |
