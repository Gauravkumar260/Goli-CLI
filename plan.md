# Plan: npm Publish — Package Rename + tsup Bundling + Release Script

## Goal

Rename `apps/cli` package from `@goli/cli` to `@goli-cli/cli` (matching the `@goli-cli/*` convention used by all sibling packages), switch its build from `tsc` to `tsup` (bundling all JS/TS deps into a self-contained `dist/index.js`), and add the root `release:cli` publish script.

## Current State (verified)

### Package config
- `apps/cli/package.json` named `@goli/cli`, builds with `tsc -p tsconfig.json`, ships `dependencies` (11 packages), has `types: ./dist/index.d.ts`
- `apps/cli/tsup.config.ts` does **not** exist
- Root `tsup.config.ts` exists — externalizes deps for dev builds (different purpose)
- **`tsup` is NOT installed anywhere** in the repo. Verified: ZERO matches in root `package.json` and `package-lock.json`. It will be installed fresh at `npm install` via the new `apps/cli` devDep `tsup: ^8.3.5`
- **Sibling `@goli-cli/*` package versions are all `0.1.0`** (not `0.3.0`). Repo convention is `"*"` workspace specs
- **`@goli-cli/sandbox` is directly imported** by the CLI: `apps/cli/src/commands/audit.ts:27` (static) + `apps/cli/src/tui/lib/CommandRegistry.ts:761` (dynamic) — NOT purely transitive. Include it in devDependencies
- **`.gitignore` already covers `apps/*/dist/` and `apps/*/*.tsbuildinfo`** (unanchored `dist/` + `*.tsbuildinfo`). `git check-ignore` confirms. No `.gitignore` change needed (Phase 4 removed)

### `@goli/cli` references
- **Runtime code**: `packages/shared/src/utils/env-loader.ts:69` — `pkg.name === '@goli/cli'`
- **Vitest aliases**: `vitest.config.ts:58-59` (must stay BEFORE generic `^@goli-cli/([^/]+)/(.+)$` at line 67)
- **Test imports** (6 files, 10 import statements): tool-system, config (×3), approval, agent-core
- **Test assertions** (2 files): `docs-expansion.test.ts:31` (asserts `docs/architecture.md`), `docs-expansion-t051.test.ts:43` (asserts `docs/api/README.md`) — docs and assertions must change together
**Docs (live)**:
- `docs/api/README.md` — 7 references: table (line 28), text (line 35), section header (line 264), examples (336, 365, 380, 408)
- `docs/architecture.md:12`; `STYLEGUIDE.md:25`; `CONTRIBUTING.md:42`; `docs/ai-agent/prompts/write-tests.md:42`; `legal/ai-bom.spdx.json:74`
- **Comments**: `apps/cli/src/index.ts:2,31`, `apps/cli/bin/goli.js:6`

### Already using `@goli-cli/cli` (no change needed)
- `docs/requirements/srs.md:21`, `docs/design/sdd.md:195`, `docs/design/diagrams/c4-diagrams.md:91`, `docs/ai-agent/claude/CLAUDE-cli.md`, `CLAUDE-evals.md:14`, `CLAUDE-core.md:11`

### Historical (DO NOT TOUCH)
- `CHANGELOG.md:175`, `docs/decisions/0011*`, `0017*`, `0005*`, `AGENTS.md:24,636`

### Legacy `@goli/evals` alias (DO NOT TOUCH)
- `vitest.config.ts:9,60-61` — actual package is `@goli-cli/evals`; no test files import from `@goli/evals`

## Resolved Contradiction: "Zero runtime deps" is not fully achievable

| Dep | Type | Can tsup bundle? | Action |
|---|---|---|---|
| `zod` | Pure JS | Yes | Add to `noExternal` (verified: root-hoisted `node_modules/zod`, imported by tool-system/config/memory-engine) |
| `better-sqlite3` | Native C++ addon | No | Add to `optionalDependencies` |

**Resolution**: Add `'zod'` to `noExternal` (bundled). Add `better-sqlite3` as `optionalDependencies`. No `dependencies` field.

**Graceful-degradation caveat (verified)**: better-sqlite3 is statically installed by `context-engine/symbol-graph/sqlite.ts` and `memory-engine/{trajectory/store,session/search-store}`. The memory-engine **barrel** statically re-exports `TrajectoryStore` → ESM evaluates `trajectory/store.ts` on barrel load. `commands/index.ts:22` statically imports `@goli-cli/context-engine`; `wakeup.ts`/`CliAgentLoop.ts` statically import `@goli-cli/memory-engine`. Entry point (`--version`/TUI) is safe via try/catch at `apps/cli/src/index.ts:439,470`. But if the addon is genuinely missing, `goli wakeup` / `goli index` throw an uncatchable native-addon error at the subcommand dynamic import. Acceptable: the addon installs normally; don't promise full graceful degradation.

## Design Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Rename `@goli/cli` → `@goli-cli/cli` | All siblings + docs already use `@goli-cli/*`; `release:cli` uses new name |
| D2 | `onSuccess` uses `node -e` not `chmod` | Current env is Windows (`win32`); `chmod` fails there |
| D3 | No `dts: true` | Binary package, not a library import target. Tests resolve via vitest aliases to source |
| D4 | No `outDir` in tsup config | Defaults to `apps/cli/dist/` (config dir + `/dist`), matching `bin`/`main` paths |
| D5 | Add `'zod'` to `noExternal` | Pure JS, can be bundled. Eliminates the only non-native transitive dep |
| D6 | `better-sqlite3` as `optionalDependencies` | Native module, cannot be bundled. `--version`/TUI unaffected via entry try/catch |
| D7 | ~~`.gitignore` gap fix~~ **REMOVED** | `git check-ignore` proves `apps/cli/dist/` + `tsconfig.tsbuildinfo` already ignored by unanchored patterns |
| D8 | Vitest `@goli/evals` alias stays | Dead compat code; no test files import from it |
| D9 | Add `engines.node` to CLI package.json | Best practice. Root already has `>=20.18.0` |
| D10 | `@goli-cli/*` devDeps use `"*"` | Repo convention (siblings are `0.1.0`, `^0.3.0` would be false metadata) |
| D11 | Include `@goli-cli/sandbox` in devDeps | Directly imported (`audit.ts`, `CommandRegistry.ts`) — not purely transitive |

## Exact File Changes

### Phase 1: Package identity + build config

**`apps/cli/package.json`** (rewritten):
```json
{
  "name": "@goli-cli/cli",
  "version": "0.3.0",
  "description": "GOLI-CLI — user-facing interactive Terminal UI (Ink/React), command parsing, and binary distribution.",
  "type": "module",
  "license": "MIT",
  "author": "GOLI-CLI Contributors <contrib@goli-cli.dev>",
  "bin": { "goli": "./dist/index.js" },
  "main": "./dist/index.js",
  "files": ["dist"],
  "engines": { "node": ">=20.18.0" },
  "publishConfig": { "access": "public" },
  "scripts": {
    "build": "tsup",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "clean": "rm -rf dist tsconfig.tsbuildinfo",
    "smoke": "node dist/index.js --version"
  },
  "devDependencies": {
    "@goli-cli/agent-core": "*",
    "@goli-cli/config": "*",
    "@goli-cli/context-engine": "*",
    "@goli-cli/memory-engine": "*",
    "@goli-cli/sandbox": "*",
    "@goli-cli/shared": "*",
    "@goli-cli/tool-system": "*",
    "@types/node": "^22.10.2",
    "@types/react": "18.3.31",
    "commander": "^12.1.0",
    "ink": "5.2.1",
    "react": "18.3.1",
    "supports-hyperlinks": "4.5.0",
    "tsup": "^8.3.5",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  },
  "optionalDependencies": {
    "better-sqlite3": "12.11.1"
  }
}
```

Key changes vs current: `name`, `build` → `tsup`, removed `types`, removed `dependencies` (11 entries), added `tsup`/`engines`/`optionalDependencies`, `@goli-cli/*` kept at `"*"`, added `@goli-cli/sandbox`.

**`apps/cli/tsup.config.ts`** (new file):
```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  clean: true,
  banner: { js: '#!/usr/bin/env node' },
  noExternal: [/^@goli-cli\//, 'ink', 'react', 'commander', 'supports-hyperlinks', 'zod'],
  onSuccess: 'node -e "require(\'fs\').chmodSync(\'dist/index.js\', 0o755)"',
});
```

**Root `package.json`** — two additions:
- `"private": true` after `"version"`
- `"release:cli": "npm publish -w @goli-cli/cli --provenance --access public"` in scripts

### Phase 2: Alias + import migration

**`vitest.config.ts`** — update the CLI aliases (`^@goli/cli...` → `^@goli-cli/cli...`) AND the line-9 comment (`Kept legacy @goli/cli, @goli/evals` → `Kept legacy @goli/evals`). **ORDERING INVARIANT**: the `@goli-cli/cli` regexes MUST remain before the generic `^@goli-cli/([^/]+)/(.+)$` alias at line 67.

**`packages/shared/src/utils/env-loader.ts:69`**: `'@goli/cli'` → `'@goli-cli/cli'` (keep `'goli-cli'` for root name).

**`apps/cli/src/index.ts:2,31`** + **`apps/cli/bin/goli.js:6`**: comment updates.

**Test files** — change all `@goli/cli/...` imports to `@goli-cli/cli/...`:
1. `packages/tool-system/__tests__/mcp-extension-api.test.ts:29`
2. `packages/config/__tests__/policy-integrity-t064.test.tsx:26`
3. `packages/config/__tests__/local-llms-router.test.ts:628`
4. `packages/config/__tests__/cli-args.test.ts:14`
5. `packages/approval/__tests__/round2-reverification-fixes.test.ts:36,37,38`
6. `packages/agent-core/__tests__/reverification-fixes.test.ts:32,33`

**Test assertions** — change `@goli/cli` → `@goli-cli/cli`:
1. `apps/cli/__tests__/docs-expansion.test.ts:31` — with `docs/architecture.md:12`
2. `apps/cli/__tests__/docs-expansion-t051.test.ts:43` — with `docs/api/README.md:28`

### Phase 3: Documentation + metadata

- `docs/api/README.md` — 7 references (lines 28, 35, 264, 336, 365, 380, 408) `@goli/cli` → `@goli-cli/cli`
- `docs/architecture.md:12`, `STYLEGUIDE.md:25`, `CONTRIBUTING.md:42`, `docs/ai-agent/prompts/write-tests.md:42` — `@goli/cli` → `@goli-cli/cli`
- `legal/ai-bom.spdx.json:74` — `"name": "@goli/cli"` → `"name": "@goli-cli/cli"`

### Phase 4: Gitignore
**REMOVED** — no-op (patterns already unanchored + present).

## Execution Order

1. Phase 1 (3 files)
2. Phase 2 (12 files)
3. Phase 3 (6 files)
4. `npm install` — regenerates lockfile, re-links workspace under `@goli-cli/cli`, fresh-installs `tsup` through apps/cli devDeps
5. `npm run build` — turbo builds all `@goli-cli/*` deps via tsc, then CLI via tsup
6. `npm test`
7. `npm run lint` — exit 0
8. `npm run typecheck` — exit 0
9. `node apps/cli/dist/index.js --version` — standalone

## Validation

| Check | Command | Expected |
|---|---|---|
| tsup bundles | `npm run build` | `apps/cli/dist/index.js` created, >1MB |
| Standalone binary | `node apps/cli/dist/index.js --version` | Prints version, no import errors |
| Tests pass | `npm test` | 0 failures (exit 0) |
| env-loader recognizes new name | `grep '@goli-cli/cli' packages/shared/src/utils/env-loader.ts` | Found |
| No `@goli/cli` in live code | `rg -t ts -t json '@goli/cli' packages/ apps/ scripts/` | 0 results maintained (`-t ts` covers `.ts/.cts/.mts/.tsx`; `-t tsx` is NOT a valid ripgrep type); SBOM/migration check separate |
| SBOM updated | `grep '@goli-cli/cli' legal/ai-bom.spdx.json` | Line 74 matches |
| `.gitignore` already covers apps | `git check-ignore apps/cli/dist/index.js` | Prints path (ignored) |
| tsup resolves | `npm ls tsup` | Workspace `apps/cli` |
| Private root | `grep '"private"' package.json` | `true` |
| `release:cli` script | `grep 'release:cli' package.json` | `npm publish -w @goli-cli/cli --provenance --access public` |
| Optional dep | `grep better-sqlite3 apps/cli/package.json` | Found in `optionalDependencies` |
| `zod` in noExternal | `grep zod apps/cli/tsup.config.ts` | Found |

## Risks (resolved)

| # | Risk | Resolution |
|---|---|---|
| 1 | Bundle size | Large bundle (Ink + React + all `@goli-cli/*`). Acceptable for a CLI binary — downloaded once |
| 2 | Dynamic import behavior | `@goli-cli/*` in `noExternal` → bundled as internal chunks, dynamic `import()` preserved as lazy-loaded chunks |
| 3 | `--provenance` requires CI | Documented. Script correct for CI; local publish fails. Use CI to publish |
| 4 | Root `tsup.config.ts` conflict | Different files, different directories. Root externalizes (dev); CLI bundles (publish) |
| 5 | `better-sqlite3` native module | `optionalDependencies`. `--version`/TUI unaffected (entry try/catch `index.ts:439,470`); `wakeup`/`index` subcommands throw if addon genuinely missing (addon installs normally) |
| 6 | `zod` left external | Added to `noExternal` (pure JS, verified root-hoisted) |
| 7 | Windows `chmod` | `node -e "require('fs').chmodSync(...)"` instead of `chmod +x` |
| 8 | Missing `engines` on published package | `engines.node >= 20.18.0` in CLI package.json |
| 9 | `.gitignore` doesn't cover `apps/*/dist/` | Already covered — no Phase 4 |
| 10 | Vitest alias for `@goli/evals` | Left as-is (dead code, no test imports it) |
| 11 | Alias ordering | `@goli-cli/cli` regexes stay before generic `^@goli-cli/` aliases |
| 12 | Sibling version metadata | `@goli-cli/*` devDeps pinned `"*"` (repo convention, avoids false `^0.3.0` against actual `0.1.0`) |
| 13 | `@goli-cli/sandbox` de-clarification | Declared in devDeps (directly imported) |
| 14 | Bundled deps invisible to scanners | `ink`/`react`/`commander` are physically inside `dist/index.js` but live in devDependencies → won't appear in `npm ls`/`npm audit`/dependency-scanners on the published artifact. Accepted visibility gap (documented) — add a manual note in release notes / SBOM gen scope if scanner must see them |

## Notes

- `apps/cli/tsconfig.json` stays unchanged (`composite: true`, `declaration: true`) — `typecheck` still `tsc --noEmit`, only `build` → `tsup`
- `tsup` resolves `@goli-cli/*` through their built `dist/` — turbo's `build.dependsOn: ["^build"]` guarantees topological ordering (verified in `turbo.json`; no manual double-build needed)
- Root `"goli": "node apps/cli/dist/index.js"` script unchanged and continues to work
- `apps/cli/bin/goli.js` is separately dead code (not referenced by `bin`). Out of scope to remove