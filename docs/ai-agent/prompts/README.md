# Prompt Templates

This directory holds **prompt templates** — reusable, parameterized
prompts that can be invoked via the MCP `prompts` capability or via
Goli-CLI's slash-command system.

A prompt template is a Markdown file with YAML front-matter:

```markdown
---
name: explain-codebase
description: Produce a high-level architectural overview of the codebase.
arguments:
  - name: focus
    description: Optional area to focus on (e.g. 'agent loop', 'sandbox', 'memory').
    required: false
---

# Explain the codebase

You are an expert software architect. Produce a high-level architectural
overview of the codebase in the current workspace.

{{#if focus}}
Focus on: **{{focus}}**.
{{/if}}

## Steps

1. Read `AGENTS.md` for project context.
2. Read `docs/architecture.md` if it exists.
3. Read `package.json` to understand the dependencies.
4. Read 3-5 representative source files (one per major area).
5. Produce a 300-word overview with:
   - What the system does.
   - The major modules and their responsibilities.
   - The key design decisions (with links to ADRs).
   - Anything surprising.

## Output format

Markdown, with section headings. Link to ADRs where relevant.
```

## Index

| Template           | File                                       | Description                                         |
| ------------------ | ------------------------------------------ | --------------------------------------------------- |
| `explain-codebase` | [explain-codebase.md](explain-codebase.md) | High-level architectural overview.                  |
| `find-bugs`        | [find-bugs.md](find-bugs.md)               | Identify likely bugs in a file or directory.        |
| `write-tests`      | [write-tests.md](write-tests.md)           | Generate unit tests for a source file.              |
| `refactor`         | [refactor.md](refactor.md)                 | Propose a refactor with motivation and steps.       |
| `code-review`      | [code-review.md](code-review.md)           | Review a PR or diff.                                |
| `add-tool`         | [add-tool.md](add-tool.md)                 | Scaffold a new tool (file + test + registry entry). |
| `add-adr`          | [add-adr.md](add-adr.md)                   | Scaffold a new ADR.                                 |
| `write-runbook`    | [write-runbook.md](write-runbook.md)       | Write an ops runbook for a scenario.                |

## Template syntax

Templates use [Handlebars](https://handlebarsjs.com/) syntax:

- `{{argument_name}}` — interpolated argument value.
- `{{#if argument_name}}...{{/if}}` — conditional block.
- `{{#each items}}...{{/each}}` — iteration.
- `{{argument_name | default("fallback")}}` — default value.

The template engine is `handlebars` with the `default` helper registered
(see `packages/core/src/agent/prompt-builder.ts`).

## Invocation

### Via MCP

```bash
goli mcp prompt explain-codebase --focus "agent loop"
```

### Via slash command (TUI)

```
/prompt explain-codebase focus="agent loop"
```

### Via HTTP (Studio)

```http
POST /api/prompts/explain-codebase
Content-Type: application/json

{ "arguments": { "focus": "agent loop" } }
```

(planned; not yet implemented in v0.3.)

## Authoring guidelines

- **One template per file.** The file name matches the `name` in the
  front-matter.
- **Self-contained.** The template should not assume any context beyond
  its arguments; the agent will not see the user's session history.
- **Step-by-step.** Break the prompt into numbered steps. The agent
  follows steps more reliably than prose.
- **Output format.** Always specify the output format (Markdown, JSON,
  code, etc.). The agent needs this to produce consistent results.
- **Tested.** Add a test in `tests/unit/prompt-templates.test.ts` that
  renders the template with sample arguments and asserts the output
  contains expected substrings.

## See also

- [MCP Prompts spec](https://modelcontextprotocol.io/docs/concepts/prompts)
- [packages/core/src/agent/prompt-builder.ts](../../../packages/core/src/agent/prompt-builder.ts)
  — the template engine.
- [docs/decisions/0041-custom-slash-commands.md](../../decisions/0041-custom-slash-commands.md)
  — slash-command system (which uses the same template format).
