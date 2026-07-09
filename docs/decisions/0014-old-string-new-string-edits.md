# ADR-0014: old_string/new_string Over Unified Diffs for edit_file

**Status:** Accepted
**Phase:** P4
**Date:** 2026-07-03

## Context

The `edit_file` tool needs to let the agent make targeted changes to
existing files. There are two common approaches:

1. **Unified diffs** — the model emits a diff (`--- / +++ / @@`) and
   the tool applies it via `patch` or a diff library.
2. **Exact-match search-and-replace** — the model emits `old_string`
   (the exact text to find) and `new_string` (the replacement), and
   the tool does a string replacement.

Claude Code deliberately uses the second approach. The upstream Module 3
spec mandates it.

## Decision

Use **`old_string` / `new_string` exact-match search-and-replace** for
the `edit_file` tool.

Rationale:
1. **Models are trained on it.** Claude Code uses this pattern
   extensively; models (including GLM-5.2) are fine-tuned to emit
   `old_string`/`new_string` reliably. Diffs require a different output
   format that models produce less reliably.
2. **Uniqueness enforcement prevents ambiguous edits.** If `old_string`
   appears multiple times in the file, the tool refuses (unless
   `replace_all: true`). This prevents the model from accidentally
   editing the wrong location.
3. **Diffs fail on whitespace mismatches.** A single trailing-space
   difference between the diff and the file causes the patch to fail.
   Exact-match is more forgiving — the model just needs to copy the
   text it saw when it read the file.
4. **Simpler implementation.** No diff parser needed; just
   `String.prototype.indexOf` + `slice`.

## Consequences

**Positive:**
- Reliable: models produce `old_string`/`new_string` reliably.
- Safe: uniqueness enforcement prevents ambiguous edits.
- Simple: no diff library dependency.
- Forgiving: exact-match doesn't break on whitespace.

**Negative:**
- The `old_string` must be unique (or `replace_all` must be set). If
  the model provides a non-unique string, the tool returns an error.
  Mitigation: the error message tells the model how many occurrences
  were found and suggests using `replace_all` or providing more context.
- Large edits (rewriting most of a file) are awkward with
  search-and-replace. Mitigation: use `write_file` for full rewrites;
  use `edit_file` only for targeted changes.

## Read-before-Edit Enforcement

The `edit_file` tool enforces **Read-before-Edit**: the agent must call
`read_file` on a file before it can edit that file. This prevents blind
edits to files the agent hasn't seen.

The `ToolContext.readFiles` set tracks which files have been read. The
`edit_file` handler checks this set and refuses edits to unread files.

**Caveat**: compaction (Phase 7) wipes this tracking — the agent must
re-read files after compaction. The system prompt will include a note
about this once compaction is implemented.

## Implementation

- `packages/core/src/tools/core/edit-file.ts` — `EDIT_FILE_TOOL` with
  `old_string`, `new_string`, `replace_all` parameters
- Uniqueness check: `countOccurrences()` → refuse if > 1 and
  `replace_all` is false
- Atomic write: temp file + `renameSync` to prevent partial writes
- Read-before-Edit: check `ctx.readFiles.has(resolvedPath)`

## References

- Upstream `module-3-tool-layer-mcp.md` — edit_file section
- Claude Code's edit_file implementation (same pattern)
