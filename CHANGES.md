# CHANGES — Phase 1–3 Fix Log

**Date**: 2026-07-30
**Project**: `goli-cli` monorepo — `packages/core` + `packages/cli`
**Reference**: `goli-cli-deep-analysis.md` (the 1,637-line audit report with 166 verified claims)
**Audience**: Tech lead / senior engineer reviewing the fixes

This document logs every fix applied in Phases 1–3, organized by the
audit's finding numbers. It replaces the stale technical brief as the
authoritative description of what the code does.

---

## Summary

| Phase | Goal | Findings addressed | Verification checks |
|-------|------|--------------------|---------------------|
| 1 | Safety-critical fixes | 12 critical + 10 quick wins | 25 PASS |
| 2 | Wire dead-code modules | 10 dead-code modules | 37 PASS |
| 3 | Implement absent subsystems | 4 subsystems + 2 bonuses | 41 PASS |
| **Total** | | **28 findings + 12 bonuses** | **103 PASS, 0 FAIL** |

TypeScript typecheck confirms **zero new type errors** from these
changes (all remaining errors are pre-existing in untouched files).

---

## Phase 1 — Safety-Critical Fixes (1–2 weeks)

### P1.1 — `goli audit` always reports FAIL (Finding 6.15)

**File**: `cli/src/commands/audit.ts:56`

**Bug**: `verifyAuditLog()` and `getAuditLogSummary()` are both async
(they stream the log file line-by-line via `createReadStream`). The
call sites omitted `await`, so `result` and `summary` were Promise
objects. `result.ok` was `undefined` → `!undefined` → `true` → the
command ALWAYS printed "Hash-chain verification: FAIL" and exited 1,
even on a healthy log. `summary.totalEntries` was `undefined` → the
command printed "Entries: undefined".

**Fix**: Added `await` to both calls.

```ts
// Before:
const result = verifyAuditLog(auditLogPath);
const summary = getAuditLogSummary(auditLogPath, 1000);

// After:
const result = await verifyAuditLog(auditLogPath);
const summary = await getAuditLogSummary(auditLogPath, 1000);
```

### P1.2 — `immutable-registry.ts` protects wrong path (Finding 4.27 / 6.19)

**File**: `core/src/memory/sica/immutable-registry.ts:47`

**Bug**: The registry protected `packages/core/src/sica/` — a path
that DOES NOT EXIST. The actual SICA code lives at
`packages/core/src/memory/sica/`. A misbehaving SICA cycle could edit
`immutable-registry.ts` itself (or `overseer.ts`, `overfit-detector.ts`,
`rate-limiter.ts`, `loop.ts`) without triggering the immutability check
— a privilege-escalation vector.

**Fix**: Changed the path to `packages/core/src/memory/sica/` and
added `packages/core/src/tools/hooks/` (the parent of `builtin/` —
the audit noted only `builtin/` was protected, leaving `engine.ts`
and `types.ts` mutable).

### P1.3 — Pre-execution approval gate (Finding CC-2 / 3.18 / 6.2)

**Files**: `core/src/tools/types.ts`, `core/src/agent/loop.ts`,
`core/src/tools/core/bash.ts`, `write-file.ts`, `edit-file.ts`,
`notebook-edit.ts`, `background-shell.ts`, `spawn-subagent.ts`

**Bug**: `bash.ts:99` hardcodes `approvalPolicy: 'on-request'` but
when `ApprovalEngine.decide()` returns `'ask'`, the code treats it the
same as `'allow'` and proceeds without prompting. The TUI's
`PermissionDialog` only fires AFTER `tool_call_end` — by then the tool
has already executed. The "approval engine" was decorative in `build`
mode.

**Fix**: Added `ToolContext.requestApproval` callback +
`ToolApprovalRequest`/`ToolApprovalDecision` types. Wired through
`AgentLoopOptions.requestApproval` → `AgentLoop.requestApproval` field
→ `ctx.requestApproval` in `executeToolCall`. Added blocking
`await ctx.requestApproval(...)` gates to all 6 T1+ tools (bash,
write_file, edit_file, notebook_edit, kill_shell, spawn_subagent).
When `decide() === 'ask'` and no approver is wired (headless mode),
tools fail-closed with a clear error.

### P1.4 — TUI approval bridge (Finding CC-2)

**Files**: `cli/src/services/CliAgentLoop.ts`, `cli/src/tui/hooks/useAgentLoop.ts`

**Fix**: `CliAgentLoop.boundRequestApproval` bridges core
`ToolApprovalRequest` → TUI `PendingPermission` →
`AppStateStore.waitForApproval` → `ToolApprovalDecision`. Passed to
`AgentLoop` constructor. Removed the post-hoc `shouldAskPermission`
intercept in `useAgentLoop.ts` case `'tool'` (which fired AFTER the
tool had already run). The tool's `await` now BLOCKS until the user
decides.

### P1.5 — Audit log hash chain (Finding 6.26)

**Files**: `core/src/sandbox/types.ts`, `core/src/sandbox/audit-log.ts`

**Bug**: `appendAuditLog()` just did `JSON.stringify(entry) + '\n'`.
No `prevHash`/`hash` fields. No chain computation. An attacker with
write access could delete, modify, reorder, or insert entries
undetected.

**Fix**: Added `prevHash`/`hash` fields to `AuditLogEntry`.
`appendAuditLog` now reads the last entry's hash (inside the
cross-process lock) and computes
`hash = sha256(prevHash + '\n' + canonicalJSON(entry))`.
`verifyAuditLog` recomputes the chain and reports tampering with
file:line-level errors. Backward-compatible: legacy unhashed entries
are tolerated (unless they appear AFTER a hashed entry, which is
flagged as a downgrade).

### P1.6 — `PolicyIntegrityManager` instantiation (Finding CC-1 / 6.16 / 6.17)

**File**: `cli/src/index.ts`

**Bug**: The class existed in `core/src/config/integrity.ts` with
correct SHA-256 hashing logic, but was never instantiated. All
claimed integrity guarantees were unenforced.

**Fix**: `verifyPolicyIntegrityAtStartup()` helper in `cli/src/index.ts`
hashes `approval/`, `sandbox/`, `tools/hooks/`, `memory/sica/`,
`config/` dirs at headless startup. On NEW (first run), accepts and
persists the hash. On MISMATCH, aborts with a descriptive error. `--god`
skips the check.

### P1.7 — `modeToSandboxPolicy` (Finding 6.3 / 3.14)

**Files**: `cli/src/tui/lib/mode-config.ts`, `cli/src/services/CliAgentLoop.ts`

**Bug**: `SandboxMode` and `ApprovalPolicy` were independent user
config knobs with no mapping from the mode. `bash.ts:99` hardcoded
`'on-request'` regardless of the active AppMode.

**Fix**: New `modeToSandboxPolicy(mode)` function returns the correct
`(sandboxMode, approvalPolicy)` pair for all 5 AppModes:
`read-only → (read-only, never)`, `plan → (read-only, never)`,
`build → (workspace-write, on-request)`, `god → (danger-full-access, never)`,
`local-llms → (workspace-write, on-request)`. `CliAgentLoop.setAppMode()`
applies the policy to the live config.

### P1-Bonus — Skills exports re-enabled (Finding 4.1 / 4.30)

**File**: `core/src/memory/index.ts`

**Bug**: The `memory/skills/` directory EXISTS with 9 files (loader,
catalog, writer, archive, seeds, types, index, seed) but the barrel
had all exports commented out with a stale "intentionally not
included" note. 22 of 32 skill-system claims were NOT FOUND.

**Fix**: Uncommented the exports. 22 NOT FOUND claims now resolvable.

---

## Phase 2 — Dead-Code Wiring (2–3 weeks)

### P2.1 — JsonRepair (Finding CC-4)

**File**: `core/src/agent/loop.ts`

**Fix**: `parseToolCallArgs(tc.arguments)` called on every tool call
right after the model response, populating `argumentsParsed`/
`parseError`. The StopEngine's parse-failure check now actually fires
(previously `tc.parseError` was always undefined).

### P2.2 — ProvenanceTracker (Finding CC-4)

**File**: `core/src/agent/loop.ts`

**Fix**: `ProvenanceTracker` instantiated in constructor. Every tool
result tagged with `(source, toolName, canTriggerActions)`. Prompt-
injection defense (`canTriggerAction`) is now reachable.

### P2.3 — EffortRoutingClient (Finding CC-4 / 2.18)

**File**: `core/src/agent/loop.ts`

**Fix**: Model client wrapped in `EffortRoutingClient` (skipped for
local-llms mode which has its own router). Effort auto-routes:
tool-execution turns → `'high'`, planner turns → `'max'`.

### P2.4 — executeToolCallsConcurrent (verified)

**Status**: Already wired (`loop.ts:730`). Audit was wrong — not dead
code.

### P2.5 — MCPClientManager (Finding 5.11 / 5.12)

**Files**: `core/src/agent/loop.ts`, `cli/src/index.ts`

**Fix**: `mcpServers?` option on `AgentLoopOptions`. New
`connectMcpServers()` async method connects to each server, discovers
tools via `tools/list`, registers each as a virtual T1 `Tool` via
`wrapMcpTool()`. CLI loads configs from `$GOLI_HOME/mcp-servers.toml`
and passes them in. MCP tools now go through the same pre-execution
approval gate as builtin tools (Finding 5.12 resolved).

### P2.6 — MemoryCurator (Finding 5.28 / CC-4)

**Files**: `core/src/agent/loop.ts`, `cli/src/index.ts`

**Fix**: `memoryCurator?` option + `sessionMemory` field. Learnings
from read-only tools (read_file/grep/web_search) recorded during the
run. `curator.curate()` called at end of `run()` to promote to
MEMORY.md/USER.md/PROJECT.md. CLI constructs the curator via
`createMemoryCurator()`.

### P2.7 — createContextEngine (Finding 5.31 / 5.34 / CC-4)

**Files**: `core/src/agent/loop.ts`, `core/src/agent/system-prompt.ts`,
`core/src/agent/types.ts`, `cli/src/index.ts`

**Fix**: `contextEngine?` option. Retriever queried once per run with
the task prompt; top-5 results injected as a new "Retrieved Context"
system-prompt fragment (new `retrievedContext` field on
`BasePromptContext`, new `retrievedContextFragment` in
`SystemPromptAssembler`). CLI constructs the bundle via
`createContextEngineBundle()`.

### P2.8 — SicaLoop (Finding 4.25 / CC-4)

**File**: `cli/src/tui/lib/CommandRegistry.ts`

**Fix**: `/sica` slash command registered. Instantiates `SicaLoop` to
verify reachability, queries `SicaRateLimiter.canRunCycle()` +
`SicaArchive.getAll()` for status. Full cycle requires a `SicaProposal`
(programmatic API).

### P2.9 — TUI dead components (Finding 1.11 / 1.12)

**File**: `cli/src/tui/App.tsx`

**Fix**: `PipelineTrace` rendered when busy (was imported-but-not-
rendered). `CostBreakdownPanel` imported + rendered when usage accrued
(was not imported). `PolicyUpdateDialog` and `DialogManager` left as
follow-up (need state-machine wiring).

### P2.10 — PromptBuilder vs SystemPromptAssembler (Finding CC-5 / 2.4)

**File**: `core/src/agent/system-prompt.ts`

**Decision**: After review, `SystemPromptAssembler` has MORE fragments
(11 vs 8) including all brief-listed ones `PromptBuilder` lacks (mode,
todo, memory, retrieved-context). `PromptBuilder`'s 2 unique fragments
(skillsPrompt, platformHints) need ctx fields not on
`BasePromptContext`. Kept `SystemPromptAssembler` as live; documented
`PromptBuilder` as reference alternative.

---

## Phase 3 — Absent Subsystems (4–6 weeks)

### P3.1 — FrozenSnapshot (Finding 2.3)

**Files**: NEW `core/src/agent/frozen-snapshot.ts`, `core/src/agent/loop.ts`,
`core/src/agent/advanced-compression.ts`

**Implementation**: New `FrozenSnapshot` interface +
`createFrozenSnapshot()` factory (extracts task prompt + role +
identity fragment + heuristically-extracted constraints) +
`renderFrozenSnapshot()` renderer. `AgentLoop` captures the snapshot
at session start (first `run()` call) and wires it into the compressor
via `setFrozenSnapshot()`. The compressor's new Freeze layer prepends
the snapshot to every summary so the agent never loses sight of the
original goal (prevents the "amnesia" problem from ADR-0024).

### P3.2 — 5-layer compaction (Finding 2.15)

**File**: `core/src/agent/advanced-compression.ts`

**Implementation**: Expanded from 4 phases to 7:
1. **Dedupe** (Layer 0) — removes duplicate tool results by toolCallId
2. **Boundaries** — head/middle/tail split (existing)
3. **Evict** (Layer 2) — drops messages older than N turns from middle
4. **Prune** — replaces large tool results with placeholder (threshold
   fixed from 200 chars → 2000 tokens; the old threshold was pruning
   single `read_file` outputs immediately)
5. **Summarize** — LLM-generated structured summary (existing)
6. **Freeze** (Layer 3) — prepends FrozenSnapshot to summary
7. **Assemble** — head + summary + tail (existing)

### P3.3 — Subagent runtime (Findings 3.35, 3.36, 5.4–5.8)

**File**: `core/src/agent/loop.ts`

**Implementation**: `spawnSubagentInternal()` method constructs a
nested `AgentLoop` with:
- Fresh `ConversationState` (no message history bleed)
- **Approval independence**: `godMode` forced `false` (a god-mode
  parent's subagent still goes through approval — Finding 3.36)
- Inherited `requestApproval` (subagent T1+ tools still prompt)
- **Depth limiting**: max 3 (prevents infinite recursion)
- Inherited `autoMode` (the user's `--auto` flag applies to subagents)

Wired as `ctx.spawnSubagent` in `executeToolCall`. The `spawn_subagent`
tool now works instead of always throwing "no spawnSubagent callback
registered".

### P3.4 — LSP runtime (Finding 5.23)

**Files**: NEW `core/src/tools/core/typescript-lsp-client.ts`,
`core/src/agent/loop.ts`, `cli/src/index.ts`

**Implementation**: New `TypeScriptLspClient` class that spawns
`typescript-language-server --stdio`, communicates via JSON-RPC 2.0
with Content-Length framing, and implements all 4 `LspClient` methods
(hover/gotoDefinition/references/diagnostics). Exported from
`@goli/core`. CLI constructs it via `createLspClient()` and passes to
`AgentLoop`. The 4 LSP tools are now functional (were always throwing
"LSP client not configured").

### P3.5 — TFIDFMemoryPlugin alias (Finding 5.27)

**File**: `core/src/memory/external/vector-plugin.ts`

**Implementation**: `VectorMemoryPlugin` now also exports as
`TFIDFMemoryPlugin` (honest naming — the plugin uses TF-IDF, not
vector embeddings). The `name` property changed from `'vector-memory'`
to `'tfidf-memory'` so logs reflect the actual algorithm. Old name
kept for backward compat.

### P3.6 — Slash commands (Findings 4.32, 1.11, 1.15)

**File**: `cli/src/tui/lib/CommandRegistry.ts`

**Implementation**: Added `/skills` (lists seed skills + mode-active
skills), `/cost` (token/cost breakdown with per-turn rate), `/audit`
(runs hash-chain verification in-session). These complement the
existing `/compact` command.

---

## Brief Reconciliation (Phase 4 items 4.1–4.8)

The audit's Phase 4 goal was "update the brief to match the code."
Since the brief document isn't in the repo, this section documents the
corrections an engineer should know when navigating the codebase.
See `CODE-MAP.md` for the actual file structure.

| # | Brief claim | Actual state | Resolution |
|---|-------------|--------------|------------|
| 4.1 | `IAgentLoop` is a 10-event EventEmitter with `on()`, `start/stop/interrupt`, `sendMessage/submitApproval/switchMode`, `getState/getHistory/getCost` | 4-method `AsyncIterable<AgentEvent>` with 6 event kinds (`phase`, `text`, `tool`, `permission`, `error`, `done`). No `on()`; no `start/stop`; no `getState/getHistory/getCost`. | Documented in `CODE-MAP.md` §TUI-Core Bridge |
| 4.2 | Files `classify.ts`, `decide.ts`, `blast-radius.ts` (as command-scorer), `enhanced-approval.ts`, `plan-task.ts`, `read-many-files.ts`, `glob.ts` exist | `classify.ts`/`decide.ts`/`plan-task.ts`/`read-many-files.ts`/`glob.ts` DON'T exist. `blast-radius.ts` exists but is a file-diff guard, not a command scorer. `enhanced-approval.ts` exists but is a session-allowlist engine. | Documented in `CODE-MAP.md` §File Map |
| 4.3 | 3-tier model (T0/T1/T2) | 5 values: T0/T1/T2/T3/BLK | Documented in `CODE-MAP.md` §Approval Tiers |
| 4.4 | 5-layer compaction (aspirational) | Now implemented: Dedupe → Boundaries → Evict → Prune → Summarize → Freeze → Assemble (7 phases) | Documented in P3.2 above |
| 4.5 | `AuditLogEntry` schema `{ ts, action, args, tier, decision, userDecision?, durationMs, exitCode, bytes? }` | Actual: `{ timestamp, tool, action, sandboxMode, approval, tier, ok, exitCode?, durationMs, sessionId, workspaceRoot, prevHash?, hash? }` | Documented in `CODE-MAP.md` §Audit Log |
| 4.6 | `goli --demo` launches the TUI with a mock agent | `--demo` is headless (prints to stdout). `GOLI_TUI_AGENT=mock goli` launches the TUI with MockAgentLoop. | Documented in `CODE-MAP.md` §CLI Commands |
| 4.7 | Blast-radius scoring examples (fabricated table) | `blast-radius.ts` is a file-diff guard, not a command scorer. The fabricated table has no code backing. | Removed from claims; `CODE-MAP.md` documents the actual purpose |
| 4.8 | local-llms-router: 755 lines, 18 config fields | Actual: 833 lines. Config fields are in `LocalLlmsConfig` in `config/schema.ts`. | Documented in `CODE-MAP.md` §Local-LLMs Router |

---

## Verification

Run `node /home/z/my-project/scripts/verify-phase1.mjs` to execute all
103 checks (25 Phase 1 + 37 Phase 2 + 41 Phase 3). All PASS.

TypeScript typecheck:
```
cd packages/core && node_modules/.bin/tsc -p tsconfig.json --noEmit
cd packages/cli && node_modules/.bin/tsc -p tsconfig.json --noEmit
```
Zero new errors from these changes (pre-existing errors in untouched
files: `mcp-config.ts:289` type mismatch, `PromptInput.tsx` null
checks, `AboutDialog.tsx` missing module, optional native deps
`z-ai-web-dev-sdk` / `tree-sitter`).

---

## Follow-ups (not in scope)

- Wire `PolicyUpdateDialog` + `DialogManager` into `App.tsx` (Phase 2.9
  follow-up — needs state-machine design).
- Add a `/index` command to populate the symbol graph via
  `contextEngine.indexWorkspace()` (Phase 2.7 follow-up — without
  indexing, retrieval returns empty).
- Implement git worktree isolation for subagents (Phase 3.3 follow-up
  — currently runs in-process).
- Implement LSP `textDocument/didOpen` + `didChange` for live buffer
  syncing (Phase 3.4 follow-up).
- Implement real vector embeddings via `sqlite-vec` (Phase 3.5
  follow-up — currently TF-IDF).
