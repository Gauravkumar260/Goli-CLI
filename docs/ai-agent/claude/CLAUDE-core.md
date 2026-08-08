# CLAUDE.md — `@goli-cli/core`

> **Audience:** Claude Code working in `packages/agent-core/`.
> **Parent:** [`/CLAUDE.md`](../../../CLAUDE.md).

## Package purpose

`@goli-cli/core` is the agent IP — the agent loop, providers, tools,
sandbox, memory, evals, and orchestration. It has **no UI** and **no
I/O** (no `console.log`, no `process.exit`, no terminal). It exposes a
clean public API consumed by `@goli-cli/cli`, `@goli-cli/evals`, and
`@goli-cli/vscode-ext`.

The Studio does **not** import `core` — it re-implements the agent loop
in `apps/studio/src/lib/agent/` to keep the web bundle web-native.

## Critical files

| File                                      | Purpose                                   |
| ----------------------------------------- | ----------------------------------------- |
| `src/index.ts`                            | Public barrel. Re-exports ~188 modules.   |
| `src/agent/loop.ts`                       | The ReAct loop (async generator).         |
| `src/agent/local-llms-router.ts`          | PII gating + complexity router.           |
| `src/providers/router.ts`                 | Multi-provider LLM client.                |
| `src/tools/registry.ts`                   | Tool registry (built-in + MCP + plugins). |
| `src/sandbox/landlock.ts`                 | Linux sandbox (kernel-enforced).          |
| `src/sandbox/seatbelt.ts`                 | macOS sandbox.                            |
| `src/memory/sica/loop.ts`                 | SICA self-improvement loop.               |
| `src/context/indexer/real-tree-sitter.ts` | Code indexer (ADR 0046).                  |
| `src/config/loader.ts`                    | TOML config loader + Zod schema.          |

## Architecture rules

1. **`core` never imports from `cli` / `studio` / `evals` / `vscode-ext`.**
   Enforced by ESLint `no-restricted-imports`.
2. **`core` never does I/O.** Use the `logger` (which is silent by
   default), not `console.*`. Use `process.exit` only in the bin entry
   point, not in `core`.
3. **The agent loop is single-threaded** (ADR 0009). Concurrency is
   cooperative via `Promise.all` + `AbortSignal`.
4. **Hooks are deterministic** (ADR 0018). They are TypeScript functions,
   not prompt-based safety.
5. **The sandbox is the trust boundary** (ADR 0001). The agent is
   untrusted; even a fully-compromised agent cannot escape the sandbox.

## Patterns to follow

- **Async generators** for streaming. The agent loop is an
  `async function*` that yields `AgentEvent` objects. Consumers
  iterate and react.
- **Branded types** for IDs. `SessionId`, `RunId`, `ToolCallId` are
  branded `string` types to prevent cross-assignment.
- **`readonly` everywhere.** Arrays and objects are `readonly` by
  default; mutation happens through copy-on-write.
- **Exhaustive switches** with `assertNever(x)` in the `default:` case.
  Catches new union members at compile time.
- **Errors extend `BaseError`.** Every error has a stable `code` field
  for programmatic handling.

## Common pitfalls

- **Calling the loop directly** — the loop is an async generator. Always
  iterate it (`for await (const event of loop.run(...))`); never call
  `.next()` manually.
- **Forgetting `AbortSignal`** — every async function that takes >10ms
  must accept an `AbortSignal` and check it. The signal flows from the
  user's Ctrl-C.
- **Deep imports** — never `import { ... } from
'@goli-cli/agent-core/loop'`. Use the barrel.
- **Adding a new tool without a hook** — every tool that can write to
  disk or execute code needs at least one hook (e.g.
  `block-writes-outside-workspace`).

## Tests

- **Unit tests:** `*.test.ts`, colocated. Run with `npm test --workspace
@goli-cli/core`.
- **Coverage:** ≥ 80% lines.
- The agent loop itself has an integration test at
  `tests/integration/agent-loop-e2e.test.ts` that runs a full
  end-to-end turn with a Mock provider.

## See also

- [docs/design/sdd.md#3-package-goliclicore](../../../docs/design/sdd.md)
- [docs/decisions/](../../../docs/decisions/) — 47 ADRs back every
  architectural choice.
- [AGENTS.md](../../../AGENTS.md) — the canonical living-patterns doc.
