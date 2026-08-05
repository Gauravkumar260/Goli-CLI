---
name: add-tool
description: Scaffold a new tool (file + test + registry entry).
arguments:
  - name: name
    description: The tool name in snake_case (e.g. 'semantic_search').
    required: true
  - name: description
    description: One-sentence description of what the tool does.
    required: true
---

# Add a new tool: {{name}}

You are a Goli-CLI maintainer. Scaffold a new tool named `{{name}}` that
{{description}}.

## Steps

1. Read `AGENTS.md` for the project's conventions on tools.
2. Read `STYLEGUIDE.md` for the enforced code style.
3. Read an existing tool as a template:
   `packages/core/src/tools/core/read-file.ts` is a good starting
   point.
4. Read `packages/core/src/tools/registry.ts` to understand how tools
   are registered.
5. Read `packages/core/src/tools/types.ts` for the `Tool` interface.
6. Read `docs/decisions/0014-old-string-new-string-edits.md`,
   `0015-allowlist-first-bash.md`, `0018-hooks-over-prompts.md`, and
   `0037-diff-first-editing.md` for the design principles tools must
   follow.
7. Read `docs/ai-agent/tool-schemas/README.md` for the schema
   convention.

## Output

Create three files:

### 1. `packages/core/src/tools/core/{{name}}.ts`

The tool implementation. Must export a `{{name}}Tool` constant of type
`Tool`. The implementation should:

- Use Zod for the input schema (the registry converts Zod → JSON Schema
  at runtime).
- Implement `execute(input, ctx)` returning a `ToolResult`.
- Use the `logger` from `@goli/core/utils/logger` (never `console.*`).
- Accept an `AbortSignal` via `ctx.signal` and check it in any loop
  that takes >10ms.
- Use the sandbox (`ctx.sandbox`) for any filesystem or process work.
- Be ≤ 200 lines (split helpers into a separate file if needed).

### 2. `packages/core/src/tools/core/{{name}}.test.ts`

Unit tests, colocated. Must cover:

- Happy path (1-2 tests).
- Edge cases (empty input, max-size input, invalid path, etc.).
- Error cases (sandbox violation, abort signal, etc.).
- Permission: the test should verify the tool respects the permission
  mode if it requires permission.

Aim for ≥ 90% line coverage.

### 3. `docs/ai-agent/tool-schemas/{{name}}.schema.json`

The JSON Schema for the tool's input, following the convention in
`docs/ai-agent/tool-schemas/README.md`.

## Also update

- `packages/core/src/tools/registry.ts` — register the new tool.
- `packages/core/src/index.ts` — re-export the new tool.
- `docs/ai-agent/tool-schemas/README.md` — add a row to the index.
- `docs/ai-agent/mcp/manifest.json` — add the tool to the MCP manifest
  **if** it's safe to expose externally (read-only, no sandbox
  required).
- `CHANGELOG.md` — add an entry under "Unreleased".

## Verify

Run `npm run verify` and fix any failures. Run `npm test -- {{name}}`
to run just the new tests.

## What NOT to do

- **Don't add the tool to the bash allowlist.** Bash is its own tool;
  new tools are separate.
- **Don't skip the test.** Untested tools are not merged.
- **Don't expose the tool via MCP if it writes to disk or executes
  code.** Those tools require the sandbox; MCP clients may not have it.
