# ADR-0041: Custom Slash Commands (H17)

**Date:** 2026-07-05
**Status:** Accepted
**Hermes Item:** H17 — Custom Slash Commands

## Context

GOLI-CLI had ~17 hardcoded slash commands in `CommandRegistry.ts`.
Users could not define their own. Claude Code allows users to drop
markdown files in `.claude/commands/` to define custom commands with
`$ARGUMENTS` substitution. This is a significant workflow
customization feature that GOLI-CLI lacked.

## Decision

Add a **custom command loader** that reads markdown files from two
directories:

1. `<workspaceRoot>/.goli/commands/*.md` — project-level
2. `~/.goli-cli/commands/*.md` (or `$GOLI_HOME/commands/`) — user-level

### File format

Each `.md` file has YAML frontmatter + a prompt template body:

```markdown
---
name: refactor
description: Refactor selected code
argument_hint: <file-path>
---

Refactor the following code to improve readability:

$ARGUMENTS

Apply these principles:

- Single Responsibility
- DRY
```

### Variable substitution

The body supports:

- `$ARGUMENTS` — replaced with the args passed to the command
- `$WORKSPACE` — replaced with the current workspace root
- `$DATE` — replaced with the current ISO date

### Precedence

1. Built-in commands (registered via `registerDefaultCommands`) —
   custom commands CANNOT override these.
2. Project-level commands (`.goli/commands/`)
3. User-level commands (`~/.goli-cli/commands/`)

If a project-level and user-level command have the same name, the
project-level one wins.

### Handler behavior

When the user types `/refactor src/parser.ts`, the handler:

1. Substitutes `$ARGUMENTS` → `src/parser.ts` in the body.
2. Pushes a system message `[custom command: /refactor]`.
3. Queues the substituted body as a message for the agent loop.

The agent loop picks up the message on its next tick and runs with
it — exactly as if the user had typed the body directly.

## Consequences

**Positive:**

- Users can define reusable prompts without touching code.
- Project-level commands travel with the repo (committed to git).
- User-level commands work across all projects.
- Team-shared commands (e.g., `.goli/commands/release.md`) standardize
  workflows.
- Backward-compatible: built-in commands are not affected.

**Negative:**

- The YAML parser is minimal (no nested objects, no arrays). For
  complex frontmatter, a real YAML parser would be needed. Mitigation:
  the frontmatter only needs `name`, `description`, `argument_hint` —
  all strings.
- Custom commands can't define their own validation (e.g., "require
  exactly 2 args"). Mitigation: the body is a prompt — the model
  handles validation.
- No namespacing (e.g., `@team/refactor`). Mitigation: use descriptive
  names (`team-refactor`).

## Alternatives Considered

### A. JSON config file (`.goli/commands.json`)

Rejected: markdown is more human-friendly for prompt templates
(multi-line, comments, formatting). JSON requires escaping newlines.

### B. TypeScript plugins (`.goli/commands/*.ts`)

Rejected: requires compilation, security risk (arbitrary code
execution). Markdown + template substitution is safer.

### C. TOML config (like `config/default.toml`)

Rejected: TOML doesn't handle multi-line strings as cleanly as
markdown frontmatter + body.

## Implementation

- `packages/cli/src/tui/lib/customCommands.ts` — `loadCustomCommands`,
  `getCustomCommandSearchDirs`, `LoadCustomCommandsResult`
- `tests/unit/custom-commands.test.ts` — 11 unit tests covering
  loading, precedence, error handling, template substitution

## Follow-up

- Call `loadCustomCommands()` from `App.tsx` on mount (alongside
  `registerDefaultCommands()`).
- Add `/commands` slash command to list all loaded custom commands.
- Add `goli commands list` CLI subcommand for headless discovery.
- Add hot-reload (watch `.goli/commands/` for changes).
- Support `@file:` mention syntax in the body (auto-include file
  contents in the prompt).
