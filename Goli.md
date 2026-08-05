# Goli.md — Goli-CLI

> **Audience:** Claude Code (and any agent that follows the Goli.md
> convention). Goli-CLI's own agent reads [`AGENTS.md`](AGENTS.md)
> instead — but the content overlaps.

This file is the **root** of the 3-level Goli.md hierarchy. It gives
Claude Code a concise project context. Package-specific Goli.md files
live in [`docs/ai-agent/claude/`](docs/ai-agent/claude/) and are loaded
in addition to this file when Claude is working in that package.

## Project

Goli-CLI is an **enterprise-grade, open-weight-first AI coding agent**
for the terminal. It's an npm workspaces monorepo with five packages:

- `packages/core` — agent loop, providers, tools, sandbox, memory, evals.
- `packages/cli` — Ink + React 19 TUI.
- `packages/evals` — SWE-bench + semantic + redteam harnesses.
- `packages/vscode-ext` — VS Code extension (experimental).
- `packages/studio` — Next.js 16 web console (experimental).

The CLI is the canonical surface; the Studio is opt-in. The agent IP
lives in `core` and is shared.

## Tech stack

- **Runtime:** Node.js ≥ 20.18 LTS.
- **Language:** TypeScript 5.7+, strict mode.
- **Module system:** ESM (`"type": "module"`).
- **Package manager:** npm workspaces (Studio also supports bun).
- **TUI:** Ink v5 + React 19.
- **Studio:** Next.js 16 + React 19 + Tailwind 4 + shadcn/ui (New York).
- **DB (Studio only):** Prisma + SQLite.
- **AI SDK (Studio only):** z-ai-web-dev-sdk (server-side).
- **Tests:** Vitest 2.x.
- **Lint:** ESLint 9 flat-config.
- **Format:** Prettier 3.x.

## Common commands

```bash
npm install                 # install all workspace deps
npm run dev                 # run the CLI in dev mode
npm run verify              # typecheck + lint + format:check + test
npm test                    # run all unit + integration tests
npm run test:e2e            # run e2e tests (docker required)
npm run build               # build all workspaces
npm run studio:dev          # start the Studio web console (experimental)
npm run studio:runtime      # start the Studio agent runtime (socket.io :3003)
npm run bench               # run perf benchmarks
npm run sbom:check          # verify SBOM policy (zero GPL/AGPL)
```

## Project structure

```
packages/
  core/                       # @goli-cli/core
    src/
      agent/                  # ReAct loop, retry, loop detection, SICA
      providers/              # Anthropic, OpenAI, Gemini, Ollama, Mock
      tools/                  # Built-in tools, MCP client, hooks, registry
      sandbox/                # Landlock / Seatbelt / cgroups
      approval/               # Permission engine, blast radius
      context/                # Tree-sitter, hybrid retrieval, compaction
      memory/                 # 3-tier memory + SICA + trajectory
      evals/                  # SWE-bench, semantic-error-rate, redteam
      observability/          # OTel, Langfuse, alerts
      orchestration/          # Worktrees, subagents, swarm
      config/                 # TOML loader, schema
      i18n/                   # locale catalogs
      utils/                  # logger, errors, json-utils
    tsconfig.json
    package.json
  cli/                        # @goli-cli/cli
    src/
      tui/                    # Ink + React 19 UI
        components/
        hooks/
        lib/
        state/
        theme/
      commands/               # Commander subcommands
      services/               # AgentLoop services
  evals/                      # @goli-cli/evals
  vscode-ext/                 # @goli-cli/vscode-ext
  studio/                     # @goli-cli/studio (Next.js 16 web console)
docs/                         # this directory
tests/                        # cross-package integration + e2e
infra/                        # k8s + docker-compose for self-hosting
config/                       # default TOML config
python_ml/                    # GRPO training + eval scripts
scripts/                      # build / bench / SBOM scripts
bin/                          # the `goli` executable
```

## Conventions

- **File names:** `kebab-case.ts` for modules, `PascalCase.tsx` for
  components, `<name>.test.ts` for unit tests, `<name>.spec.ts` for
  integration tests.
- **Imports:** ESM, `import type` for types. Group: built-ins →
  external → `@goli-cli/*` → relative.
- **No `any`.** Use `unknown` + narrowing. The only allowed `any` is in
  third-party `.d.ts` shims.
- **No `console.log`.** Use the `logger` from `@goli/core/utils/logger`.
- **No floating promises.** `no-floating-promises: error` is on.
- **Strict equality** — `===` only; `==` is a lint error.
- **Tests colocated** with source (`loop.ts` + `loop.test.ts` in the
  same folder).
- **ADRs** for hard-to-reverse decisions. `docs/decisions/NNNN-*.md`,
  MADR format, 4-digit numbered.

## Testing

- **Unit tests:** `*.test.ts`, colocated with source. Run with `npm
test`.
- **Integration tests:** `tests/integration/*.test.ts`. Run with `npm
test`.
- **E2E tests:** `tests/e2e-docker/`. Run with `npm run test:e2e`
  (requires Docker).
- **Coverage:** ≥ 80% lines for `packages/core` and `packages/cli`.
- **Perf baselines:** `tests/unit/perf-baseline.test.ts` enforces cold
  startup ≤ 1.5s, idle 5s ≤ 50ms CPU, etc.

## Build / verify

```bash
npm run verify                # typecheck + lint + format:check + test (run before every PR)
```

CI runs `npm run verify` + `npm run sbom:check` on every PR. PRs are
not mergeable until both pass.

## Common pitfalls

- **Forgetting `--workspace`** — `npm run dev` runs the root dev script,
  not the package's. Use `npm run dev --workspace @goli-cli/cli` to run
  a package's script.
- **Deep imports** — never `import { ... } from '@goli/core/agent/loop'`.
  Use the barrel: `import { ... } from '@goli/core'`.
- **Touching the sandbox** — the sandbox is kernel-enforced. Don't add
  userspace path checks that bypass it; if you need a path checked, ask
  the sandbox.
- **`bun.lock` vs `package-lock.json`** — the root uses npm
  (`package-lock.json`). Only `packages/studio` supports bun (and uses
  its own `bun.lock`).
- **Studio is experimental** — don't break the CLI to fix the Studio.
  If a change is Studio-only, scope it to `packages/studio/`.

## External dependencies

- **Ink v5** — React 19 renderer for the terminal. Forked by Google
  (`@jrichman/ink@6.6.9`) for gemini-cli; we use the upstream Ink v5.
- **better-sqlite3** — native SQLite bindings for the CLI's session
  store. Native module; requires `node-gyp` on install.
- **sqlite-vec** — vector search plugin for SQLite. Used by the hybrid
  retrieval layer.
- **tree-sitter** — native bindings for code parsing. Used by the
  context engine (ADR 0046).
- **ripgrep 14** — bundled as a binary fallback when system `rg` is
  missing or too old.
- **Prisma 6** — Studio only. The CLI does not depend on Prisma.
- **z-ai-web-dev-sdk** — Studio only. The CLI uses direct provider SDKs.

## See also

- [AGENTS.md](AGENTS.md) — the canonical living-patterns doc.
- [docs/decisions/](docs/decisions/) — 46 ADRs.
- [docs/design/sdd.md](docs/design/sdd.md) — Software Design Document.
- [docs/design/diagrams/c4-diagrams.md](docs/design/diagrams/c4-diagrams.md)
  — C4 architecture diagrams.
- [docs/requirements/](docs/requirements/) — PRD, SRS, FRD.
- [docs/user/](docs/user/) — Diátaxis user docs (tutorials, how-to,
  reference, explanation).
- [packages/studio/README.md](packages/studio/README.md) — Goli Studio
  (web console) README.
- [STYLEGUIDE.md](STYLEGUIDE.md) — enforced code style.

## Package-specific Goli.md

When working in a specific package, also read its Goli.md:

- [packages/core → docs/ai-agent/claude/CLAUDE-core.md](docs/ai-agent/claude/CLAUDE-core.md)
- [packages/cli → docs/ai-agent/claude/CLAUDE-cli.md](docs/ai-agent/claude/CLAUDE-cli.md)
- [packages/evals → docs/ai-agent/claude/CLAUDE-evals.md](docs/ai-agent/claude/CLAUDE-evals.md)
- [packages/studio → docs/ai-agent/claude/CLAUDE-studio.md](docs/ai-agent/claude/CLAUDE-studio.md)
