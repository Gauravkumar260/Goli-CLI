# AGENTS.md — Specification

> **Status:** v1.0
> **Last updated:** 2026-07-25

`AGENTS.md` is a plain-Markdown file that lives at the root of a
repository. It is read by AI coding agents (Goli-CLI, Claude Code,
Cursor, Continue, Aider, etc.) at startup and injected into the agent's
system prompt. It is the canonical **living-patterns & gotchas** doc for
a codebase.

This spec defines the file format, the loading order, and the
expectations agents should have when reading it.

## 1. File location

`AGENTS.md` lives at the root of the repository. Additional
`AGENTS.md` files may exist in subdirectories; they are loaded **in
addition to** the root file, not instead of it.

```
my-repo/
├── AGENTS.md              ← root (always loaded)
├── packages/
│   ├── core/
│   │   └── AGENTS.md      ← loaded when working in packages/agent-core/
│   └── cli/
│       └── AGENTS.md      ← loaded when working in apps/cli/
└── tests/
    └── AGENTS.md          ← loaded when working in tests/
```

User-wide and repo-local overrides:

- `~/.goli/AGENTS.md` — user-wide patterns (e.g. "I prefer tabs over
  spaces"). Loaded after the root `AGENTS.md`.
- `./.goli/AGENTS.md` — repo-local overrides (e.g. "this fork uses
  different conventions"). Loaded after the user-wide file.

## 2. File format

`AGENTS.md` is plain Markdown. There is no required structure, but the
following sections are recommended:

```markdown
# AGENTS.md — <repo name>

> One-paragraph description of the codebase.

## Project structure

A short tour of the directory layout. Aim for 10-20 lines.

## Conventions

The conventions an agent should follow: naming, file organization,
error handling style, test naming, etc.

## Common pitfalls

Things that have gone wrong before and how to avoid them. Each pitfall
should have a one-line description and a one-line fix.

## Testing

How to run tests, what frameworks are used, where tests live, what
coverage is expected.

## Build / verify

The exact commands to build, lint, typecheck, and verify the codebase.

## External dependencies

What dependencies are critical, what they're used for, and any gotchas
(license issues, version pinning, native modules).

## See also

Links to ADRs, RFCs, design docs, and other resources the agent should
be aware of.
```

## 3. Loading order

When an agent starts, it loads `AGENTS.md` files in this order (later
files override earlier ones — patterns in a more-specific file win):

1. `<package>/AGENTS.md` for the package the agent is working in.
2. `AGENTS.md` (root).
3. `~/.goli/AGENTS.md` (user-wide).
4. `./.goli/AGENTS.md` (repo-local).
5. `<current-directory>/AGENTS.md` (if the agent is working in a
   subdirectory with its own `AGENTS.md`).

The agent's system prompt is constructed by concatenating all loaded
`AGENTS.md` files, separated by horizontal rules.

## 4. Mutability

`AGENTS.md` is **mutable**. The agent is encouraged to add new patterns
and gotchas as it discovers them. However:

- The agent **MUST NOT** delete or modify existing entries without
  explicit user approval.
- The agent **MUST** commit changes to `AGENTS.md` in a separate commit
  with the message `docs(agents): <description>`.
- The agent **MUST NOT** add speculative entries — only patterns that
  have actually caused a problem should be recorded.

## 5. AGENTS.md vs CLAUDE.md vs .cursorrules

| File           | Audience         | Mutability           | Required?                      |
| -------------- | ---------------- | -------------------- | ------------------------------ |
| `AGENTS.md`    | All agents       | Mutable by the agent | Yes (CI-enforced for Goli-CLI) |
| `CLAUDE.md`    | Claude Code only | Human-only           | Optional                       |
| `.cursorrules` | Cursor only      | Human-only           | Optional                       |
| `GEMINI.md`    | Gemini CLI only  | Human-only           | Optional                       |

Goli-CLI's agent reads **only `AGENTS.md`**, never `CLAUDE.md` or
`.cursorrules`. The other files are for the other agents.

## 6. CI enforcement

Goli-CLI's CI enforces the following:

1. `AGENTS.md` exists at the repo root.
2. `AGENTS.md` is non-empty (≥ 10 lines).
3. `AGENTS.md` has been updated in the last 90 days (warning, not
   failure).
4. Every PR that touches `src/` also touches `AGENTS.md` if it
   introduces a new pattern (best-effort, via a `docs-needed` label).

## 7. Example

See the Goli-CLI repo's own [`AGENTS.md`](../../AGENTS.md) for a worked
example. It's a 42 KB file that has accumulated patterns over 7 months
of development.
