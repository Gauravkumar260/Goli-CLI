# STYLEGUIDE.md — Goli-CLI Code Style Guide

> **Status:** Living document. Propose changes via PR to this file.

This guide is the **enforced** code style for the Goli-CLI monorepo. It is
backed by ESLint + Prettier configs that CI runs on every PR (`npm run verify`).
The rules below are the human-readable companion to
[`eslint.config.js`](eslint.config.js) and `.prettierrc`. When the linter and
this guide disagree, the linter wins (because the linter is what blocks the
PR) — please open an issue if you find a disagreement.

## 1. Languages and runtimes

| Concern         | Choice                                                                               |
| --------------- | ------------------------------------------------------------------------------------ |
| Runtime         | Node.js ≥ 20.18 (LTS)                                                                |
| Language        | TypeScript 5.7+, `strict: true`                                                      |
| Module system   | ESM (`"type": "module"` at the root)                                                 |
| Package manager | npm (workspace-aware) for the CLI/core/evals; bun is supported for `packages/studio` |
| Test runner     | Vitest 2.x                                                                           |
| Linter          | ESLint 9 flat-config + `@typescript-eslint`                                          |
| Formatter       | Prettier 3.x                                                                         |

Use `tsx` for running TypeScript directly during development
(`npm run dev`). Production builds use `tsup` for `@goli/cli` and
`tsc -b` for `@goli/core`.

## 2. File and directory layout

```
packages/
  core/                       # @goli-cli/core — agent loop, providers, tools, sandbox, memory
    src/
      <domain>/               # one folder per bounded context (agent, context, sandbox, ...)
        <name>.ts             # implementation
        <name>.test.ts        # unit test, colocated (NOT in a separate tests/ dir)
        index.ts              # barrel, exports the public API
    tsconfig.json
    package.json
  cli/                        # @goli-cli/cli — Ink + React 19 TUI
    src/
      tui/
        components/           # presentational components (.tsx)
        hooks/                # hooks (useXxx.ts)
        lib/                  # non-React utilities
        state/                # state stores
        theme/                # theme tokens + skin engine
      commands/               # Commander subcommands
      services/               # cross-cutting services (AgentLoop, etc.)
  evals/                      # @goli-cli/evals — eval harnesses
  vscode-ext/                 # @goli-cli/vscode-ext
  studio/                     # @goli-cli/studio — Next.js 16 web console (experimental)
docs/
  decisions/                  # ADRs, MADR format, 4-digit numbered
  design/                     # SDD, C4 diagrams, RFCs, OpenAPI
  requirements/               # PRD, SRS, FRD
  user/                       # Diátaxis: tutorials, how-to, reference, explanation
  qa/                         # test plan, test strategy, QA strategy
  ops/                        # runbooks, deployment, postmortems
  onboarding/                 # developer setup, 30-60-90
  cli/                        # command reference, man pages
  phases/                     # 13-phase implementation roadmap
tests/
  unit/                       # cross-package unit tests
  integration/                # cross-package integration tests
  e2e-docker/                 # containerized e2e
```

### Naming conventions

- **Files**: `kebab-case.ts` for modules (`local-llms-router.ts`),
  `PascalCase.tsx` for React components (`AgentStateBar.tsx`),
  `<name>.test.ts` for unit tests, `<name>.spec.ts` for integration tests.
- **Folders**: `kebab-case`. One bounded context per folder. A folder with
  > 12 files is a smell — split it.
- **Barrels**: every folder exports through `index.ts`. Never deep-import
  (`@goli/core/agent/loop` is forbidden; use `@goli/core` and let the barrel
  re-export).
- **Tests**: colocated with the source they test (`loop.ts` + `loop.test.ts`
  in the same folder) for unit tests. Cross-package tests live in the root
  `tests/` tree.

## 3. TypeScript rules

### 3.1 Strict mode and beyond

`tsconfig.json` enables `strict: true`, `noUncheckedIndexedAccess: true`,
`noImplicitOverride: true`, `exactOptionalPropertyTypes: true`. This is
non-negotiable. If the type system is fighting you, the answer is almost
always "fix the type" not "add an `any`".

### 3.2 Forbidden patterns (enforced by ESLint)

- **`any`** — forbidden. Use `unknown` + a narrowing function, or a proper
  type. The only allowed `any` is in third-party `.d.ts` shims.
- **`as` casts** — discouraged. Allowed only for type narrowing that the
  compiler cannot prove (`x as HTMLElement` after an `instanceof`). Never
  use `as` to silence a real type error.
- **`!` non-null assertion** — forbidden in app code. Allowed in tests
  when the setup guarantees the value.
- **`@ts-ignore` / `@ts-expect-error`** — forbidden without an inline
  comment explaining why. Use `@ts-expect-error` (not `@ts-ignore`) so the
  build fails when the underlying error is fixed.
- **`eslint-disable`** — must be on its own line with a reason:
  `// eslint-disable-next-line @typescript-eslint/no-explicit-any -- third-party type mismatch`.
- **`console.log`** — forbidden in production code. Use the `logger`
  utility (`@goli/core/utils/logger`). `console.error` is allowed at the
  top-level CLI entry point only.
- **`process.exit`** — forbidden except in `bin/goli.js` and the CLI
  command layer.
- **Un-awaited promises** — `no-floating-promises: error`. Every promise
  is either `await`ed or explicitly `.catch()`ed.
- **`==`/`!=`** — `eqeqeq: error`. Always `===`/`!==`.
- **`var`** — forbidden. `const` first, `let` if reassignment is needed,
  `let`-without-reassignment is a lint error.

### 3.3 Required patterns

- **Exhaustive switch** — when switching on a union, `default:` must call
  `assertNever(x)` (from `@goli/core/utils/errors`). This catches new
  union members at compile time.
- **Branded types** — IDs (`SessionId`, `RunId`, `ToolCallId`) are branded
  `string & { __brand: 'SessionId' }` to prevent cross-assignment.
- **`readonly`** — arrays and objects are `readonly` by default; mutation
  happens through copy-on-write.
- **Error classes** — errors extend `BaseError` (`@goli/core/utils/errors`)
  and have a stable `code` field for programmatic handling.

### 3.4 Imports

- Use `import type` for type-only imports (verbatim module syntax).
- Group imports: (1) Node built-ins, (2) external packages, (3) `@goli-cli/*`
  workspace packages, (4) relative imports. Blank line between groups.
- No circular imports between packages — enforced by `madge` in CI.

## 4. React and Ink (TUI + Studio)

The TUI uses **Ink v5 + React 19**. The Studio uses **Next.js 16 + React 19**.
The rules below apply to both.

### 4.1 Component rules

- **One component per file.** The file name matches the component name
  (`AgentStateBar.tsx` exports `AgentStateBar`).
- **Function components only.** No class components.
- **Hooks are pure.** No side effects in the hook body — side effects go in
  `useEffect`.
- **`useEffect` dependencies** — exhaustive-deps rule is on. If you must
  disable it for a reason, add a comment.
- **Memoization** — `useMemo`/`useCallback` only when there is a measured
  perf reason. Premature memoization is a code smell.
- **No `useReducer` for everything** — `useState` for simple state,
  `useReducer` for state machines, Zustand for cross-component state.
- **Server components by default** (Studio only) — opt into `'use client'`
  only when you need state, effects, or browser APIs.

### 4.2 JSX rules

- Self-close tags that have no children: `<Spinner />` not `<Spinner></Spinner>`.
- Boolean props are written without `={true}`: `<Spinner active />`.
- String props don't need braces: `<Label text="hello" />` not `<Label text={"hello"} />`.
- Destructure props in the function signature: `function Spinner({ active }: Props)`.
- Spread sparingly: `{...props}` is allowed but every explicit prop wins.

## 5. Async and concurrency

The agent loop is **single-threaded** by design (see
`docs/decisions/0009-single-threaded-loop.md`). All concurrency is
cooperative via `Promise.all` / `Promise.race` / `AbortController`.

- **Never block the event loop.** Long-running CPU work goes to a worker
  thread (see `packages/core/src/utils/worker-pool.ts`).
- **Always pass `AbortSignal`** to async functions that take more than
  ~10ms. The signal flows from the user's Ctrl-C all the way down.
- **Race conditions** — when ordering matters, use an explicit queue
  (`p-queue` is allowed) or a state machine, not "promise ordering".
- **Cancellation** — `AbortError` is the only cancellation mechanism. Do
  not invent custom cancellation tokens.

## 6. Testing

### 6.1 What to test

| Layer          | What we test                               | Tool                                             |
| -------------- | ------------------------------------------ | ------------------------------------------------ |
| Pure functions | Inputs → outputs, edge cases               | Vitest unit tests                                |
| State machines | All transitions, including illegal ones    | Vitest + stateless property tests (`fast-check`) |
| Hooks          | `renderHook` from `@testing-library/react` | Vitest                                           |
| Components     | Render output, user interactions           | `@testing-library/react` / `ink-testing-library` |
| Integration    | Multiple modules together                  | Vitest integration tests in `tests/integration/` |
| E2E            | Full CLI run in a sandbox                  | Vitest e2e in `tests/e2e-docker/`                |
| Eval           | SWE-bench-style tasks                      | `@goli-cli/evals`                                |

### 6.2 Coverage

- **Lines**: ≥ 80% for `packages/core` and `packages/cli`.
- **Branches**: ≥ 75%.
- Coverage is enforced on new code only (diff-coverage) by CI. The
  project-wide number is informational.

### 6.3 Test naming

```ts
describe('LocalLlmsRouter', () => {
  describe('detectSensitivity', () => {
    it('returns "restricted" when the prompt contains an SSN', () => { ... });
    it('returns " pii" when the prompt contains an email', () => { ... });
    it('returns "safe" for a normal coding question', () => { ... });
  });
});
```

- `describe` blocks mirror the structure of the unit under test.
- `it` statements read as a sentence: "it returns X when Y".
- One assertion per `it` when possible; multiple related assertions are OK
  with a comment.

## 7. Documentation

### 7.1 TSDoc

Every exported function, class, interface, and type has a TSDoc comment
with:

- A one-sentence summary.
- `@param` for each parameter (unless obvious from the type).
- `@returns` for non-void returns.
- `@throws` for thrown errors (with the error code).
- `@example` for non-trivial functions.

````ts
/**
 * Routes a prompt to the appropriate local model based on sensitivity and
 * complexity.
 *
 * @param prompt - The user's prompt, already-redacted if PII was found.
 * @param opts - Routing options (complexity thresholds, fallback chain).
 * @returns The routing decision, including the chosen model and the reason.
 * @throws {BaseError} with code `LOCAL_LLMS_UNAVAILABLE` if every model in
 *   the chain is in the OPEN circuit-breaker state.
 * @example
 * ```ts
 * const decision = route(prompt, { complexityThresholds: { ... } });
 * if (decision.sensitivity === 'restricted') { /* ... *\/ }
 * ```
 */
export function route(prompt: string, opts: RouteOpts): RouteDecision { ... }
````

### 7.2 ADRs (Architectural Decision Records)

Decisions that are hard to reverse go in `docs/decisions/` as
`NNNN-kebab-case-title.md`, MADR format, 4-digit numbered. See
`docs/decisions/0001-sandbox-as-trust-boundary.md` for the template.

### 7.3 README and docs

Every package has a `README.md` with: what it is, how to install, how to
use, the public API, and where to find more docs. Top-level docs live in
`docs/` and follow the [Diátaxis](https://diataxis.fr/) framework
(tutorials / how-to / reference / explanation).

## 8. Git hygiene

- **Branch naming**: `<type>/<short-description>` — `feat/local-llms-router`,
  `fix/sandbox-toctou`, `docs/sdd-update`, `chore/deps-bump`.
- **Commit messages**: [Conventional Commits](https://www.conventionalcommits.org/).
  `feat(core): add LocalLlmsRouter`, `fix(cli): prevent TUI flicker on
resize`, `docs(ops): add postmortem template`. The scope is the package
  name (`core`, `cli`, `evals`, `studio`, `vscode-ext`, `docs`, `infra`,
  `chore`).
- **Commit size** — small, atomic. A PR that does five things should be
  five PRs (or at minimum five commits, each passing CI).
- **`Signed-off-by`** — required (DCO). Configure `git config
format.signoff true`.
- **No force-push to `main`**. Rebase your branch; the maintainer will
  squash-merge.
- **No merge commits** in feature branches — rebase to keep history linear.

## 9. Performance budgets

The CLI has hard performance budgets enforced by `tests/unit/perf-baseline.test.ts`:

| Metric                 | Budget                    |
| ---------------------- | ------------------------- |
| Cold startup (no args) | ≤ 1.5s wall, ≤ 2.0s CPU   |
| Idle 5s                | ≤ 50ms CPU                |
| Token-bar update       | ≤ 16ms (1 frame at 60fps) |
| Heap (idle session)    | ≤ 100MB                   |

If your PR regresses a budget, you must either fix it or raise the budget
in `bench/baseline.json` with a justification in the PR description.

## 10. Accessibility

The TUI has a dedicated accessibility mode (`--screen-reader`). The Studio
targets WCAG 2.1 AA.

- Every interactive element has a keyboard equivalent.
- Color is never the only signal — pair it with an icon or text.
- Contrast ratio ≥ 4.5:1 for body text, ≥ 3:1 for large text and UI
  components.
- Animations respect `prefers-reduced-motion`.
- See `docs/a11y-report.md` for the full audit.

## 11. Security

- **No `eval`, no `Function` constructor, no `child_process.exec` with
  string concatenation.** Use `execFile` with arg arrays.
- **No `fs` writes outside the workspace root.** Enforced by
  `packages/sandbox/src/path-validation.ts`.
- **No network egress from the sandbox.** Enforced by the sandbox
  (Landlock / Seatbelt / cgroups).
- **Secrets in env vars, never in code.** `.env` is gitignored; `.env.example`
  is the contract.
- **SBOM gate** — `npm run sbom:check` runs in CI and fails on any
  GPL/AGPL dependency. See `docs/decisions/0004-sbom-gate.md`.

## 12. When in doubt

1. Read the existing code — find the most recent file in the same area and
   follow its conventions.
2. Read the ADRs in `docs/decisions/` — the decision you're about to make
   may already have been made.
3. Open an issue with `question` label if you're still unsure.
4. Match the surrounding code; if the surrounding code is wrong, fix it in
   a separate PR first, then come back to your change.
