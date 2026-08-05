# goli-cli Folder Structure: Research-Grounded Restructuring Plan

*A verified comparison against Gemini CLI, Claude Code, OpenAI Codex CLI, Aider, OpenHands, and Cline — with a concrete migration plan for goli-cli.*

---

## 0. Why this document exists

You were given a prior AI-generated proposal (the "apps/ + packages/" split with 9 granular engine packages). It's directionally reasonable, but it was **not verified against real repositories** — it asserts things "like Claude Code and Gemini CLI do" without actually checking. This document redoes that research properly: it pulls real, current folder layouts from six production coding agents, cross-checks the earlier proposal against them, corrects the parts that don't hold up, and produces a migration plan grounded in what's actually there — plus what's specifically true about *your* repo (I read your full tree, not just the summary).

One important scoping note: I did **not** use the "leaked Claude Code source" repos that turned up in search. That's Anthropic's proprietary code that was exposed via a source-map leak — using it as a research basis would be relying on improperly obtained material, so I've stuck to what Anthropic has documented publicly (the Claude Agent SDK, subagents, hooks, skills, permission model).

---

## 1. What the real agents actually look like

### 1.1 Gemini CLI (Google) — verified, fully open source (Apache 2.0)

This is your closest real precedent, since it's TypeScript/npm and CLI-first like goli-cli. Verified from the repo itself and Google's own architecture docs:

```
gemini-cli/
├── package.json                # workspaces: ["packages/*"]
├── packages/
│   ├── cli/                    # @google/gemini-cli — Terminal UI (Ink/React), yargs arg parsing
│   ├── core/                   # @google/gemini-cli-core — API client, tools, config, context
│   ├── a2a-server/             # @google/gemini-cli-a2a-server — Agent-to-Agent protocol server
│   ├── vscode-ide-companion/   # VS Code extension (IDE context + diff editor)
│   ├── devtools/               # Chrome-DevTools-style inspector (WebSocket)
│   ├── sdk/                    # @google/gemini-cli-sdk — programmatic embedding API
│   └── test-utils/             # private — shared test rig, terminal simulators, perf harness
├── integration-tests/
├── perf-tests/
├── memory-tests/
└── scripts/
```

Key facts worth correcting the record on:
- The repository is an npm workspace monorepo where the root package.json declares every subdirectory under packages/ as a workspace member. Notice there is **no `apps/` directory**. `packages/cli` (an app) and `packages/core` (an engine) sit as flat siblings. The separation of concerns is enforced by *dependency direction*, not by folder nesting.
- Inside `packages/core/src`, the engine is **not** split into a dozen further npm packages. It's one package with internal folders: `core/` (API client, prompts, turn processing), `tools/` (one file per tool — `read-file.ts`, `edit.ts`, `grep.ts`, `glob.ts`, `ls.ts`…), `prompts/`, `code_assist/`, `mcp/`, `config/`, plus dedicated subsystems for policy/approval and sub-agents.
- packages/core is documented as responsible for Gemini API interaction, prompt construction incorporating conversation history and tool definitions and GEMINI.md context, and tool registration/execution.
- Prompts genuinely do live in their own subsystem (`src/prompts/`, with a `PromptProvider` class), which validates "treat prompts as a first-class subsystem" — but they're still `.ts`, not hot-reloadable text files as the earlier proposal implied.
- Gemini CLI has its own hooks system, hierarchical memory (GEMINI.md discovery up the directory tree), a policy/approval engine, and sub-agents/skills — all conceptually identical to what you already have in `core/agent`, `core/approval`, `core/memory`. You're not behind here; you're ahead in some areas (SICA, GRPO training loop have no Gemini CLI equivalent at all).

**Takeaway:** the real Google precedent is "one cohesive engine package with strict internal folder discipline," not "shatter the engine into many tiny packages." That's a meaningful correction to the earlier proposal.

### 1.2 Claude Code / Claude Agent SDK (Anthropic) — closed source, but architecture is publicly documented

Claude Code's TypeScript source isn't public, so I can't verify its literal folder tree, and I'm not going to lean on the leaked copies floating around GitHub. What Anthropic *has* published about the architecture is enough to validate several of your existing decisions:

- The Claude Agent SDK is the harness that powers Claude Code, built on the principle of giving an agent a computer — file search, edit, bash execution, and iterative debugging.
- Subagents are defined as individual Markdown files with an explicit **tool allowlist and permission scope**, stored per-project or per-user, and can be invoked manually or auto-orchestrated — operating in isolation from each other and the main agent to reduce context spillover and enable predictable task execution. This maps directly to your `orchestration/`, `context/subagent/isolation.ts`, and `memory/skills/` split.
- Hooks, MCP, and CLAUDE.md-style hierarchical project memory are all first-class, separately-documented subsystems — same shape as your `tools/hooks/`, `tools/mcp/`, and `memory/persistent/`.

**Takeaway:** treat "matches Claude Code's internals" claims skeptically anywhere you see them (including in the earlier proposal) — nobody outside Anthropic can verify that. What's verifiable is the *public* SDK/subagent/hook model, and your existing structure already mirrors it reasonably well.

### 1.3 OpenAI Codex CLI — verified, Rust, crate-per-concern

codex-rs is a Cargo workspace containing over 120 member crates, with dedicated crates including `codex-core` (business logic), `codex-tui`, `codex-linux-sandbox` (Landlock/seccomp sandboxing as its own isolated crate), `codex-mcp`, and a Node.js wrapper package (`codex-cli/`) that just re-exports the compiled Rust binary for npm distribution. This is the strongest real-world precedent for **pulling the sandbox out into its own strictly isolated package** — which is exactly what you already decided in ADR-0016, and it's worth keeping as its own package in any restructure.

Rust's crate system makes fine-grained splitting cheap (no bundler config, no circular-dependency runtime cost). That's a meaningful caveat for you: **npm workspace packages are not free** the way Cargo crates are — each one needs its own `package.json`, `tsconfig.json`, build step, and a disciplined import boundary, or you just recreate the "God Package" problem as a "God Monorepo" of tangled packages.

### 1.4 Aider — the useful counter-example

Aider deliberately stays a **single flat Python package** (`aider/`) with files like `coders/` (edit-format strategies), `repomap.py` (tree-sitter + PageRank context ranking), `commands.py`, `linter.py`, `repo.py` (git integration). No monorepo, no multi-package split — and it's one of the most widely used agents that exists. This is worth citing to keep the "split everything into packages" instinct honest: **fragmentation is a tool for managing genuine complexity, not a badge of sophistication.** Given goli-cli's actual scope (SICA, GRPO training, swarm orchestration, i18n, sandboxing, Studio, VS Code ext), you have real complexity that justifies splitting — but each package should earn its place.

### 1.5 OpenHands (formerly OpenDevin)

Two patterns worth adopting:
- **`agenthub/`** — a pluggable registry where each agent implementation (e.g., the CodeAct agent) is self-contained, including specialized "microagents" for specific tasks like npm package installation or GitHub operations. This is close to your `plugins/` + `tools/dynamic-tool-manager.ts` — worth explicitly naming as the same pattern.
- **ACI (Agent-Computer Interface)** — OpenHands originally shipped file-editing/linting as a separate `openhands-aci` package, then folded it into `openhands/tools/` inside their unified SDK once the split proved to add more friction than value. That's a live example of a team *reversing* over-fragmentation — good evidence for staying conservative about package count.

### 1.6 Cline — the most relevant precedent for your specific problem (CLI + VS Code ext + web sharing one engine)

Cline ships as a VS Code extension, a CLI, and (per their SDK) other hosts, all sharing one agent core. The architecture separates agentic core logic from the host environment through a provider-based abstraction layer (a HostProvider singleton) and a centralized Controller that manages AI task lifecycles, so the core Task logic stays host-agnostic across VS Code, CLI, and other environments. Internally: `core/webview/`, `core/controller/`, `core/task/` (the part that actually executes tool calls). Cline also runs third-party plugins inside a **subprocess sandbox**, isolated from the main agent's memory space — directly relevant to your `plugins/registry.ts`, which currently has no isolation boundary described anywhere in your tree.

This is exactly your situation: `apps/cli`, `apps/studio`, `apps/vscode-ext` all need to drive the same underlying agent loop. Cline's answer is a **HostProvider abstraction** — worth adopting explicitly rather than leaving it implicit.

### 1.7 Monorepo tooling convention (Turborepo, the de facto standard)

The recommended convention is splitting packages into apps/ for applications and services, and packages/ for everything else — libraries and tooling. Application packages should sit at the "end" of the dependency graph and generally should not be installed into other packages — if you find yourself doing that often, it's a sign to rethink the package structure. Also directly relevant to your current `tests/unit/` folder: Turborepo's guidance is that you should avoid reaching across package boundaries with relative imports — if you're writing `../` to get from one package to another, that's a signal to rethink the boundary, which is effectively what your 100+ root-level unit test files do today (importing deep into `packages/core/src/...` by relative path).

So: the `apps/` + `packages/` split itself *is* a legitimate, well-documented convention — it's just not what Gemini CLI happens to use. Both are valid; `apps/`+`packages/` is more explicit and is what I'd recommend given you already have three genuinely separate launchable surfaces (CLI, Studio, VS Code ext).

---

## 2. Cross-cutting patterns (validated across ≥2 real agents)

| Pattern | Evidence | Your current equivalent |
|---|---|---|
| Engine/UI separation (app imports engine, never the reverse) | Gemini CLI (`cli`→`core`), Cline (HostProvider) | Partially — `packages/core` is imported by `cli`/`studio`, but nothing stops the reverse today |
| Sandbox as its own isolated boundary | Codex (`codex-linux-sandbox` crate), Cline (plugin subprocess sandbox), your own ADR-0016 | `core/src/sandbox/` — already isolated *conceptually*, not yet a package |
| Tools as one-file-per-tool registry + schema + confirmation | Gemini CLI `tools/`, OpenHands `agenthub`/ACI | `core/src/tools/core/` — already this shape |
| Hooks as pre/post tool middleware | Gemini CLI (5.7 Hooks System), Claude Code hooks, your ADR-0018 | `core/src/tools/hooks/` — already this shape |
| MCP client as isolated module | Gemini CLI `mcp/`, Claude Code MCP, Codex `codex-mcp` | `core/src/tools/mcp/` — already this shape |
| Prompts as a dedicated subsystem (not inline strings) | Gemini CLI `core/src/prompts/` | `core/src/agent/system-prompt.ts` — single file, not yet a subsystem |
| Subagents/skills with explicit tool allowlists | Claude Code subagents, Gemini CLI "Agent Skills and Sub-agents" | `core/src/memory/skills/`, `core/src/orchestration/` |
| Host abstraction for multi-surface engines | Cline `HostProvider` | Not present — worth adding explicitly |
| Colocated unit tests, centralized only for true e2e | Turborepo convention, Gemini CLI (`integration-tests/`, `perf-tests/` stay root-level; everything else colocates) | Not present — all 100+ unit tests live in root `tests/unit/` |
| Shared test harness as its own package | Gemini CLI `packages/test-utils` (private) | Not present |

---

## 3. Specific issues I found reading your actual tree (not generic advice)

1. **Duplicate `evals` locations.** You have both a top-level `packages/evals/src/index.ts` (nearly empty) and a full `packages/core/src/evals/` (redteam, regression, semantic-check, swebench). These will confuse contributors about which is canonical. Pick one.
2. **`core/src/api/` vs `core/src/gateway/`** look like they may overlap (both plausibly expose the agent over HTTP). Worth clarifying whether `gateway` is a routing layer in front of `api`, or a leftover duplicate.
3. **`core/src/context/subagent/isolation.ts`** is filed under *context*, but isolating subagent execution is an *orchestration* concern (it's about process/worktree boundaries, not retrieval). Move it to `orchestration/`.
4. **ADR numbering collision:** you have both `0010-defensive-json-parsing.md` and `0010-vscode-ext-isolation.md`, and *also* a separate `0017-vscode-ext-isolation.md` that duplicates the second one by title. Worth a quick pass renumbering `docs/decisions/`.
5. **No `.github/` directory** appears in your tree, despite `SECURITY.md`, `SBOM` gates, and a documented `release-process.md`. If CI/CD workflows exist elsewhere, fine — if not, this is a real gap, not a nice-to-have.
6. **Root-level clutter:** `demo-err.txt`, `demo-output.txt`, `scores.json`, `tasks.json`, `doctor` (no extension), `__test_dirname.ts` sitting at repo root. These read like generated/output artifacts or misplaced test helpers. `doctor` should probably be `scripts/doctor.sh` (or live in `apps/cli/bin/`); `__test_dirname.ts` belongs in a test-utils package, mirroring Gemini CLI's dedicated (private) `test-utils` workspace.
7. **`completions/`** (bash/fish/zsh) is only ever consumed by the CLI binary — it should move under `apps/cli/`, not sit at repo root.

---

## 4. Recommended structure for goli-cli

Given your actual scope — SICA self-improvement loop, GRPO training, swarm orchestration, 5-language i18n, three separate launchable surfaces — you have **more genuine complexity than Gemini CLI's entire repo**, so a more granular split than Gemini CLI's own is defensible. But I'd stop well short of a package-per-subfolder (15 packages matching your 15 `core/src` subfolders would be over-fragmentation per the Aider/OpenHands-ACI lesson above). Aim for packages that represent real *deployment or trust boundaries*, not just organizational categories.

```text
goli-cli/
├── .github/                        # CI/CD workflows — currently missing, real gap
├── apps/                           # Launchable surfaces only. Never imported BY packages/.
│   ├── cli/                        # was packages/cli — Ink/React TUI
│   │   ├── bin/goli.js             # was root bin/goli.js
│   │   └── completions/            # was root completions/
│   ├── studio/                     # was packages/studio — Next.js web console
│   └── vscode-ext/                 # was packages/vscode-ext
│
├── packages/                       # Headless engine. apps/ depends on these; never the reverse.
│   ├── sdk/                        # NEW, optional — stable public embedding API (Gemini CLI precedent)
│   │   └── src/host-provider.ts    #   Cline-style host abstraction so cli/studio/vscode-ext share one engine cleanly
│   ├── agent-core/                 # loop, planner, reflexion, stop-engine, effort-router, error-classifier
│   │   └── assets/prompts/         # was agent/system-prompt.ts — promoted to its own subsystem (Gemini CLI precedent)
│   ├── tool-system/                # registry, schema-validator, dynamic-tool-manager, truncation
│   │   ├── core/                   # bash, edit-file, read-file, grep, glob, web-fetch, web-search, lsp...
│   │   ├── hooks/                  # was tools/hooks — audit-log, auto-format, block-secrets, block-destructive
│   │   └── mcp/                    # was tools/mcp
│   ├── sandbox/                    # landlock, seatbelt, cgroups, path-validation, network, audit-log
│   ├── approval/                   # was core/approval — blast-radius, engine, enhanced-approval, policy modes
│   ├── context-engine/             # indexer (tree-sitter), retriever (hybrid), compaction, symbol-graph, project-map
│   ├── memory-engine/              # session, persistent, skills, sica, trajectory
│   │   └── training/               # dataset-builder, grpo-scaffold, reward — TS-side contract only;
│   │                                #   actual training execution stays in services/ml-pipeline (see §5)
│   ├── llm-providers/              # anthropic, gemini, openai, ollama, router, credential-pool, prompt-caching, budget
│   ├── orchestration/              # subagent isolation (moved from context/), worktree, swarm-pipeline,
│   │                                #   task-splitter, blackboard, cloud/e2b
│   ├── plugins/                    # registry — consider a Cline-style subprocess sandbox for 3rd-party plugin code
│   ├── observability/              # langfuse, otel tracing, alerts
│   ├── evals/                      # MERGED — one location, not two (see §3.1): redteam, regression, semantic-check, swebench
│   ├── i18n/                       # de/en/es/ja/zh-CN catalogs — shared by cli, studio, and core alike
│   ├── config/                     # schema, loader, integrity, mode-prompts — small, depended on by almost everything
│   ├── test-utils/                 # NEW, private — shared mocks/fixtures/harness (Gemini CLI precedent);
│   │                                #   absorbs root __test_dirname.ts
│   └── shared/                     # ONLY genuinely cross-cutting types/constants/errors/json-utils/logger —
│                                    #   resist the urge to make this "core 2.0"
│
├── services/                       # Non-Node runtimes
│   └── ml-pipeline/                 # was python_ml/ — build_dataset, train_grpo, reward_function, evaluate
│
├── config/                         # unchanged — default.toml (runtime config, not code)
├── docs/                           # unchanged — already excellent; fix ADR numbering collision (see §3.4)
├── infra/                          # unchanged
├── legal/                          # unchanged
├── examples/                       # unchanged
├── scripts/                        # unchanged, + doctor (was root `doctor`, add .sh extension)
├── bench/                          # unchanged
├── tests/                          # ONLY true cross-package suites now
│   ├── e2e/
│   ├── e2e-docker/
│   └── integration/
│   # tests/unit/*.test.ts (100+ files) — DELETED from here, redistributed as
│   # colocated __tests__ next to the source they test, inside each package above
│
├── .env.example
├── package.json                    # workspaces: ["apps/*", "packages/*"]
├── turbo.json                      # NEW — recommended once you have 15+ workspace packages (task graph + caching)
└── tsconfig.base.json
```

---

## 5. Migration map (old → new, high-signal moves only)

| Current path | New path | Why |
|---|---|---|
| `packages/core/src/agent/*` | `packages/agent-core/src/*` | Loop/planner/reflexion is the "brain," should have zero knowledge of how tools execute |
| `packages/core/src/sandbox/*` | `packages/sandbox/src/*` | Trust boundary — mirrors Codex's isolated `codex-linux-sandbox` crate and your own ADR-0016 |
| `packages/core/src/tools/*` (+ `hooks/`, `mcp/`) | `packages/tool-system/src/*` | Mirrors Gemini CLI's `tools/` and Codex's `codex-mcp` |
| `packages/core/src/approval/*` | `packages/approval/src/*` | Matches Gemini CLI's separately-documented Policy/Approval system |
| `packages/core/src/context/*` (minus `subagent/`) | `packages/context-engine/src/*` | Indexing/retrieval/compaction is one coherent concern |
| `packages/core/src/context/subagent/isolation.ts` | `packages/orchestration/src/isolation.ts` | It's a process-isolation concern, not a retrieval concern (see §3.3) |
| `packages/core/src/memory/*` | `packages/memory-engine/src/*` | SICA/skills/session/trajectory is your most novel subsystem — deserves its own package |
| `packages/core/src/providers/*` | `packages/llm-providers/src/*` | Isolates SDK churn (Anthropic/OpenAI/Gemini client updates) from the rest of the engine |
| `packages/core/src/orchestration/*` | `packages/orchestration/src/*` | Unchanged concern, promoted to package |
| `packages/core/src/observability/*` | `packages/observability/src/*` | Unchanged concern, promoted to package |
| `packages/core/src/evals/*` + `packages/evals/*` | `packages/evals/src/*` (single copy) | Resolves the duplicate location (see §3.1) |
| `packages/core/src/i18n/*` | `packages/i18n/src/*` | Consumed by `apps/cli`, `apps/studio`, and the engine alike — shouldn't live inside `core` |
| `packages/core/src/config/*` | `packages/config/src/*` | Nearly everything depends on config; keeping it a thin, dependency-free package avoids circular imports |
| `packages/core/src/types/*`, `utils/*` | `packages/shared/src/*` | Only the genuinely cross-cutting pieces — don't let this become a dumping ground |
| `packages/cli/*` | `apps/cli/*` | App, not engine |
| `packages/studio/*` | `apps/studio/*` | App, not engine |
| `packages/vscode-ext/*` | `apps/vscode-ext/*` | App, not engine |
| `python_ml/*` | `services/ml-pipeline/*` | Breaks Node workspace symmetry today; belongs beside `infra/` as an auxiliary service |
| `bin/goli.js` | `apps/cli/bin/goli.js` | Only the CLI app needs this entry point |
| `completions/*` | `apps/cli/completions/*` | Only the CLI app needs shell completions |
| `tests/unit/*.test.ts` (100+ files) | Colocated `__tests__/` beside each source file, inside its new package | Matches Turborepo's guidance against reaching across package boundaries; makes it obvious which tests die when a package is deleted |
| `__test_dirname.ts` (root) | `packages/test-utils/src/` (new) | Shared test helper, not a root-level file |
| `doctor` (root, no extension) | `scripts/doctor.sh` | Consistency with the rest of `scripts/` |

---

## 6. Migration strategy (don't big-bang this)

1. **Start with `sandbox`.** It's the most self-contained, highest-value extraction (matches Codex's precedent directly), and it's the one place where an accidental circular import would be a real security concern, not just a lint annoyance.
2. **Then `tool-system`.** Second most self-contained; forces you to define the `agent-core` ↔ `tool-system` contract explicitly.
3. **Introduce a temporary re-export shim.** Keep `packages/core` alive as a thin package that re-exports from the new packages during the transition (`export * from '@goli/sandbox'`), so you're not forced to update every import site in one PR. Delete `core` once nothing points at it anymore — a strangler-fig approach rather than a rewrite.
4. **Move tests only after their source moves**, one package at a time — don't do the `tests/unit` redistribution as a separate giant PR; it should ride along with each package extraction so you can verify nothing broke.
5. **Adopt `turbo.json` (or Nx) once you cross roughly a dozen packages.** Plain npm workspaces will work but you'll start feeling slow, uncached full-repo rebuilds well before that.
6. **Write the ADR.** Given your team already documents decisions this rigorously (0011 chose npm workspaces monorepo, 0009 chose the single-threaded loop), this restructuring deserves its own ADR — including *why* you're going more granular than Gemini CLI's own precedent, given your larger scope.

---

## 7. Sources consulted

- Gemini CLI — [google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli), [package structure wiki](https://deepwiki.com/google-gemini/gemini-cli/1.2-package-structure), [GEMINI.md](https://github.com/google-gemini/gemini-cli/blob/main/GEMINI.md), [tools docs](https://google-gemini.github.io/gemini-cli/docs/tools/), [core docs](https://geminicli.com/docs/core/)
- OpenAI Codex CLI — [openai/codex](https://github.com/openai/codex), [repository structure wiki](https://deepwiki.com/openai/codex/1.2-repository-structure), [AGENTS.md](https://github.com/openai/codex/blob/main/AGENTS.md)
- Anthropic (Claude Code / Claude Agent SDK, public documentation only) — [Building agents with the Claude Agent SDK](https://anthropic.com/engineering/building-agents-with-the-claude-agent-sdk), [Claude Code Subagents (InfoQ)](https://www.infoq.com/news/2025/08/claude-code-subagents)
- Aider — [Aider-AI/aider](https://github.com/aider-ai/aider), [repository understanding wiki](https://deepwiki.com/Aider-AI/aider/4-repository-understanding-and-context), [repomap docs](https://aider.chat/docs/repomap.html)
- OpenHands — [OpenHands/OpenHands](https://github.com/OpenHands/openhands), [openhands-aci](https://github.com/OpenHands/openhands-aci), [CodeAct agent README](https://github.com/OpenHands/OpenHands/blob/main/openhands/agenthub/codeact_agent/README.md)
- Cline — [cline/cline](https://github.com/Cline/Cline), [extension architecture wiki](https://deepwiki.com/cline/cline/2-core-system), [plugins/extensions wiki](https://deepwiki.com/cline/cline/13.4-publishing-and-release)
- Turborepo (monorepo convention) — [Structuring a repository](https://turborepo.dev/docs/crafting-your-repository/structuring-a-repository), [Package types](https://turborepo.dev/docs/core-concepts/package-types)

Note: I deliberately excluded several "leaked Claude Code source" repositories that appeared in search results — that's proprietary Anthropic code exposed without authorization via an npm source-map leak, and using it as a research basis wouldn't be appropriate regardless of how freely it's circulating.
