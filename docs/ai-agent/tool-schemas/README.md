# Tool Calling Schemas

This directory holds the **JSON Schema** for every tool Goli-CLI exposes.
These schemas are the **single source of truth** — the TypeScript `Tool`
interface uses Zod schemas that are converted to JSON Schema at runtime
(`packages/core/src/tools/schema-validator.ts`), and this directory
mirrors the generated JSON Schema for documentation and MCP clients.

## Index

| Tool                  | Schema                                                             | Description                                    | Permission required      |
| --------------------- | ------------------------------------------------------------------ | ---------------------------------------------- | ------------------------ |
| `read_file`           | [read-file.schema.json](read-file.schema.json)                     | Read the contents of a file.                   | No                       |
| `write_file`          | [write-file.schema.json](write-file.schema.json)                   | Write a file (full contents).                  | Yes                      |
| `edit_file`           | [edit-file.schema.json](edit-file.schema.json)                     | Edit a file by replacing old_str with new_str. | Yes (with diff review)   |
| `list_directory`      | [list-directory.schema.json](list-directory.schema.json)           | List directory contents.                       | No                       |
| `bash`                | [bash.schema.json](bash.schema.json)                               | Execute a shell command (allowlist-first).     | Yes (unless allowlisted) |
| `grep`                | [grep.schema.json](grep.schema.json)                               | Search file contents via ripgrep.              | No                       |
| `glob`                | [glob.schema.json](glob.schema.json)                               | Find files by glob pattern.                    | No                       |
| `web_search`          | [web-search.schema.json](web-search.schema.json)                   | Search the web.                                | No                       |
| `web_fetch`           | [web-fetch.schema.json](web-fetch.schema.json)                     | Fetch a URL.                                   | No                       |
| `ask_user`            | [ask-user.schema.json](ask-user.schema.json)                       | Ask the user a question.                       | N/A                      |
| `todo_write`          | [todo-write.schema.json](todo-write.schema.json)                   | Write/update the agent's todo list.            | No                       |
| `spawn_subagent`      | [spawn-subagent.schema.json](spawn-subagent.schema.json)           | Spawn a subagent for a subtask.                | Yes                      |
| `notebook_edit`       | [notebook-edit.schema.json](notebook-edit.schema.json)             | Edit a Jupyter notebook cell.                  | Yes                      |
| `lsp_hover`           | [lsp-hover.schema.json](lsp-hover.schema.json)                     | LSP hover (alongside tree-sitter).             | No                       |
| `lsp_goto_definition` | [lsp-goto-definition.schema.json](lsp-goto-definition.schema.json) | LSP goto definition.                           | No                       |
| `lsp_diagnostics`     | [lsp-diagnostics.schema.json](lsp-diagnostics.schema.json)         | LSP diagnostics.                               | No                       |
| `spec_write`          | [spec-write.schema.json](spec-write.schema.json)                   | Write a spec file (spec-driven dev).           | Yes                      |
| `spec_update`         | [spec-update.schema.json](spec-update.schema.json)                 | Update a spec file.                            | Yes                      |
| `spec_review`         | [spec-review.schema.json](spec-review.schema.json)                 | Review a spec file.                            | No                       |
| `spec_registry`       | [spec-registry.schema.json](spec-registry.schema.json)             | List registered specs.                         | No                       |
| `background_shell`    | [background-shell.schema.json](background-shell.schema.json)       | Spawn a long-running shell in the background.  | Yes                      |
| `diff_approval`       | [diff-approval.schema.json](diff-approval.schema.json)             | Approve/reject a pending diff.                 | Yes                      |

## Schema convention

Every tool schema is a JSON Schema 2020-12 object with:

- `$schema` — `https://json-schema.org/draft/2020-12/schema`.
- `$id` — `goli://tools/<name>.schema.json`.
- `title` — the tool name in PascalCase.
- `description` — one-sentence description (used by the LLM).
- `type: object` with `properties`, `required`, and `additionalProperties: false`.
- Every property has a `description`.

Example (`read-file.schema.json`):

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "goli://tools/read-file.schema.json",
  "title": "ReadFile",
  "description": "Read the contents of a file. The path must be inside the workspace root.",
  "type": "object",
  "properties": {
    "path": {
      "type": "string",
      "description": "Path to the file, relative to the workspace root or absolute."
    },
    "offset": { "type": "integer", "minimum": 1, "description": "..." },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 2000,
      "description": "..."
    }
  },
  "required": ["path"],
  "additionalProperties": false
}
```

## Generation

The schemas in this directory are generated from the Zod schemas in
`packages/core/src/tools/core/<name>.ts` by running:

```bash
npm run gen:tool-schemas
```

(planned; currently the schemas are hand-mirrored). The generation
script is `scripts/gen-tool-schemas.ts` (planned). Do not edit the
JSON files by hand — edit the Zod schemas in the source and regenerate.

## Footprint ladder

Each tool also has a "footprint" — the character budget it consumes
from the context window. See
[`docs/decisions/0025-hard-character-budgets.md`](../../decisions/0025-hard-character-budgets.md)
and `packages/core/src/tools/footprint-ladder.ts` for the ladder. The
footprint is **not** part of the JSON Schema (it's a runtime concern)
but is documented in each tool's source file.

## MCP exposure

Not all tools are exposed via MCP. The MCP manifest at
[`../mcp/manifest.json`](../mcp/manifest.json) lists the tools that are
safe to expose to external MCP clients (read-mostly subset). Tools that
require the kernel sandbox (`bash`, `write_file`, `background_shell`)
are not exposed via MCP by default.
