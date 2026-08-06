# Phase 4 — Tool Layer & Core Tools (Module 3, part 1)

**Status:** Complete
**Modules touched:** M3 (tool registry, core tools, truncation)
**Compliance gates:** none new

## Goal

Build the tool registry, JSON Schema validation, tool-result truncation,
and the five core tools: `read_file`, `write_file`, `edit_file`
(old_string/new_string exact-match), `list_directory`, `grep` (ripgrep
wrapper). End of Phase 4: the agent can read, write, edit, search files
via tool calls (no sandbox yet — Phase 5 adds that).

## Current Implementation Status

Tool registry + JSON Schema validation (schema-validator.ts) + truncation + parallel execution + footprint-ladder + checkpoint-manager + 6 core tools (read_file, write_file, edit_file, list_directory, grep, bash) all shipped at packages/tool-system/src/. Additional gap tools (web_search, web_fetch, todo_write, ask_user, notebook_edit, background_shell, spawn_subagent) and spec-driven tools (spec_write, spec_review, spec_update) and 4 LSP tools (lsp_hover, lsp_goto_definition, lsp_references, lsp_diagnostics) also landed — total 21 registered tools.

See the per-module sections in [docs/architecture.md](../architecture.md)
for the current code locations and `AGENTS.md` for accumulated
implementation patterns and gotchas.

## Definition of Done

- [ ] `src/tools/types.ts` — `Tool`, `ToolResult`, `ToolInput`, `ToolSchema`
- [ ] `src/tools/registry.ts` — central dispatch + namespacing + per-tool token accounting
- [ ] `src/tools/schema-validator.ts` — Ajv-based JSON Schema validation
- [ ] `src/tools/truncation.ts` — size-check + oldest-first + 4000-token cap + recovery hint
- [ ] `src/tools/core/read-file.ts` — `read_file` tool (with line range support)
- [ ] `src/tools/core/write-file.ts` — `write_file` tool (atomic write)
- [ ] `src/tools/core/edit-file.ts` — `edit_file` tool (old_string/new_string, uniqueness, Read-before-Edit tracking, replace_all)
- [ ] `src/tools/core/list-directory.ts` — `list_directory` tool (respects .gitignore)
- [ ] `src/tools/core/grep.ts` — `grep` tool (ripgrep JSON output wrapper)
- [ ] `src/tools/core/bash.ts` — `bash` tool STUB (no sandbox yet; Phase 5 wires sandbox)
- [ ] Integration with the agent loop (Phase 2): tools registered, dispatch wired
- [ ] Unit tests for each tool (≥90% coverage)
- [ ] Integration test: agent reads file, edits file, greps, all via tool calls
- [ ] ADR-0014 (old_string/new_string over unified diffs)
- [ ] ADR-0014 (Read-before-Edit mandatory; compaction wipes tracking — re-read)

## Steps (P4.x)

4.1 Write `src/tools/types.ts` (Tool, ToolResult, ToolInput, ToolSchema, ToolTokenUsage)
4.2 Write `src/tools/schema-validator.ts` (Ajv wrapper, returns structured errors)
4.3 Write `src/tools/truncation.ts` (MAX_TOOL_RESULT_TOKENS=4000, oldest-first, hint)
4.4 Write `src/tools/core/read-file.ts` (params: file_path, offset?, limit?)
4.5 Write `src/tools/core/write-file.ts` (params: file_path, content; atomic temp + rename)
4.6 Write `src/tools/core/edit-file.ts` (params: file_path, old_string, new_string, replace_all?)
4.7 Write `src/tools/core/list-directory.ts` (params: path; respects .gitignore)
4.8 Write `src/tools/core/grep.ts` (params: pattern, path?, glob?, type?; wraps ripgrep --json)
4.9 Write `src/tools/core/bash.ts` STUB (warns "sandbox not yet wired; Phase 5")
4.10 Write `src/tools/registry.ts` (dispatch pipeline: validate → execute → truncate → log)
4.11 Write `src/tools/index.ts` (exports)
4.12 Write unit tests for each tool
4.13 Write integration test: agent calls read_file → edit_file → grep end-to-end
4.14 Wire tool registry into `AgentLoop` (Phase 2)
4.15 ADR-0013, ADR-0014
4.16 Worklog entry for Phase 4

## Key Engineering Decisions

- **`old_string`/`new_string` over unified diffs.** Claude Code deliberately
  uses exact-match search-and-replace; models trained on it; uniqueness
  enforcement prevents ambiguous edits; diffs fail on whitespace mismatches.
- **Read-before-Edit mandatory.** Track read files in agent state; refuse
  edits to unread files. Caveat: compaction wipes this tracking — re-read
  after compaction.
- **Truncate oldest first, not newest.** Truncating newest causes re-calls
  (wasted tokens) or wrong decisions on incomplete data.
- **Namespacing mandatory** for MCP tools (Phase 6): prefix with server name
  (`github_create_issue`) to avoid collisions across 30+ tools.
- **Prompt-engineer tool descriptions.** They are prompts the model uses to
  select tools.
- **Per-tool token accounting** from day one — extends Module 1's accounting.
