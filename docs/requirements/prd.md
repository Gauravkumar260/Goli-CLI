# Product Requirements Document — Goli-CLI

> **Status:** v0.3 (Draft, aligned with monorepo version `0.3.0-phase2-studio`)
> **Owner:** Goli-CLI Lead Maintainer
> **Last updated:** 2026-07-25
> **Supersedes:** v0.2 (Phase 2 ship)

## 1. Vision

Goli-CLI is an **enterprise-grade, open-weight-first AI coding agent** for
the terminal. It combines a multi-provider LLM client, a deterministic tool
layer with kernel-enforced sandboxing, an 11-agent swarm for complex
multi-step tasks, a 3-tier memory system with self-improvement (SICA), and
first-class enterprise compliance (SBOM gate, audit log, PII gating, EU AI
Act posture). The product exists because no current AI coding agent
satisfies the four enterprise constraints simultaneously: (1) no
closed-vendor ToS lock-in, (2) reproducible agent behavior, (3) auditable
security posture, (4) self-hostable on open-weight models.

## 2. Target users

| Persona                                    | Description                                                       | What they need from Goli-CLI                                  |
| ------------------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------- |
| **Staff engineer (open-source)**           | Maintains OSS packages; lives in the terminal; privacy-conscious. | Local LLM mode, no telemetry, MIT license, reproducible runs. |
| **Platform engineer (regulated industry)** | Works in finance / health / EU; audited deployments.              | SBOM, audit log, PII gating, EU AI Act posture, on-prem.      |
| **ML engineer**                            | Fine-tunes agent trajectories; cares about evals.                 | SICA loop, trajectory export, GRPO training pipeline.         |
| **VS Code power user**                     | Wants agent assistance without leaving the editor.                | `@goli-cli/vscode-ext` (experimental).                        |
| **Remote developer**                       | Wants a browser-based console for sessions on a dev box.          | `@goli-cli/studio` (experimental).                            |

The product is **explicitly not** for casual end-users who want a "vibe
coding" experience. It is a professional tool with a learning curve, and
its power comes from exposing knobs that casual tools hide.

## 3. Problem statement

Existing AI coding agents force a tradeoff:

- **Cloud-only tools** (Cursor, GitHub Copilot, Claude Code, Codex) lock
  you into a vendor ToS, can train on your code, and have opaque
  security postures.
- **Local-only tools** (Aider, Continue) are single-provider, lack
  sandboxing, and have no enterprise compliance story.
- **Hybrid tools** (Gemini CLI) are still single-provider and lack the
  multi-agent + self-improvement loop.

Goli-CLI resolves the tradeoff with a **provider-agnostic** architecture
(defaults to open-weight `ollama/gpt-oss:120b`), a **kernel-enforced
sandbox** (Landlock / Seatbelt / cgroups), a **deterministic hooks
layer** (vs. prompt-only safety), and a **memory + self-improvement
loop** (SICA) that compounds over time.

## 4. Goals (v1.0)

| #   | Goal                                                | Success metric                                                                                          |
| --- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| G1  | Multi-provider model layer with open-weight default | ≥ 4 providers (Anthropic, OpenAI, Gemini, Ollama); `ollama/gpt-oss:120b` is the default                 |
| G2  | Kernel-enforced sandbox on all 3 OSes               | Landlock (Linux), Seatbelt (macOS), Job Object (Windows); verified by `toctou-path-safety.test.ts`      |
| G3  | Deterministic tool layer with hooks                 | 12+ built-in tools, 6 hook events, allowlist-first bash (`docs/decisions/0015-allowlist-first-bash.md`) |
| G4  | 11-agent swarm for complex tasks                    | Scout → Architect → Coder → Reviewer → Tester → ... → Documenter pipeline (`docs/agents.md`)            |
| G5  | 3-tier memory + SICA self-improvement               | Ephemeral / persistent / external tiers; SICA loop with immutable safety registry                       |
| G6  | Enterprise compliance                               | SBOM gate (zero GPL/AGPL), audit log, PII gating, EU AI Act posture (`legal/`)                          |
| G7  | Reproducible agent runs                             | Frozen-snapshot injection, prompt-cache byte-stability invariant, single-threaded loop                  |
| G8  | First-class evals                                   | SWE-bench harness, semantic-error-rate metric, redteam (promptfoo)                                      |

## 5. Non-goals (v1.0)

- **GUI / web interface for the CLI** — the CLI surface is terminal-only.
  (`@goli-cli/studio` is a separate, opt-in package and not part of v1.0.)
- **Mobile apps** — out of scope indefinitely.
- **Cloud-hosted Goli-CLI** — Goli-CLI is self-hosted only. The cloud
  providers we route to (Anthropic, OpenAI, etc.) are LLM backends, not
  Goli-CLI hosts.
- **Building our own LLM** — we route to existing models; we do not train
  a base model. SICA fine-tunes trajectories, not base models.
- **Code completion / inline suggestions** — that's a different product
  (Copilot-style). Goli-CLI is an **agentic** tool, not a completion tool.

## 6. Competitive landscape

See [`docs/competitive-landscape.md`](../competitive-landscape.md) (planned;
in the meantime, see the worklog's gemini-cli survey for a worked example).

The short version:

| Feature                 | Goli-CLI          | Claude Code | Cursor | Aider | Gemini CLI |
| ----------------------- | ----------------- | ----------- | ------ | ----- | ---------- |
| Open-weight default     | ✅                | ❌          | ❌     | ❌    | ❌         |
| Kernel sandbox          | ✅                | ❌          | ❌     | ❌    | partial    |
| Hooks (deterministic)   | ✅                | ❌          | ❌     | ❌    | ❌         |
| Multi-agent swarm       | ✅ (11)           | ❌          | ❌     | ❌    | ❌         |
| Self-improvement (SICA) | ✅                | ❌          | ❌     | ❌    | ❌         |
| SBOM gate               | ✅                | ❌          | ❌     | ❌    | ❌         |
| Audit log               | ✅                | ❌          | ❌     | ❌    | ❌         |
| EU AI Act posture       | ✅                | ❌          | ❌     | ❌    | ❌         |
| Browser console         | ✅ (Studio)       | ❌          | ❌     | ❌    | ❌         |
| VS Code extension       | ✅ (experimental) | ❌          | ✅     | ❌    | ✅         |

## 7. Personas → Features (v1.0 scope)

### 7.1 Staff engineer (open-source)

- `goli --local-llms -p "..."` — route to local Ollama models with PII gating
- `goli --no-telemetry` — zero outbound calls except the LLM provider
- Reproducible runs via `--frozen-snapshot path/to/snapshot.json`
- Per-session JSONL transcripts under `~/.goli/sessions/`

### 7.2 Platform engineer (regulated)

- `goli --audit-log /var/log/goli/audit.jsonl` — append-only audit log
- `goli --policy config/strict.toml` — TOML policy file with SHA-256 integrity
- `goli --sbom-check` — fail-fast if any dependency is GPL/AGPL
- On-prem deployment via `infra/k8s/` (LitellM, Langfuse, ClickHouse, vLLM)

### 7.3 ML engineer

- `goli --export-trajectory run-123.jsonl` — export trajectory for fine-tuning
- `goli --sica-overseer` — enable the LLM safety overseer loop
- `python_ml/train_grpo.py` — GRPO fine-tuning pipeline with custom reward
- `python_ml/evaluate.py` — eval harness with semantic-error-rate metric

### 7.4 VS Code power user (experimental)

- Install `@goli-cli/vscode-ext` from the VS Code marketplace
- Agent panel: see tool calls, approve permissions, view diffs
- Batch diff: apply multiple file changes in one review pass

### 7.5 Remote developer (experimental)

- `npm run studio:dev` — start the Next.js web console on :3000
- Browser-based chat with streaming tokens, tool cards, permission prompts
- Session sidebar with history and resume
- Demo mode when the runtime is offline

## 8. Release plan

| Release | Target  | Theme                                                      | Status          |
| ------- | ------- | ---------------------------------------------------------- | --------------- |
| 0.1.0   | 2026-Q1 | Walking skeleton (CLI + 1 provider + 1 tool)               | ✅ Shipped      |
| 0.2.0   | 2026-Q2 | Phase 2 (agent loop + multi-provider + TUI polish)         | ✅ Shipped      |
| 0.3.0   | 2026-Q3 | Phase 2 + Studio (web console) + multi-agent swarm         | ✅ This release |
| 0.4.0   | 2026-Q4 | Phase 8–11 (memory + SICA + evals + orchestration)         | In progress     |
| 1.0.0   | 2027-Q1 | Stable v1.0 (all 13 phases, full SRS, man pages, runbooks) | Planned         |

## 9. Risks and mitigations

| Risk                                  | Likelihood | Impact   | Mitigation                                                                           |
| ------------------------------------- | ---------- | -------- | ------------------------------------------------------------------------------------ |
| Open-weight model quality regressions | High       | High     | Multi-provider fallback; allowlist of tested models                                  |
| Sandbox escape                        | Low        | Critical | Kernel-enforced + TOCTOU tests + external redteam (promptfoo)                        |
| Prompt injection via tool results     | Medium     | High     | Hooks layer blocks known-bad patterns; tool-result truncation; LLM safety overseer   |
| EU AI Act enforcement                 | Medium     | Medium   | `legal/PRIVACY_POLICY.md` already aligned; track Article 6 transparency requirements |
| Provider ToS changes                  | High       | Medium   | Provider abstraction; user can switch with one env var                               |
| Scope creep (web → mobile → cloud)    | Medium     | High     | Strict non-goals; studio is opt-in; v1.0 frozen                                      |

## 10. Revision history

| Date       | Version | Author          | Change                                                                                                         |
| ---------- | ------- | --------------- | -------------------------------------------------------------------------------------------------------------- |
| 2026-07-07 | v0.1    | Lead Maintainer | Initial PRD for 0.1.0 walking skeleton                                                                         |
| 2026-07-13 | v0.2    | Lead Maintainer | Updated for 0.2.0 Phase 2 ship (11-agent swarm, multi-provider)                                                |
| 2026-07-25 | v0.3    | Lead Maintainer | Added Goli Studio as experimental package; aligned with `0.3.0-phase2-studio`; refreshed competitive landscape |
