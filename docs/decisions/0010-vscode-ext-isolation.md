# ADR 0010: VS Code Extension Isolation

**Status:** Accepted
**Date:** 2026-07-05 (iteration 14)
**Task:** T-010

## Context

Goli-CLI is an npm workspaces monorepo with three workspace packages:

- `packages/core` — the agent brain (@goli/core)
- `packages/cli` — the TUI + binary (@goli/cli)
- `packages/evals` — evaluation harness (@goli/evals)

The VS Code extension lives at `packages/vscode-ext/` but is **NOT** listed in the root `package.json` `workspaces` array. This was flagged in iteration 0 as an architectural inconsistency (T-010).

## Decision

**Keep `packages/vscode-ext/` outside the npm workspaces.** Document the rationale here.

## Rationale

The VS Code extension cannot be an npm workspace package because:

1. **The `vscode` module is not on the public npm registry.** It is a special module provided by the VS Code runtime at extension-activation time. Adding `packages/vscode-ext` to workspaces would cause `npm install` to fail with `Cannot find module 'vscode'` because npm tries to resolve all workspace dependencies from the registry.

2. **The extension has a different distribution channel.** VS Code extensions are packaged as `.vsix` files and published to the [VS Code Marketplace](https://marketplace.visualstudio.com/), not to npm. The build tooling (`vsce package`) is specific to VS Code extensions and doesn't use the npm publish flow.

3. **The extension's dependencies conflict with the monorepo's.** The extension needs `@types/vscode` (a dev dependency that provides the `vscode` module types), which has a different version cadence than the rest of the monorepo. Mixing them would cause peer-dependency warnings.

4. **The extension's `package.json` has VS Code-specific fields** (`engines.vscode`, `activationEvents`, `contributes`, `main` pointing to a compiled `.js` file) that npm workspaces doesn't understand and would warn about.

5. **The extension is built separately.** It uses its own `tsc` invocation (not the root `npm run build`) because it needs to compile against the `vscode` type definitions. Adding it to workspaces would make `npm run build` fail in CI environments without VS Code's type definitions installed.

## Consequences

### Positive

- `npm install` works in any environment (no `vscode` module needed)
- The extension can be developed, tested, and published independently
- The monorepo's build/test/lint pipeline doesn't break when the extension's deps change
- Contributors who only want the CLI don't need to install VS Code's toolchain

### Negative

- `npm run build` doesn't build the extension (must run `cd packages/vscode-ext && npm run build` separately)
- `npm test` doesn't test the extension (the extension has 0% coverage — see `docs/coverage-report.md`)
- The extension's `@goli/core` dependency must be resolved via the workspace symlink, which works but requires the core to be built first

### Mitigation

- The root `package.json` has a `build:vscode-ext` script (to be added) that builds the extension after building core
- The extension's `package.json` documents the manual build step in its own README
- A future iteration could add a CI job that builds + lints the extension separately (with `@types/vscode` installed)

## Alternatives Considered

### Alternative 1: Add `vscode` as an optional dependency

Rejected. The `vscode` module is not installable from npm at all — it's injected by the VS Code runtime. There is no npm package called `vscode` (only `@types/vscode` for type definitions, which is a dev dependency).

### Alternative 2: Use a separate package manager for the extension

Rejected. Adds complexity for no benefit. The extension's deps are simple enough that a standalone `package.json` with `npm install` inside `packages/vscode-ext/` works fine.

### Alternative 3: Move the extension to a separate repo

Rejected. The extension imports from `@goli/core` (via the workspace symlink), so it needs to live in the same repo. A separate repo would require publishing `@goli/core` to npm first, which isn't happening until Phase 13 GA.

## Implementation Notes

- `packages/vscode-ext/package.json` is a standalone package (not in workspaces)
- It does **not** declare `@goli/core` in its own `dependencies` — the `@goli/core` workspace symlink is hoisted to the root `node_modules/@goli/core`, so the extension resolves it via Node's module resolution (walk up the directory tree from `packages/vscode-ext/dist/` until `node_modules/@goli/core` is found). This works because the extension runs inside the monorepo during development. For published `.vsix` packages, a future iteration will bundle `@goli/core` into the extension via `esbuild` or `vsce`'s bundling step.
- The root `.gitignore` excludes `packages/vscode-ext/node_modules/` (covered by the global `node_modules/` pattern)
- The root `eslint.config.js` lints `packages/vscode-ext/src/**/*.ts` (covered by the `packages/*/src/**/*.ts` pattern)

## References

- [VS Code Extension API](https://code.visualstudio.com/api)
- [vsce packaging tool](https://github.com/microsoft/vscode-vsce)
- Goli-CLI coverage report: `docs/coverage-report.md` (notes vscode-ext at 0% coverage)
- npm workspaces docs: https://docs.npmjs.com/cli/v7/using-npm/workspaces
