# Contributing to GOLI-CLI

First off — thank you for taking the time to contribute. GOLI-CLI is an
enterprise AI coding agent, and the bar for trust is therefore unusually
high. This document spells out what that means in practice.

> **TL;DR**: Fork → branch → write code + tests + docs → run `npm run verify` →
> open a PR. Every PR must pass CI (lint, typecheck, unit tests, SBOM gate).
> AI-assisted PRs are welcome **iff** a human author signs off and the
> contribution honors the [AI Authorship Policy](docs/decisions/0008-ai-authorship-policy.md).

---

## 1. Project Layout

GOLI-CLI is an **npm workspaces monorepo** (see
[ADR-0011](docs/decisions/0011-npm-workspaces-monorepo.md)) with three
workspace packages plus a standalone VS Code extension:

```
goli-cli/
├── packages/
│   ├── core/                  @goli/core — the "Brain"
│   │   └── src/
│   │       ├── agent/         Module 1 — ReAct loop, providers, budget, retry, reflexion
│   │       ├── api/           OpenAI-compatible HTTP API server
│   │       ├── approval/      Module 3 — diff-first approval flow + blast radius
│   │       ├── config/        TOML loader + Zod schema + mode prompts + integrity
│   │       ├── context/       Module 2 — hybrid retrieval (tree-sitter + SQLite + lexical)
│   │       ├── evals/         Module 6 — SWE-bench + semantic evaluator + regression gate
│   │       ├── gateway/       Long-running gateway host
│   │       ├── i18n/          5 locales: en, es, zh-CN, ja, de
│   │       ├── memory/        Module 5 — 3-tier memory + SICA + trajectory + training
│   │       ├── observability/ OTel tracing + Langfuse + alert manager
│   │       ├── orchestration/ Module 7 — 11-agent swarm + worktree + E2B + classifier
│   │       ├── plugins/       Plugin registry + middleware + hooks
│   │       ├── providers/     Ollama (default), OpenAI, Anthropic, Gemini, Mock
│   │       ├── sandbox/       Module 4 — cgroups v2, Landlock, bubblewrap, seatbelt, network
│   │       ├── tools/         Module 3 — registry + 20 core tools + MCP + hooks
│   │       ├── types/         Ambient declarations for optional deps
│   │       └── utils/         Constants, logger, errors, JSON helpers
│   ├── cli/                   @goli/cli — the TUI + binary
│   │   └── src/
│   │       ├── commands/      wakeup, doctor, status, audit, usage, commit, init, mcp, cron, profile
│   │       ├── services/      CliAgentLoop, MockAgentLoop, IAgentLoop
│   │       ├── tui/           Ink + React TUI (components, hooks, lib, state, theme)
│   │       ├── constants.ts   CLI-local constants (lazy-loaded for fast cold-start)
│   │       └── index.ts       Commander entry point (lazy-loaded commands)
│   ├── evals/                 @goli/evals — SWE-bench-style evaluation harness (stub)
│   └── vscode-ext/            Standalone VS Code extension (NOT in workspaces — see ADR-0017)
├── tests/                     Root-level vitest (unit, integration, e2e)
├── scripts/                   bench, a11y-audit, gen-completions, gen-10k-repo, tti-bench, clean-room-verify
├── completions/               bash / zsh / fish shell completions
├── config/                    default.toml (project-level config)
├── docs/                      architecture, ADRs (45 files), phases, decisions, api, tui, cli, extensions
├── examples/                  mcp-hello-world/
├── infra/                     docker-compose + k8s manifests + LiteLLM router config
├── python_ml/                 GRPO + LoRA training pipeline (Module 5 ML side)
├── bench/                     baseline.json + fixtures/repo-10k/
├── legal/                     PRIVACY_POLICY.md, TERMS_OF_SERVICE.md, ai-bom.spdx.json
└── bin/                       `goli` shell launcher
```

Every source package has a `package.json` and `tsconfig.json` that wire into
the workspace. The CLI consumes `@goli/core` via the `"@goli/core": "*"`
dependency (workspace symlink). If you add a new directory, add a README.

---

## 2. Development Environment

### Prerequisites

| Tool            | Min version | Notes                                             |
| --------------- | ----------- | ------------------------------------------------- |
| Node.js         | 20.18 LTS   | 22 LTS recommended; 24 LTS supported              |
| npm             | 10          | We use npm; pnpm/yarn/bun work but aren't in CI   |
| Git             | 2.40        | Required for `git worktree` orchestration (M7)    |
| ripgrep         | 13          | Required by the `grep` tool (M3)                  |
| tree-sitter CLI | 0.22        | Optional; needed only to regenerate grammars (M2) |

### Setup

```bash
git clone https://github.com/goli-cli/goli-cli.git
cd goli-cli
npm install
npm run verify         # typecheck + lint + test + sbom-check
```

### Common Scripts

| Script                  | What it does                                                    |
| ----------------------- | --------------------------------------------------------------- |
| `npm run build`         | Compile TypeScript in all workspaces via `tsup` to `dist/`      |
| `npm run dev`           | Run the CLI in dev mode (`tsx packages/cli/src/index.ts`)       |
| `npm run goli`          | Run the built `goli` binary (`node packages/cli/dist/index.js`) |
| `npm run typecheck`     | `tsc --noEmit` — strict, no emit (across all workspaces)        |
| `npm run lint`          | ESLint flat-config over `packages/`, `tests/`, `scripts/`       |
| `npm run lint:fix`      | ESLint with `--fix`                                             |
| `npm run format`        | Prettier write                                                  |
| `npm run format:check`  | Prettier check (CI mode)                                        |
| `npm test`              | Vitest unit + integration tests at the root (`tests/`)          |
| `npm run test:e2e`      | Vitest e2e (slow; configured via `vitest.e2e.config.ts`)        |
| `npm run test:coverage` | Vitest with coverage report                                     |
| `npm run verify`        | typecheck + lint + format:check + test — the PR gate            |
| `npm run sbom:check`    | Syft SBOM + Trivy policy check (zero GPL/AGPL)                  |
| `npm run bench`         | Capture cold-start / build / typecheck / lint / test metrics    |
| `npm run a11y:audit`    | Run the accessibility audit script (`scripts/a11y-audit.ts`)    |

---

## 3. Coding Standards

### 3.1 TypeScript

- **Strict mode is mandatory** (`"strict": true` in `tsconfig.json`).
- **No `any`** — use `unknown` + narrowing, or `// eslint-disable-next-line`
  with a comment justifying why.
- **ESM only** (`"type": "module"` in `package.json`). Use `import`/`export`,
  never `require`. Use `.js` extensions in relative imports for ESM
  compatibility with `NodeNext` module resolution.
- **Prefer interfaces over type aliases** for object shapes (better error
  messages and declaration merging). Use type aliases for unions and
  intersections.
- **Every exported symbol must have a JSDoc comment** describing its purpose,
  parameters, and return value. Non-exported symbols benefit from comments
  but are not required.

### 3.2 File Naming

- `kebab-case` for files: `tree-sitter-indexer.ts`, not `TreeSitterIndexer.ts`.
- `PascalCase` for classes and interfaces: `class GLMClient`,
  `interface ToolCall`.
- `camelCase` for functions and variables: `parseStream`, `toolCallId`.
- `UPPER_SNAKE_CASE` for module-level constants: `MAX_TOOL_RESULT_TOKENS`.
- One default export per file is allowed for React components (Ink pattern);
  otherwise prefer named exports.

### 3.3 Error Handling

- Throw typed errors from the `packages/core/src/utils/errors.ts` hierarchy
  (`GoliError` base + `ModelError`, `ModelTimeoutError`, `ModelHTTPError`,
  `SandboxError`, `SandboxDeniedError`, `ToolValidationError`,
  `ToolExecutionError`, `ConfigError`, `ConfigNotFoundError`,
  `ConfigValidationError`).
- Never swallow errors silently. At minimum, log at `warn` level with
  context.
- Use the `isGoliError(x)` type guard + `wrapUnknown(x)` helper to convert
  unknown caught values into the typed hierarchy.

### 3.4 Tests

- **Vitest** is the test runner. Unit tests live at the root in
  `tests/unit/` (one `.test.ts` per source module — co-located by name,
  not by directory). Integration tests live in `tests/integration/` and
  may use real I/O. E2E tests live in `tests/e2e/` and spawn the actual
  CLI binary.
- **Every public function must have at least one test.** Private helpers
  are tested through the public surface.
- **Current test suite size: 3,053 tests** across unit + integration +
  e2e. See `docs/coverage-report.md` for current coverage metrics
  (~65.8% statements / 80% target).
- **Provider system**: The project supports multiple LLM providers
  (Ollama default, OpenAI, Anthropic, Gemini, Mock). To test without an
  API key, use `npm run goli -- --demo -p "hello"` (MockAgentLoop) or
  set `GOLI_DEFAULT_MODEL=mock/echo`.
- 17 provider integration tests cover type detection, sync client
  creation, adapter call translation, `OllamaProvider` construction,
  and `.env` loading.

### 3.5 Documentation

- Every module has a `README.md` in its directory.
- Architectural decisions are recorded as ADRs in `docs/decisions/`
  (format: `NNNN-kebab-title.md`, NNNN monotonic).
- API surface is documented in `docs/api/` (auto-generated from JSDoc by
  `typedoc` in a later phase).
- Runbooks for common operational tasks (deploy Langfuse, regenerate
  SBOM, run SWE-bench) live in `docs/runbooks/`.

---

## 4. Pull Request Process

1. **Branch naming**: `feat/<short-description>`,
   `fix/<short-description>`, `docs/<short-description>`,
   `chore/<short-description>`. Branch from `main`.
2. **Commit messages**: Conventional Commits
   (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`,
   `perf:`, `ci:`). Reference issues in the body: `Closes #123`.
3. **PR title**: same format as commit subject.
4. **PR description** must include:
   - **What changed and why** (1–2 paragraphs)
   - **How it was tested** (which tests, manual verification steps)
   - **Risk assessment** (security, performance, backward-compat)
   - **SBOM delta** (if any new dependencies added — list them and their
     licenses; CI will block if GPL/AGPL)
   - **AI assistance disclosure** (if any part of the PR was AI-assisted,
     state which tool, which sections, and the human review performed)
5. **CI must be green**: lint, typecheck, unit, integration, SBOM gate,
   SWE-bench 50-instance regression.
6. **At least one human review approval** required. Reviews from AI agents
   are advisory only and do not count toward the approval requirement.
7. **Squash-merge** to `main`. The PR title becomes the commit subject.

---

## 5. AI-Assisted Contributions

GOLI-CLI is, by design, an AI coding agent — we expect a substantial
fraction of contributions to be AI-assisted. The policy is:

- **A human contributor must be the legal author** of every merged commit.
  Pure AI-generated code is public domain under US Copyright Office
  guidance and _Thaler v. Perlmutter_ (D.C. Cir. 2025).
- **AI-assisted code must be reviewed line-by-line** by the human author.
  "I asked the model and pasted the output" is not a contribution.
- **Security-critical code** (`packages/sandbox/src/`,
  `packages/tool-system/src/hooks/builtin/`,
  `packages/core/src/memory/sica/`,
  `packages/core/src/evals/redteam/`,
  `packages/core/src/orchestration/routing/`,
  `packages/core/src/approval/`) requires **two human reviewers**,
  regardless of whether AI was involved.
- **Trajectories of AI-assisted tasks** may be logged to the trajectory
  store (Module 5) and used for fine-tuning, subject to the contributor's
  opt-in via the `goli-contributor-agreement.md` (added in a later phase).

---

## 6. Security & Compliance

- **Sandbox is the trust boundary** (Module 4). Any change to
  `packages/sandbox/src/` requires a security review and a red-team test pass.
- **Hooks are deterministic guardrails** (Module 3). Any change to
  `packages/tool-system/src/hooks/builtin/` requires a security review.
- **SBOM is gated in CI**. Adding a GPL/AGPL dependency will block the PR.
  See `docs/decisions/0004-sbom-gate.md`.
- **Vulnerabilities**: report security vulnerabilities privately to
  `security@goli-cli.dev`. Do NOT open a public issue. See `SECURITY.md`
  for the disclosure process.

---

## 7. Style Quick Reference

- 2 spaces, no tabs.
- 80-column soft limit; 100 hard limit.
- Semicolons required.
- Single quotes for strings.
- Trailing commas in multi-line objects/arrays.
- `const` by default; `let` only when reassignment is necessary;
  `var` is forbidden.

Prettier + ESLint enforce all of the above. If you skip the formatters,
CI will reject the PR.

---

## 7.5 Footprint Ladder — where does new capability go?

When proposing a new tool or capability, consult the **Footprint Ladder**
(see `AGENTS.md` for full details) and choose the **LOWEST rung** that
meets the need:

1. **extend** an existing tool with a new flag (0 new files)
2. **cli_skill** — `goli <cmd>` + SKILL.md (1 CLI file + 1 SKILL.md)
3. **service_gated_tool** — tool with `check_fn` (1 file, 0 schema cost when gated)
4. **plugin** in `~/.goli/plugins/` (1 file, not in core)
5. **mcp_server** — external MCP process (0 in core)
6. **core_tool** in `packages/tool-system/src/core/` (highest footprint)

In your PR description, state which rung you chose and why the lower rungs
are insufficient. PRs adding new core tools (rung 6) without justification
will be rejected.

Source: `packages/tool-system/src/footprint-ladder.ts`

---

## 8. Getting Help

- **Issues**: <https://github.com/goli-cli/goli-cli/issues>
- **Discussions**: <https://github.com/goli-cli/goli-cli/discussions>
- **Security**: `security@goli-cli.dev` (see `SECURITY.md`)
- **Roadmap**: see `docs/phases/README.md` for the 13-phase plan and current status

Thank you for helping build GOLI-CLI.
