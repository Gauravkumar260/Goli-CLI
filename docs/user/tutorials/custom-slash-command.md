# Tutorial: Writing a Custom Slash Command

> **Audience:** A user who wants to add their own slash commands.
> **Time:** ~10 minutes.
> **Goal:** Create a custom slash command `/refactor` that asks the
> agent to refactor the file under the cursor.

## What you'll do

You'll create a custom slash command in `~/.goli/commands/refactor.md`
that the agent will recognize in the TUI. The command will take a file
path and a goal, and the agent will propose a refactor.

## Step 1: Create the commands directory

```bash
mkdir -p ~/.goli/commands
```

## Step 2: Write the command

Create `~/.goli/commands/refactor.md`:

```markdown
---
description: Propose a refactor of a file. Usage: /refactor <path> <goal>
---

# Refactor

You are a senior software engineer. Propose a refactor of the file at
`$1` to achieve the goal: **$2**.

## Steps

1. Read `AGENTS.md` for project context.
2. Read `STYLEGUIDE.md` for the project's conventions.
3. Read the file at `$1`.
4. Read the tests for `$1` (look for `$1.test.ts` in the package's `__tests__/` directory).
5. Find callers of the file's exports (use `grep`).
6. Read relevant ADRs in `docs/decisions/`.

## Output

Produce a Markdown document with:

1. **Current state** — 100 words on how the file is structured today.
2. **Proposed change** — 200 words on the refactored structure.
3. **Steps** — a numbered list of small, reviewable steps.
4. **Risks** — what could go wrong, and the rollback plan.
5. **Alternatives considered** — 1-2 alternatives and why you rejected them.

Do NOT apply the refactor. This is a proposal only.
```

The `$1` and `$2` are positional arguments — they're replaced with the
first and second word after the slash command.

## Step 3: Use the command

Start Goli-CLI in any project:

```bash
cd ~/my-project
goli wakeup
```

In the TUI, type:

```
/refactor src/lib/agent/loop.ts "extract the retry logic into its own module"
```

Press Enter. The agent will run the prompt with `$1` replaced by
`src/lib/agent/loop.ts` and `$2` replaced by the goal string.

## Step 4: List your custom commands

Type `/help` in the TUI. You'll see `/refactor` listed under
"Custom commands":

```
Custom commands:
  /refactor <path> <goal>   Propose a refactor of a file.
```

## Argument syntax

Custom commands support:

- **Positional args**: `$1`, `$2`, ..., `$N` — replaced with the Nth
  word after the command. Words with spaces must be quoted.
- **All args**: `$@` — replaced with all arguments as a single string.
- **Stdin**: `$(stdin)` — replaced with the contents of stdin (for
  piping).
- **Front-matter**: `description` (shown in `/help`), `alias` (a
  short alias), `hidden` (don't show in `/help`).

## Where commands can live

Goli-CLI looks for commands in three places (later overrides earlier):

1. `~/.goli/commands/*.md` — user-wide (your personal commands).
2. `./.goli/commands/*.md` — project-local (committed to the repo).
3. `<workspace>/.goli/commands/*.md` — workspace-local (for monorepos).

Project-local commands are great for team-shared commands like
`/release-checklist` or `/onboarding-summary`.

## What you've learned

- How to write a custom slash command.
- How argument substitution works.
- Where commands can live (user / project / workspace).

## Where to go next

- **Reference: [Slash commands](../reference/slash-commands.md)** —
  full list of built-in slash commands and the custom-command format.
- **How-to: [Write a custom hook](../how-to/custom-hook.md)** —
  hooks are the deterministic counterpart to custom commands.
- **ADR: [0041-custom-slash-commands.md](../../decisions/0041-custom-slash-commands.md)**
  — the design decision behind custom commands.
