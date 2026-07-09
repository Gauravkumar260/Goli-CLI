# Contributing to GOLI-CLI

First off — thank you for taking the time to contribute. GOLI-CLI is an
enterprise AI coding agent, and the bar for trust is therefore unusually
high. This document spells out what that means in practice.

> **TL;DR**: Fork → branch → write code + tests + docs → run `pnpm verify` →
> open a PR. Every PR must pass CI (lint, typecheck, unit tests, SBOM gate,
> SWE-bench 50-instance regression subset). AI-assisted PRs are welcome
> **iff** a human author signs off and the contribution honors the
> [AI Authorship Policy](docs/decisions/0008-ai-authorship-policy.md).

---

## 1. Project Layout

```
goli-cli/
├── src/
│   ├── agent/            # Module 1 — core loop (Phase 2)
│   ├── context/          # Module 2 — context engine (Phase 7)
│   ├── tools/            # Module 3 — tool layer + MCP (Phases 4, 6)
│   ├── sandbox/          # Module 4 — sandboxing & execution (Phase 5)
│   ├── memory/           # Module 5 — memory & self-improvement (Phases 8-11)
│   ├── evals/            # Module 6 — evals & observability (Phase 12)
│   ├── orchestration/    # Module 7 — multi-agent & routing (Phase 13)
│   ├── tui/              # Ink + React terminal UI (Phase 3)
│   ├── config/           # TOML config loader + zod schema
│   ├── utils/            # logger, errors, shared types
│   └── cli/              # CLI entry + arg parser
├── config/               # default.toml, sandbox.toml, observability.toml …
├── docs/                 # architecture, ADRs, phase plans, runbooks
├── tests/{unit,integration,e2e}/
├── scripts/              # dev helpers, SBOM check, eval runner
├── bin/                  # the `goli` shell launcher
└── .github/workflows/    # ci.yml, sbom.yml, evals.yml
```

Every source directory has a `README.md` describing the module's purpose,
public API, and integration points. If you add a new directory, add a README.

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

| Script                 | What it does                                         |
| ---------------------- | ---------------------------------------------------- |
| `npm run build`        | Compile TypeScript via `tsup` to `dist/`             |
| `npm run dev`          | Run the CLI in dev mode (`tsx src/cli/main.ts`)      |
| `npm run typecheck`    | `tsc --noEmit` — strict, no emit                     |
| `npm run lint`         | ESLint flat-config over `src/`, `tests/`, `scripts/` |
| `npm run lint:fix`     | ESLint with `--fix`                                  |
| `npm run format`       | Prettier write                                       |
| `npm run format:check` | Prettier check (CI mode)                             |
| `npm test`             | Vitest unit + integration tests                      |
| `npm run test:e2e`     | Vitest e2e (slow; not run by `npm test`)             |
| `npm run verify`       | typecheck + lint + format:check + test — the PR gate |
| `npm run sbom:check`   | Syft SBOM + Trivy policy check (zero GPL/AGPL)       |

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

- Throw typed errors from the `src/utils/errors.ts` hierarchy
  (`GLMClientError`, `SandboxError`, `ToolError`, `ConfigError`).
- Never swallow errors silently. At minimum, log at `warn` level with
  context.
- Use `Result<T, E>` pattern (from `src/utils/result.ts`, Phase 2) for
  operations whose failure is expected and recoverable (e.g. tool dispatch).

### 3.4 Tests

- **Vitest** is the test runner. Co-locate unit tests with source:
  `src/agent/glm-client.ts` ↔ `src/agent/glm-client.test.ts`.
- **Every public function must have at least one test.** Private helpers
  are tested through the public surface.
- Integration tests live in `tests/integration/` and may use real I/O
  (filesystem, network mocked via `msw`).
- E2E tests in `tests/e2e/` spawn the actual CLI binary and exercise
  end-to-end flows.
- **CI runs a 50-instance SWE-bench Verified subset on every PR**. A
  regression of >2% from baseline blocks merge
  (see `docs/decisions/0011-eval-gate.md`).
- **Current test suite size: 3053 tests** (across unit, integration, and
  e2e suites — see `docs/coverage-report.md` for coverage metrics).
- **Provider system**: The project supports multiple LLM providers
  (Ollama, OpenAI, Anthropic, Gemini). The default is Ollama
  (`ollama/gpt-oss:120b`). To test without an API key, use
  `npm run goli -- --demo -p "hello"` (MockAgentLoop).

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
- **Security-critical code** (`src/sandbox/`, `src/tools/hooks/`,
  `src/sica/`, `src/evals/redteam/`) requires **two human reviewers**,
  regardless of whether AI was involved.
- **Trajectories of AI-assisted tasks** may be logged to the trajectory
  store (Module 5) and used for fine-tuning, subject to the contributor's
  opt-in via the `goli-contributor-agreement.md` (added in a later phase).

---

## 6. Security & Compliance

- **Sandbox is the trust boundary** (Module 4). Any change to
  `src/sandbox/` requires a security review and a red-team test pass.
- **Hooks are deterministic guardrails** (Module 3). Any change to
  `src/tools/hooks/builtin/` requires a security review.
- **SBOM is gated in CI**. Adding a GPL/AGPL dependency will block the PR.
  See `docs/decisions/0006-sbom-gate.md`.
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
6. **core_tool** in `packages/core/src/tools/core/` (highest footprint)

In your PR description, state which rung you chose and why the lower rungs
are insufficient. PRs adding new core tools (rung 6) without justification
will be rejected.

Source: `packages/core/src/tools/footprint-ladder.ts`

---

## 8. Getting Help

- **Issues**: <https://github.com/goli-cli/goli-cli/issues>
- **Discussions**: <https://github.com/goli-cli/goli-cli/discussions>
- **Security**: `security@goli-cli.dev` (see `SECURITY.md`)
- **Roadmap**: see `PLAN.md` for the 13-phase plan and current status

Thank you for helping build GOLI-CLI.
