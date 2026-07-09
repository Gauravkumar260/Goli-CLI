# ADR-0011: npm Workspaces Monorepo Structure

**Status:** Accepted
**Phase:** P2
**Date:** 2026-07-03

## Context

Phase 1 used a single-package structure (`src/` at the repo root). The
user's actual GOLI-CLI project uses an **npm workspaces monorepo** with
three packages:

| Package | Purpose |
|---------|---------|
| `@goli/core` | Agent loop, tools, safety, context, model providers |
| `@goli/cli` | TUI entry, commands, Ink UI, sandbox Dockerfile |
| `@goli/evals` | Evaluation harness, batch runners |

This separation is important because:
1. **The core package can be embedded** in other applications (VS Code
   extension, web dashboard, CI runner) without pulling in the TUI.
2. **The evals package has heavy dependencies** (SWE-bench, Promptfoo)
   that shouldn't be in the CLI's dependency tree.
3. **Build isolation**: each package has its own `tsconfig.json` with
   project references, enabling incremental builds.

## Decision

Migrate GOLI-CLI to an **npm workspaces monorepo** with three packages:

```
goli-cli/
├── package.json              ← workspaces: ["packages/*"]
├── tsconfig.json             ← project references
├── packages/
│   ├── core/                 ← @goli/core (agent, tools, config, utils)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   ├── cli/                  ← @goli/cli (commands, TUI, services)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   └── evals/                ← @goli/evals (eval harness — Phase 12)
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
```

### Key decisions

1. **Workspace dependency format**: Use `"@goli/core": "*"` (not
   `"workspace:*"`). npm doesn't support the `workspace:` protocol
   (that's pnpm/yarn only).
2. **TypeScript project references**: Each package has `composite: true`
   and references its dependencies. The root `tsconfig.json` has
   `references` to all three packages.
3. **Cross-package imports**: Use `@goli/core` (the workspace alias),
   not relative paths like `../../core/src`. This keeps imports clean
   and lets the packages be published independently if needed.
4. **Build order**: `npm run build` runs `--workspaces`, which builds
   in dependency order (core → cli, evals).
5. **Test runner**: Vitest at the root level with aliases pointing to
   package source. Per-package `vitest.config.ts` will be added if
   needed in later phases.

## Consequences

**Positive:**
- Clean separation of concerns.
- Core can be embedded in non-CLI contexts.
- Evals dependencies don't bloat the CLI.
- Incremental builds via project references.
- Aligns with the user's actual project structure.

**Negative:**
- More boilerplate (3 `package.json`, 3 `tsconfig.json`).
- Workspace setup requires `npm install` at the root (not per-package).
- Cross-package refactoring needs to update both packages.

## Implementation

- Root `package.json`: `"workspaces": ["packages/core", "packages/cli", "packages/evals"]`
- Root `tsconfig.json`: `references` to all three packages + `paths` for IDE support
- Each package: `composite: true`, `declaration: true`, `outDir: ./dist`
- `@goli/cli` depends on `@goli/core`; `@goli/evals` depends on `@goli/core`
- npm creates symlinks in `node_modules/@goli/*` → `packages/*`

## References

- npm workspaces: <https://docs.npmjs.com/cli/v10/using-npm/workspaces>
- TypeScript project references: <https://www.typescriptlang.org/docs/handbook/project-references.html>
- User's AGENTS.md describing the monorepo structure
