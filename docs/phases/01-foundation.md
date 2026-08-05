# Phase 1 — Project Foundation & Compliance Baseline

**Status:** ✅ Complete
**Modules touched:** Foundation (no agent code)
**Compliance gates:** G1 (MIT license), G2 (SBOM clean)

## Goal

Lay down the repo, the TypeScript toolchain, the compliance baseline
(MIT license, SBOM gate, ADRs), and the skeleton source structure. No
agent code yet — Phase 2 begins that.

## Current Implementation Status

Foundation + compliance baseline shipped in Phase 1. MIT license, SBOM gate, npm workspaces monorepo, vitest, eslint, prettier, husky, tsup, default.toml config — all in place.

See the per-module sections in [docs/architecture.md](../architecture.md)
for the current code locations and `AGENTS.md` for accumulated
implementation patterns and gotchas.

## Definition of Done

- [x] Repository scaffolded with `src/`, `tests/`, `docs/`, `config/`, `scripts/`, `bin/`, `.github/workflows/`
- [x] MIT `LICENSE`, `NOTICE`, `AUTHORS`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`
- [x] `package.json` (ESM, Node 20+, TypeScript 5.7+, Vitest, tsup, ESLint flat config, Prettier)
- [x] `tsconfig.json` (strict mode, NodeNext module resolution)
- [x] `eslint.config.js` (flat config, typescript-eslint, jsdoc, import, n, promise, unicorn)
- [x] `vitest.config.ts` + `vitest.e2e.config.ts` (unit + integration + e2e separation)
- [x] `tsup.config.ts` (ESM-only, dts, banner with SPDX-License-Identifier)
- [x] `.github/workflows/ci.yml` (lint, typecheck, test, build, smoke)
- [x] `.github/workflows/sbom.yml` (Syft + Trivy; zero GPL/AGPL gate)
- [x] `.github/dependabot.yml` + `.github/CODEOWNERS`
- [x] `config/default.toml` (model, budget, retry, stall, sandbox, logging)
- [x] `src/utils/` (constants, errors, logger)
- [x] `src/config/` (schema with zod, TOML loader with env-var layering)
- [x] `src/cli/` (args parser, factory, main entry, bin launcher)
- [x] 35 unit tests passing
- [x] `npm run typecheck` clean
- [x] `npm test` clean
- [x] `goli --version` / `goli --help` / `goli "prompt"` all work (stub response)
- [x] ARCHITECTURE.md, README.md, PLAN.md, DECISIONS.md
- [x] 8 ADRs in `docs/decisions/`
- [x] Phase plan files in `docs/phases/01-foundation.md` … `13-orchestration.md`

## Steps

### 1.1 — 1.3: Repo scaffold + legal files

- Created `/home/z/my-project/download/goli-cli/` directory tree
- `git init -b main`
- Wrote `LICENSE` (MIT), `NOTICE`, `AUTHORS`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`

### 1.4: High-level docs

- Wrote `README.md` (overview, status, quick start, doc map, license)
- Wrote `ARCHITECTURE.md` (big-picture diagram, module map, Phase 1 as-built, design principles)
- Wrote `PLAN.md` (13-phase plan with high-level steps)

### 1.5 — 1.9: TypeScript toolchain

- `package.json`: ESM, Node 20+, TS 5.7+, Vitest, tsup, ESLint flat config, Prettier
- `tsconfig.json`: strict, NodeNext, JSX for Ink (Phase 3)
- `eslint.config.js`: flat config (eslint 9), typescript-eslint, jsdoc, import, n, promise, unicorn
- `.prettierrc.json`, `.prettierignore`, `.editorconfig`, `.npmrc`
- `.gitignore` (Node, build, secrets, runtime state)

### 1.10 — 1.11: Test runner + bundler

- `vitest.config.ts` (unit + integration; 70% coverage threshold)
- `vitest.e2e.config.ts` (separate config for slow e2e)
- `tests/setup.ts` (silence logger, deterministic TZ)
- `tsup.config.ts` (ESM, dts, banner with SPDX)

### 1.12: CI

- `.github/workflows/ci.yml`: install → typecheck → lint → format:check → test → build → smoke
- `.github/workflows/sbom.yml`: Syft → Trivy → license policy gate → npm audit → upload artifact
- `.github/dependabot.yml`: weekly npm + GitHub Actions updates
- `.github/CODEOWNERS`: security-critical paths require two teams

### 1.13: Default config

- `config/default.toml`: `[model]`, `[budget]`, `[retry]`, `[stall]`, `[sandbox]`, `[logging]`

### 1.14 — 1.16: Utils

- `src/utils/constants.ts`: `APP_NAME`, `APP_VERSION`, `APP_TAGLINE`, `DEFAULT_GOLI_HOME_DIRNAME`, etc.
- `src/utils/errors.ts`: `GoliError` abstract base + `ConfigNotFoundError`, `ConfigValidationError`, `GLMClientError`, `GLMTimeoutError`, `GLMHTTPError`, `GLMMalformedToolCallError`, `ToolValidationError`, `ToolExecutionError`, `SandboxError`, `SandboxDeniedError` + `isGoliError`, `wrapUnknown`
- `src/utils/logger.ts`: `createLogger`, `configureLogger`, `LogStream`, `LogLevel`, `LogContext`, child loggers, pretty/json formats, lifecycle sink

### 1.17 — 1.19: Config

- `src/config/schema.ts`: zod schemas for `ModelConfig`, `BudgetConfig`, `RetryConfig`, `StallConfig`, `SandboxConfig`, `LoggingConfig`, `AppConfig` + `DEFAULT_CONFIG`
- `src/config/loader.ts`: `loadConfig()` with 4-layer merge (defaults → repo TOML → user TOML → env vars)
- `src/config/index.ts`: public exports

### 1.20 — 1.24: CLI

- `src/cli/args.ts`: `parseArgs()`, `ParsedArgs`, `ParseResult`, `HELP_TEXT`
- `src/cli/factory.ts`: `createGoli()`, `Goli`, `GoliOptions`, `GoliRunInput`, `GoliRunResult` (Phase 1 stub)
- `src/cli/main.ts`: `runMain()`, dispatches on args, handles `--help`/`--version`
- `src/index.ts`: programmatic API exports
- `bin/goli.js`: binary launcher

### 1.25: Unit tests

- `tests/unit/cli-args.test.ts` (12 tests)
- `tests/unit/config-loader.test.ts` (9 tests)
- `tests/unit/errors.test.ts` (8 tests)
- `tests/unit/logger.test.ts` (6 tests)
- Total: 35 tests, all passing

### 1.26 — 1.27: ADRs + phase docs

- 8 ADRs (0001-0008) in `docs/decisions/`
- 13 phase detail docs in `docs/phases/`
- `docs/phases/README.md` index

### 1.28: Scripts

- `scripts/check-sbom.sh`: local SBOM policy check (Syft + jq)
- `bin/goli.js`: executable binary launcher

### 1.29 — 1.31: Verify + commit

- `npm install` ✅ (459 packages)
- `npm run typecheck` ✅ (strict, no errors)
- `npm test` ✅ (35/35 passing)
- Smoke test `goli --version` / `--help` / `"prompt"` ✅
- Worklog entry committed

## Deliverables

| Artifact          | Path                                    |
| ----------------- | --------------------------------------- |
| Project root      | `/home/z/my-project/download/goli-cli/` |
| README            | `README.md`                             |
| Architecture doc  | `ARCHITECTURE.md`                       |
| Plan doc          | `PLAN.md`                               |
| Default config    | `config/default.toml`                   |
| Public API        | `src/index.ts`                          |
| CLI binary        | `bin/goli.js`                           |
| Unit tests        | `tests/unit/`                           |
| ADRs              | `docs/decisions/0001-0008-*.md`         |
| Phase detail docs | `docs/phases/01-13-*.md`                |
| CI workflows      | `.github/workflows/{ci,sbom}.yml`       |
| CODEOWNERS        | `.github/CODEOWNERS`                    |
| Dependabot config | `.github/dependabot.yml`                |
| SBOM check script | `scripts/check-sbom.sh`                 |

## Compliance Gate Status

| Gate | Assertion                              | Status |
| ---- | -------------------------------------- | ------ |
| G1   | MIT license + attribution in repo root | ✅     |
| G2   | SBOM clean (zero GPL/AGPL) in CI       | ✅     |

## Next: Phase 2

Phase 2 builds the **Agent Core Loop** (Module 1): the GLM-5.2
OpenAI-compatible streaming client, the dynamic system-prompt
assembler, the ReAct single-threaded master loop with 4 stop
conditions, the TODO/planner engine, the retry/backoff layer, and
per-iteration token accounting. See `02-agent-core-loop.md`.
