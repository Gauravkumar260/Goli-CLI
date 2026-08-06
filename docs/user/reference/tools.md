# Reference: Tools

> Complete list of every built-in tool Goli-CLI exposes to the agent.

Tools are the agent's hands. Each tool is a TypeScript module in
`packages/tool-system/src/core/` that implements the `Tool` interface
(see [`docs/ai-agent/tool-schemas/README.md`](../../ai-agent/tool-schemas/README.md)
for the schema convention).

## File tools

| Tool             | Description                                    | Permission        | Schema                                                           |
| ---------------- | ---------------------------------------------- | ----------------- | ---------------------------------------------------------------- |
| `read_file`      | Read the contents of a file.                   | No                | [schema](../../ai-agent/tool-schemas/read-file.schema.json)      |
| `write_file`     | Write a file (full contents).                  | Yes               | [schema](../../ai-agent/tool-schemas/write-file.schema.json)     |
| `edit_file`      | Edit a file by replacing old_str with new_str. | Yes (diff review) | [schema](../../ai-agent/tool-schemas/edit-file.schema.json)      |
| `list_directory` | List directory contents.                       | No                | [schema](../../ai-agent/tool-schemas/list-directory.schema.json) |
| `notebook_edit`  | Edit a Jupyter notebook cell.                  | Yes               | (planned)                                                        |

## Search tools

| Tool   | Description                          | Permission | Schema                                                 |
| ------ | ------------------------------------ | ---------- | ------------------------------------------------------ |
| `grep` | Search file contents via ripgrep 14. | No         | [schema](../../ai-agent/tool-schemas/grep.schema.json) |
| `glob` | Find files by glob pattern.          | No         | [schema](../../ai-agent/tool-schemas/glob.schema.json) |

## Shell tools

| Tool               | Description                                   | Permission               | Schema                                                 |
| ------------------ | --------------------------------------------- | ------------------------ | ------------------------------------------------------ |
| `bash`             | Execute a shell command (allowlist-first).    | Yes (unless allowlisted) | [schema](../../ai-agent/tool-schemas/bash.schema.json) |
| `background_shell` | Spawn a long-running shell in the background. | Yes                      | (planned)                                              |

## Web tools

| Tool         | Description                             | Permission | Schema    |
| ------------ | --------------------------------------- | ---------- | --------- |
| `web_search` | Search the web (DuckDuckGo by default). | No         | (planned) |
| `web_fetch`  | Fetch a URL and return Markdown.        | No         | (planned) |

## Agent tools

| Tool             | Description                            | Permission | Schema                                                           |
| ---------------- | -------------------------------------- | ---------- | ---------------------------------------------------------------- |
| `ask_user`       | Ask the user a question.               | N/A        | (planned)                                                        |
| `todo_write`     | Write/update the agent's todo list.    | No         | [schema](../../ai-agent/tool-schemas/todo-write.schema.json)     |
| `spawn_subagent` | Spawn a subagent with its own context. | Yes        | [schema](../../ai-agent/tool-schemas/spawn-subagent.schema.json) |

## LSP tools (alongside tree-sitter)

| Tool                  | Description                  | Permission |
| --------------------- | ---------------------------- | ---------- |
| `lsp_hover`           | LSP hover info for a symbol. | No         |
| `lsp_goto_definition` | LSP goto definition.         | No         |
| `lsp_diagnostics`     | LSP diagnostics for a file.  | No         |

## Spec-driven development tools

| Tool            | Description            | Permission |
| --------------- | ---------------------- | ---------- |
| `spec_write`    | Write a spec file.     | Yes        |
| `spec_update`   | Update a spec file.    | Yes        |
| `spec_review`   | Review a spec file.    | No         |
| `spec_registry` | List registered specs. | No         |

## Diff / approval tools

| Tool            | Description                    | Permission     |
| --------------- | ------------------------------ | -------------- |
| `diff_approval` | Approve/reject a pending diff. | Yes            |
| `diff_utils`    | Helpers for diff operations.   | N/A (internal) |

## Path safety / streaming (internal)

| Tool             | Description                                        |
| ---------------- | -------------------------------------------------- |
| `path_safety`    | Path validation (TOCTOU-safe). Internal.           |
| `tool_streaming` | Streaming output for long-running tools. Internal. |

## Tool capabilities (the footprint ladder)

Every tool declares its **footprint** — the character budget it
consumes from the context window. See
[`docs/decisions/0025-hard-character-budgets.md`](../../decisions/0025-hard-character-budgets.md)
and `packages/tool-system/src/footprint-ladder.ts`.

| Footprint          | Tools                                                       |
| ------------------ | ----------------------------------------------------------- |
| Tiny (≤ 500 chars) | `read_file` (small), `grep` (few matches), `list_directory` |
| Small (≤ 5 KB)     | `read_file` (medium), `glob`, `web_search`                  |
| Medium (≤ 30 KB)   | `read_file` (large), `bash` (output), `web_fetch`           |
| Large (≤ 200 KB)   | `read_file` (very large), `bash` (verbose output)           |
| Unbounded          | `background_shell` (streamed, not budgeted)                 |

The footprint ladder is enforced; tools that exceed their budget are
truncated with a `[truncated]` marker.

## Tool registry

The tool registry (`packages/tool-system/src/registry.ts`) is
**self-registering** — built-in tools register at startup, and MCP
servers / plugins can add tools at runtime
([ADR 0044](../../decisions/0044-mcp-server-management.md)).

To list the tools available in a given session:

```bash
goli status --tools
```

To disable a tool for a session:

```bash
goli wakeup --disable-tool bash
```

## See also

- [Tool schemas](../../ai-agent/tool-schemas/) — JSON Schema for every
  tool.
- [MCP manifest](../../ai-agent/mcp/manifest.json) — which tools are
  exposed via MCP.
- [ADR 0014](../../decisions/0014-old-string-new-string-edits.md) —
  edit_file design.
- [ADR 0015](../../decisions/0015-allowlist-first-bash.md) — bash
  allowlist.
- [ADR 0018](../../decisions/0018-hooks-over-prompts.md) — hooks.
- [ADR 0037](../../decisions/0037-diff-first-editing.md) — diff-first.
- [ADR 0042](../../decisions/0042-tool-result-streaming.md) —
  streaming.
