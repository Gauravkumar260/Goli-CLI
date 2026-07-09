# ADR-0012: Commander.js for CLI Subcommands

**Status:** Accepted
**Phase:** P2
**Date:** 2026-07-03

## Context

Phase 1 used a hand-rolled argument parser (`src/cli/args.ts`). This was
sufficient for the Phase 1 single-command CLI (`goli [prompt]`), but
the user's project has **seven subcommands**:

| Command | Purpose |
|---------|---------|
| `goli wakeup [prompt]` | Wake up the 11-agent swarm |
| `goli doctor` | Check system requirements and environment health |
| `goli status` | Show health dashboard and active session stats |
| `goli audit` | Verify safety audit log integrity |
| `goli usage` | Show model usage and cost breakdown |
| `goli commit` | Apply pending changes from a session to your host |
| `goli init` | Initialize GOLI.md and build the index |

Plus global flags (`--debug`, `--model`, `--god`, `--auto`, `--sandbox`,
`--effort`) that apply to all subcommands.

Hand-rolling this would require: subcommand routing, per-command help
text, flag inheritance, `--help` per subcommand, argument validation,
and error handling for unknown subcommands. That's a lot of code to
maintain and test.

## Decision

Use **Commander.js** (`commander` npm package) for CLI argument parsing.

Rationale:
1. **Industry standard**: The most-used Node CLI framework. Used by
   `npm`, `yarn`, `pnpm`, `eslint`, `prettier`, and thousands more.
2. **MIT licensed**: SBOM-clean (see ADR-0004).
3. **Subcommand support**: First-class. `program.command('wakeup [prompt]')`
   just works.
4. **Global options**: Options on the program are inherited by
   subcommands.
5. **Auto-generated help**: `--help` and `-h` work out of the box, per
   subcommand and globally.
6. **TypeScript support**: Ships its own types.
7. **Small footprint**: ~50KB minified.

## What we DON'T use from Commander

- **`program.action()`**: We use per-command `.action()` instead, so
  the root `goli` (no subcommand) prints help.
- **`program.parse()` synchronous mode**: We use `.parseAsync()` for
  async command handlers.

## Consequences

**Positive:**
- 7 subcommands implemented in ~100 lines of clean code.
- Auto-generated help for every command.
- Global flags work across all subcommands.
- Easy to add new commands (one `.command()` + one action handler).

**Negative:**
- Added `commander` dependency (~50KB).
- Commander's option parsing is slightly opinionated (e.g. camelCase
  conversion of `--my-flag` to `opts.myFlag`).
- The hand-rolled Phase 1 parser is removed; Phase 1 tests for it are
  replaced with tests for the new `extractGlobalOptions` helper.

## Implementation

- `packages/cli/src/index.ts` — `createProgram()` builds the Commander
  program with all 7 subcommands
- `packages/cli/src/commands/` — one file per command (`wakeup.ts`,
  `doctor.ts`, `status.ts`, `audit.ts`, `usage.ts`, `commit.ts`,
  `init.ts`)
- `packages/cli/src/commands/types.ts` — shared `CommandContext` +
  `extractGlobalOptions` + `buildCommandContext`
- Each command handler: `async function runXxx(): Promise<number>`
  (returns exit code)

## References

- Commander.js: <https://github.com/tj/commander.js> (MIT)
- User's project description naming the 7 subcommands
