# ADR-0037: Diff-First Editing (H14)

**Date:** 2026-07-05
**Status:** Accepted
**Hermes Item:** H14 — Diff-First Editing
**Supersedes:** None (extends ADR-0014)

## Context

GOLI-CLI's `edit_file` and `write_file` tools historically applied changes
immediately (atomic temp-file + rename) and offered `DiffReviewDialog`
_after_ the fact, with rollback via the `git_checkpoint` hook. This is the
**inverse** of industry best practice:

- **Claude Code** shows a per-hunk diff _before_ the file is written; the
  user accepts/rejects each change with vim-style keybindings (`a`/`r`/`A`/`R`).
- **Cursor** Composer mode shows a multi-file diff before applying.
- **Aider** shows the diff and asks for confirmation before each edit.
- **Gemini CLI** shows the proposed change before confirming mutators.

The post-hoc approach has three problems:

1. **Unwanted edits touch the working tree.** Even though `git_checkpoint`
   can roll back, the file is briefly in the modified state — which races
   with file watchers, linters, and IDE indexes.
2. **No per-hunk granularity.** The user can only accept or reject the
   entire edit. If 9 of 10 hunks are good, the user has to accept all,
   then manually fix the 10th.
3. **Auditing is harder.** The diff is the artifact of intent. Storing it
   in the audit log _before_ the write is more useful than storing it
   after.

## Decision

Adopt **diff-first editing** for `edit_file` and `write_file`:

1. Compute the proposed new content in memory (without writing).
2. If a `requestDiffApproval` callback is registered on `ToolContext`,
   build a `DiffEntry` (with `computeDiff(oldContent, newContent)`) and
   call the callback.
3. The callback resolves with `{accepted: number[], rejected: number[]}`
   indicating per-entry decisions.
4. If any entry is rejected, the tool returns `{ok: false, error:
'User rejected the proposed edit'}` and does NOT write.
5. If all entries are accepted, the atomic write proceeds as before.
6. If no callback is registered (headless mode without `--diff-review`,
   or `autoMode`), the tool writes directly — preserving the original
   behavior for scripts and CI.

The callback is injected via `ToolContext` rather than via the `HookEngine`
because the approval flow needs to round-trip through the TUI (Ink/React),
which the core `ToolRegistry` cannot depend on. The TUI provides the
callback via `AppStateStore.waitForDiffReview`; headless mode provides an
auto-accepter when `--diff-review` is passed (otherwise the callback is
undefined and tools write directly).

## Consequences

**Positive:**

- Matches the UX of Claude Code, Cursor, and Aider.
- Unwanted edits no longer touch the working tree.
- Per-hunk accept/reject is now possible (the `DiffEntry[]` array
  supports multiple entries for a future `edit_batch` tool).
- Diff is auditable _before_ the write.
- Backward-compatible: scripts and CI see no behavior change when the
  callback is not set.

**Negative:**

- The callback adds one async round-trip per mutating tool call when
  diff review is enabled. For long sessions with many edits, this is
  noticeable. Mitigation: `acceptAll` (user presses `A`) and
  `diffReviewDisabled` (set when the user presses `R`) let the user
  short-circuit the flow.
- The `ToolContext` interface grows. We accept this — the alternative
  (a separate `DiffReviewContext`) would require threading a second
  object through every dispatch call.
- The TUI's `DiffReviewDialog` is still not wired into `App.tsx` (it
  was dead code before this ADR). Wiring it is a follow-up task; the
  core plumbing is in place.

## Alternatives Considered

### A. PreToolUse hook with `'ask'` decision

The `HookEngine` already supports `'ask'` decisions, but the registry
currently turns them into error strings rather than interactive prompts.
Extending the registry to await an interactive approval would require
either (a) making the registry async-aware of the TUI (circular
dependency) or (b) injecting a callback — which is what we did.

### B. Separate `edit_file_review` tool

A second tool that returns a diff for review, then a third tool that
applies the accepted diff. Rejected because it doubles the model's tool
calls and pushes approval logic into the model's prompt.

### C. Always diff-first (no backward-compat path)

Forces every caller (including CI scripts) to provide an approval
callback. Rejected because it breaks automation.

## Implementation

- `packages/tool-system/src/core/diff-utils.ts` — `computeDiff`,
  `buildDiffEntry`, `formatDiffAsString`, `DiffEntry`, `DiffApprovalResult`
- `packages/tool-system/src/types.ts` — `ToolContext.requestDiffApproval`
  and `ToolContext.diffReviewDisabled`
- `packages/tool-system/src/core/edit-file.ts` — refactored to call
  `requestDiffApproval` before writing
- `packages/tool-system/src/core/write-file.ts` — same refactor
- `tests/unit/diff-first-editing.test.ts` — 16 unit tests covering
  computeDiff, buildDiffEntry, formatDiffAsString, and the edit_file /
  write_file diff-first flows

## Follow-up

- Wire `DiffReviewDialog` into `App.tsx` (currently dead code).
- Add `AppStateStore.waitForDiffReview` mirroring `waitForApproval`.
- Add `--diff-review` CLI flag for headless mode (auto-accepter).
- Add `edit_batch` tool that sends multiple `DiffEntry`s in one approval
  round-trip (Cursor Composer-style multi-file edits).
