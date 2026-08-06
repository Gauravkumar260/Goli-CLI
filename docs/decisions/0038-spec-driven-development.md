# ADR-0038: Spec-Driven Development (H13)

**Date:** 2026-07-05
**Status:** Accepted
**Hermes Item:** H13 — Spec-Driven Development

## Context

Claude Code's killer feature is **plan-mode + spec-mode**: the user
describes intent, the agent writes a formal specification document,
the user reviews the spec, and only then does the agent implement
against it. GOLI-CLI had `plan_task` (a flat TODO list) but no spec
contract — every task was ad-hoc, with no acceptance criteria, no
traceable implementation, and no verification against intent.

The TODO list is a planning tool (what the agent will do); a spec is
a _contract_ (what the implementation must satisfy). They are
complementary, not alternatives.

## Decision

Adopt **spec-driven development** via three new tools and a CLI flag:

### Tools

1. **`spec_write`** — writes a formal spec as markdown to disk and
   registers it in an in-memory `SpecRegistry` with `draft` status.
   The spec includes:
   - Requirements (functional)
   - Acceptance Criteria (verifiable)
   - Test Plan (how to verify)
   - Implementation Notes (free-form)

2. **`spec_review`** — the user (or the agent on the user's behalf)
   approves, rejects, or requests changes. Approval transitions the
   spec to `approved` status; rejection to `rejected`; `request_changes`
   sends it back to `draft` with feedback.

3. **`spec_update`** — updates an existing spec's content or status.
   Used after `request_changes` (to revise) or after implementation
   (to mark as `implemented`).

### CLI flag

`--spec-mode` — when active, `edit_file`/`write_file` refuse to write
unless at least one spec is in `approved` or `implemented` status.
This is enforced by a check in both tool handlers that queries
`specRegistry.hasApprovedSpec()`.

### Gating semantics

The gating is intentionally simple: spec-mode requires _at least one_
approved spec to exist. It does NOT attempt to map specs to specific
files (e.g., "this spec governs `src/auth/*`"). Rationale:

- Mapping specs to file globs adds complexity for marginal value.
- The user is responsible for using spec-mode meaningfully — if they
  approve a spec for feature X and then ask the agent to fix a bug in
  feature Y, the spec gate passes (because a spec exists), and the
  agent proceeds. This is acceptable.
- A future iteration could add `Spec.affectedFiles: string[]` (globs)
  and have the gate check that the file being edited matches at least
  one approved spec's globs. Deferred.

`godMode` bypasses the spec gate (consistent with how it bypasses
all other safety checks).

## Consequences

**Positive:**

- Forces upfront design for complex tasks — the agent can't just
  start editing without first writing down what it's going to do and
  why.
- Acceptance criteria are now a first-class artifact. A future
  iteration can generate tests from them.
- Spec markdown files live in the repo (typically `.goli/specs/`),
  providing a design history.
- Composes with diff-first editing (H14): in spec-mode, the agent
  writes a spec, the user approves, the agent edits with diff review.

**Negative:**

- Adds friction for simple tasks. Mitigation: `--spec-mode` is opt-in
  (default off). The agent only uses `spec_write` when the task is
  complex enough to warrant it (the system prompt guides this).
- The `SpecRegistry` is per-process; specs do not persist across
  sessions. This is intentional — the user must explicitly re-approve
  specs in each new session, preventing stale approvals from gating
  writes silently. The markdown files persist, but the in-memory
  status resets.
- The tool count grows (13 → 16). Accepted.

## Alternatives Considered

### A. Extend `plan_task` to support acceptance criteria

Rejected: `plan_task` is a TODO list (transient, status: pending/
in_progress/completed). A spec is a contract (persistent, status:
draft/approved/rejected/implemented). Conflating them confuses the
model.

### B. Use markdown files only (no in-memory registry)

Rejected: parsing markdown to check `status: approved` on every
`edit_file` call is slow and fragile (whitespace, comments, etc.).
The registry is the source of truth at runtime; the markdown is for
humans.

### C. Gate by file glob (spec governs specific files)

Deferred — see "Gating semantics" above. The simple version ships
first; the glob-matching version can layer on later without breaking
the API.

## Implementation

- `packages/tool-system/src/core/spec-registry.ts` — `SpecRegistry`,
  `Spec`, `SpecStatus`, `specRegistry` singleton, `deriveTitle`,
  `renderSpecMarkdown`
- `packages/tool-system/src/core/spec-write.ts` — `SPEC_WRITE_TOOL`
- `packages/tool-system/src/core/spec-review.ts` — `SPEC_REVIEW_TOOL`
- `packages/tool-system/src/core/spec-update.ts` — `SPEC_UPDATE_TOOL`
- `packages/tool-system/src/types.ts` — `ToolContext.specMode`
- `packages/tool-system/src/core/edit-file.ts` — spec-mode gating check
- `packages/tool-system/src/core/write-file.ts` — spec-mode gating check
- `packages/tool-system/src/index.ts` — register 3 new tools
- `tests/unit/spec-driven-development.test.ts` — 16 unit tests
- `tests/unit/tool-registry.test.ts` — updated count 13 → 16

## Follow-up

- Wire `--spec-mode` CLI flag in `packages/cli/src/index.ts` and
  thread it through to `ToolContext.specMode` in `AgentLoop.executeToolCall()`.
- Add `/spec` slash command in the TUI to toggle spec-mode.
- Generate tests from acceptance criteria (future).
- Map specs to file globs (future).
