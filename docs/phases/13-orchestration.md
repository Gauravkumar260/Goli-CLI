# Phase 13 — Multi-Agent Orchestration (Module 7)

**Status:** Substantially Complete
**Modules touched:** M7 (parallel subagents, LiteLLM routing, E2B cloud sandbox, VS Code extension)
**Compliance gates:** G5 (liability shield — complete: ToS + insurance + audit log)

## Goal

Build parallel subagents with git worktree isolation, the file-based
shared-blackboard coordination, LiteLLM open-weight-only routing, the
complexity classifier, the E2B Firecracker cloud sandbox integration,
the VS Code extension with batch diff review, and the five orchestration
patterns.

## Current Implementation Status

Swarm pipeline (11-agent sequential handoff Scout -> Documenter) + task splitter (decompose complex tasks) + worktree isolation (ADR-0036 — concurrency only, not security) + shared blackboard (file-based inter-agent coordination) + complexity classifier (single agent vs full pipeline routing) + E2B cloud sandbox (Firecracker) + orchestration patterns library + VS Code extension with batch diff review all shipped at packages/core/src/orchestration/ and packages/vscode-ext/. Open-weight-only routing (ADR-0034) enforced via BLOCKED_PROVIDERS in classifier.ts.

See the per-module sections in [docs/architecture.md](../architecture.md)
for the current code locations and `AGENTS.md` for accumulated
implementation patterns and gotchas.

## Definition of Done

- [ ] `src/orchestration/decompose/task-splitter.ts` — decomposes task, classifies subtasks (independent vs dependent)
- [ ] `src/orchestration/worktree/isolation.ts` — `git worktree add` per subagent
- [ ] `src/orchestration/shared-state/blackboard.ts` — propose-validate-commit protocol
- [ ] `src/orchestration/shared-state/task-list.md` — shared file with status flags
- [ ] `src/orchestration/routing/litellm.ts` — LiteLLM proxy integration
- [ ] `src/orchestration/routing/classifier.ts` — complexity classifier (~430ms, ~210 tokens)
- [ ] `src/orchestration/routing/fallback.ts` — GLM-5.2 high → max → DeepSeek V4 / Qwen3
- [ ] `src/orchestration/routing/legal-blocklist.ts` — hard-blocked providers (anthropic, openai)
- [ ] `src/orchestration/cloud/e2b.ts` — E2B Firecracker integration (preload_repo, execute, destroy)
- [ ] `src/orchestration/cloud/firecracker-self-hosted.ts` — self-hosted Firecracker path
- [ ] `src/orchestration/patterns/fanout-fanin.ts` — primary pattern
- [ ] `src/orchestration/patterns/supervisor.ts` — hub-spoke with arbiter
- [ ] `src/orchestration/patterns/handoff.ts` — sequential
- [ ] `src/orchestration/patterns/debate.ts` — high-stakes only
- [ ] `src/orchestration/patterns/swarm.ts` — avoid (87% failure rate)
- [ ] `src/vscode-extension/` — LSP-based VS Code extension with batch diff review
- [ ] `config/orchestration.toml` + `config/routing.toml` + `config/cloud.toml`
- [ ] ADR-0035 (sequential 11-agent pipeline over parallel swarm)
- [ ] ADR-0039 (open-weight-only routing, hard-blocked providers)
- [ ] ADR-0036 (worktree is concurrency, not security)
- [ ] ADR-0041 (E2B managed vs Firecracker self-hosted; data residency dictates)
- [ ] ADR-0042 (batch diff review as the third UX mode)
- [ ] ADR-0035 (sequential 11-agent pipeline) covers centralized control

## Steps (P13.x)

13.1 Write `src/orchestration/decompose/task-splitter.ts`
13.2 Write `src/orchestration/worktree/isolation.ts`
13.3 Write `src/orchestration/shared-state/{blackboard,task-list.md}.ts`
13.4 Write `src/orchestration/routing/{litellm,classifier,fallback,legal-blocklist}.ts`
13.5 Write `src/orchestration/cloud/{e2b,firecracker-self-hosted}.ts`
13.6 Write 5 pattern files
13.7 Write `src/vscode-extension/` (extension.ts, lsp_client.ts, chat_participant.ts, inline_chat.ts, batch_diff.ts)
13.8 Write `config/{orchestration,routing,cloud}.toml`
13.9 Write integration test: 3 parallel subagents, routed, merged, reviewed
13.10 Write legal gate check: no anthropic/openai in routing logs
13.11 Write SWE-bench regression test after multi-agent changes
13.12 ADR-0038 through ADR-0043
13.13 Final GA readiness review
13.14 Worklog entry for Phase 13

## Key Engineering Decisions

- **Restraint over default multi-agent.** 15× token overhead + 37%
  coordination failure rate + GLM-5.2's 1M context = use multi-agent
  sparingly.
- **File-based coordination over messaging.** No message ordering problems,
  no lost messages, atomic operations, human inspectability.
- **Locked-blackboard (propose-validate-commit).** Prevents race conditions
  that scale quadratically with naive shared state.
- **Open-weight-only routing (legal non-negotiable).** Anthropic ToS
  enforced against OpenAI (Aug 2025) and xAI/Cursor (Jan 2026). Hard-
  blocked `["anthropic","openai"]` providers.
- **Mid-tier orchestrator pattern.** GLM-5.2 high (not max) as orchestrator
  — 4× cost reduction, equal routing competence.
- **Worktree ≠ sandbox.** Worktree handles concurrency; Module 4 OS-native
  sandbox handles safety. Must combine.
- **E2B for managed, Firecracker for self-hosted.** Data residency dictates
  choice.
- **Batch diff review as the third mode.** Avoids Claude Code's "Ask before
  edits" (no full picture) and "Edit automatically" (no review) — matches
  Cursor's accepted workflow.
- **Centralized-control principle.** Keep an orchestrator/arbiter in the
  loop; open mesh is what failure-taxonomy papers studied.
