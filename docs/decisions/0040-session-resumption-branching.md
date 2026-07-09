# ADR-0040: Session Resumption & Branching (H16)

**Date:** 2026-07-05
**Status:** Accepted
**Hermes Item:** H16 — Session Resumption & Branching

## Context

GOLI-CLI previously had no persistent session store. The only
persistence was a crash snapshot (`~/.goli-cli/crash.json`) with just
enough metadata to identify the session — not a full transcript. This
meant:

- Closing the terminal mid-task lost the conversation.
- Users could not `--resume <id>` to continue a previous session.
- Users could not `--branch <id>` to explore an alternative approach
  from a specific point in a previous session.

Claude Code supports both via JSONL session files. This ADR adopts
the same pattern.

## Decision

Add a **JSONL-backed session store** with resume and branching:

### Storage layout

```
~/.goli-cli/sessions/
  <session-id>.meta.json   — metadata (id, createdAt, parentId, prompt, ...)
  <session-id>.jsonl       — full message transcript (one Message per line)
```

The `GOLI_HOME` env var overrides the default `~/.goli-cli/` base.

### API

- `createSession({ prompt, role, workspaceRoot, branch?, parentId?, tags? })`
  — creates a new session, writes empty metadata + JSONL.
- `appendMessage(sessionId, message)` — appends one message to the
  JSONL (O(1) append, no read+rewrite).
- `updateMetadata(sessionId, updates)` — merges partial metadata
  (e.g., after each iteration to track tokens).
- `resume(sessionId)` — loads metadata + messages. Returns `null`
  if not found.
- `branch(sessionId, branchPoint?)` — creates a new session with
  `parentId` set to the original. The transcript is copied,
  optionally truncated to `branchPoint` (0-based message index).
- `listSessions()` — returns all sessions sorted by `updatedAt`
  descending (most recent first). Skips corrupted metadata files.
- `deleteSession(sessionId)` — removes both files.

### Why JSONL (not a single JSON blob)?

- **Append-only writes are O(1)** — no read+rewrite on every message.
- **Crash safety** — a corrupted line affects only that message, not
  the whole session. The reader skips corrupted lines.
- **Debuggability** — `tail -f` / `grep` work on the raw file.
- **Truncation for branching** — `slice(0, branchPoint)` is trivial.

### Resume vs branch

- **Resume**: load a session, restore its messages into a new
  `ConversationState`, continue. The session ID stays the same; new
  messages append to the same JSONL.
- **Branch**: load a session, copy its messages into a NEW session
  (new ID, `parentId` set), optionally truncated. The original
  session is untouched. New messages append to the child's JSONL.

Branching is useful for exploring alternative approaches: "what if
I had asked the agent to use a different library?" — branch at the
message before the choice, re-prompt, compare outcomes.

## Consequences

**Positive:**

- Sessions persist across terminal closes, reboots, and SSH disconnects.
- `--resume <id>` and `--branch <id>` CLI flags can now be wired up
  (follow-up).
- Branching enables experimentation without losing the original
  conversation.
- JSONL is human-readable and debuggable.
- Crash-safe: corrupted lines are skipped, not fatal.

**Negative:**

- Disk usage grows with session count. Mitigation: `deleteSession`
  + a future `pruneOldSessions(days)` cleanup.
- No compression (JSONL is verbose). Mitigation: a future
  `compressSession(id)` could gzip the JSONL.
- No encryption (sessions are plaintext). Mitigation: a future
  `encryptSession(id, key)` for sensitive transcripts.
- The store is per-machine (no sync). Mitigation: a future
  `syncSessions(remoteUrl)` for multi-machine workflows.

## Alternatives Considered

### A. SQLite (single DB file for all sessions)

Rejected: SQLite is already used for the symbol graph. Adding
sessions to it would couple memory to context-engine concerns. JSONL
keeps sessions independent and human-readable.

### B. Single JSON blob per session

Rejected: appending a message requires read+rewrite of the whole
file — O(n) per append, not O(1). Also, a single corruption loses
the whole session.

### C. In-memory only (current behavior)

Rejected: loses the conversation on every terminal close. Users
expect to be able to resume.

## Implementation

- `packages/core/src/memory/session/jsonl-store.ts` — `JsonlSessionStore`,
  `SessionMetadata`, `LoadedSession`, `JsonlSessionStoreOptions`
- `packages/core/src/memory/index.ts` — exports
- `tests/unit/session-jsonl-store.test.ts` — 12 unit tests covering
  create, append, resume, branch, list, delete, updateMetadata,
  corrupted-line skipping

## Follow-up

- Wire `--resume <id>` and `--branch <id>` CLI flags in
  `packages/cli/src/index.ts`.
- Extend `AgentLoopInput` with `resumedMessages?: Message[]` so the
  loop can rehydrate state.
- Hook `appendMessage` into `AgentLoop.run()` so every message is
  persisted as it's emitted.
- Add `/sessions` and `/branch` slash commands in the TUI.
- Add `pruneOldSessions(days)` cleanup.
- Add session search (full-text over prompts).
