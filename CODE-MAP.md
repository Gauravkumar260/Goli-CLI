# CODE-MAP — Goli-CLI Actual File Structure

<!-- LAST_VERIFIED: 2026-08-01 against v0.3.0-phase2-studio -->
<!-- VERIFICATION_REPORT: goli-cli-verification-report.md -->

**Date**: 2026-08-01 (P2 documentation reconciliation pass)
**Purpose**: Accurate navigation map for engineers. Replaces the stale
technical brief. Every file path listed here EXISTS and does what this
document says it does.

This document is the **canonical source of truth** for the
`@goli/core` <-> `@goli/cli` contract. If any other doc disagrees with
this file, this file wins (and the other doc should be fixed).

This document is organized by subsystem, matching the audit's 6-section
structure so cross-referencing is easy.

---

## Monorepo Layout

```
goli-cli/
├── packages/
│   ├── core/          ← @goli/core: the "Brain" (agent loop, tools, safety, context)
│   ├── cli/           ← @goli/cli: the TUI (Ink/React) + CLI binary
│   ├── evals/         ← Evaluation harnesses (SWE-bench, redteam, regression)
│   ├── studio/        ← Web studio (Next.js + Prisma)
│   └── vscode-ext/    ← VS Code extension
├── CHANGES.md         ← Phase 1–3 fix log (this fix set)
├── CODE-MAP.md        ← This file
└── tsconfig.json      ← Root tsconfig (extended by packages)
```

---

## §1 TUI ↔ Core Bridge

### The `IAgentLoop` interface (4 methods, NOT a 10-event EventEmitter)

**File**: `cli/src/services/IAgentLoop.ts:70-77`

```ts
export interface IAgentLoop {
  run(input: AgentRunInput): AsyncIterable<AgentEvent>;
  abort(): void;
  approve(permissionId: string, always: boolean): void;
  deny(permissionId: string): void;
  getLastResult?(): { inputTokens: number; outputTokens: number; costUsd: number } | null;
}
```

**Event union** (6 kinds, NOT 10):

```ts
export type AgentEvent =
  | { kind: 'phase'; phase: AgentPhase }
  | { kind: 'text'; text: string }
  | { kind: 'tool'; tool: ToolCallEvent }
  | { kind: 'permission'; request: PermissionRequest }
  | { kind: 'error'; error: string }
  | { kind: 'done' };
```

**Missing from the brief**: no `on(event, cb)` subscription method;
no `start/stop/interrupt/isRunning`; no `sendMessage/submitApproval/
switchMode`; no `getState/getHistory/getCost`. The TUI re-implements
accumulation on top of the event stream via `useAgentLoop`.

### Implementations

| File | Class | Purpose |
|------|-------|---------|
| `cli/src/services/CliAgentLoop.ts` | `CliAgentLoop` | Production adapter wrapping `@goli/core`'s `AgentLoop`. Bridges `ToolApprovalRequest` → `AppStateStore.waitForApproval`. |
| `cli/src/services/MockAgentLoop.ts` | `MockAgentLoop` | Canned responses for UI testing. Activate via `GOLI_TUI_AGENT=mock goli`. |
| `cli/src/tui/hooks/useAgentLoop.ts` | `useAgentLoop` hook | React hook that consumes `loop.run()`'s `AsyncIterable`, batches text tokens, and renders tool events. |

### TUI State

| File | Purpose |
|------|---------|
| `cli/src/tui/state/AppStateStore.ts` | Singleton store (outside React). `waitForApproval()` is the blocking approval gate. Session allowlist for "[a]lways approve". |
| `cli/src/tui/state/types.ts` | `PendingPermission`, `ToolCall`, `Message`, `AppStateSnapshot` types. |

### TUI Components (rendered in `App.tsx`)

| File | Component | Status |
|------|-----------|--------|
| `cli/src/tui/components/PermissionDialog.tsx` | `[y/a/n/v/e]` approval dialog | Wired (Phase 1.4). `[e]` edit calls `$EDITOR` (TODO). |
| `cli/src/tui/components/DiffReviewDialog.tsx` | `[a/r/A/R/Esc]` diff review | Wired. |
| `cli/src/tui/components/AgentStateBar.tsx` | Shows thinking/idle | Rendered. |
| `cli/src/tui/components/TokenBar.tsx` | Aggregate token count | Rendered. |
| `cli/src/tui/components/CostBreakdownPanel.tsx` | Per-model cost | **Rendered** (Phase 2.9 — was dead code). |
| `cli/src/tui/components/PipelineTrace.tsx` | 3-step thinking trace | **Rendered** (Phase 2.9 — was imported-but-not-rendered). |
| `cli/src/tui/components/PolicyUpdateDialog.tsx` | Integrity-mismatch dialog | **Not rendered** (follow-up — needs state-machine). |
| `cli/src/tui/components/DialogManager.tsx` | Dialog orchestration | **Not rendered** (follow-up). |
| `cli/src/tui/components/HistoryScroll.tsx` | Transcript | Rendered. |
| `cli/src/tui/components/ContextSummaryDisplay.tsx` | Skill/MCP/AGENTS.md counts | Rendered. |
| `cli/src/tui/components/CommandPalette.tsx` | Ctrl+P command palette | Rendered. |

---

## §2 Agent Loop Core

### The `AgentLoop` class

**File**: `core/src/agent/loop.ts`

The single-threaded ReAct master loop. Each iteration:
1. Pre-check + compaction (7-phase, P3.2)
2. Assemble system prompt (13 fragments, P2.7)
3. Call model (with retry, effort routing P2.3)
4. Parse response (JsonRepair P2.1)
5. Check stop conditions
6. Execute tool calls (parallel T0, serialized T1+, pre-execution approval P1.3)
7. Append results + provenance tags (P2.2)
8. Update budget + stall/loop detectors
9. Memory curation at turn end (P2.6)

### Key options on `AgentLoopOptions`

| Option | Type | Phase | Purpose |
|--------|------|-------|---------|
| `requestApproval` | `(req) => Promise<decision>` | P1.3 | Pre-execution approval callback |
| `mcpServers` | `MCPServerConfig[]` | P2.5 | MCP servers to connect |
| `memoryCurator` | `MemoryCurator` | P2.6 | Promotes learnings to L2 files |
| `contextEngine` | `createContextEngine()` return | P2.7 | Symbol graph + hybrid retriever |
| `lspClient` | `LspClient` | P3.4 | LSP client for the 4 LSP tools |

### Agent files

| File | Purpose |
|------|---------|
| `core/src/agent/loop.ts` | The `AgentLoop` class + `spawnSubagentInternal` (P3.3) |
| `core/src/agent/frozen-snapshot.ts` | **NEW (P3.1)**: `FrozenSnapshot` type + `createFrozenSnapshot` |
| `core/src/agent/advanced-compression.ts` | 7-phase compressor (P3.2: +Dedupe +Evict +Freeze) |
| `core/src/agent/system-prompt.ts` | 13-fragment system prompt assembler (+retrievedContext P2.7) |
| `core/src/agent/budget.ts` | 4-dimension budget tracker |
| `core/src/agent/stall-detector.ts` | N=3 identical-repeat detector |
| `core/src/agent/loop-detector.ts` | Cross-iteration loop detector (threshold 5/10) |
| `core/src/agent/stop-engine.ts` | 4-condition stop engine |
| `core/src/agent/retry.ts` | `callWithRetry` with jittered backoff |
| `core/src/agent/planner.ts` | TODO engine + `PLAN_TASK_TOOL` (inline in loop, no separate file) |
| `core/src/agent/provenance.ts` | `ProvenanceTracker` (P2.2 — now wired) |
| `core/src/agent/effort-router.ts` | `EffortRoutingClient` wrapper (P2.3 — now wired) |
| `core/src/agent/json-repair.ts` | `parseToolCallArgs` / `repairJson` (P2.1 — now wired) |
| `core/src/agent/provider-adapter.ts` | `ProviderBackedModelClient` |
| `core/src/agent/local-llms-router.ts` | Three-axis router (833 lines) |
| `core/src/agent/credential-pool.ts` | Multi-key failover |
| `core/src/agent/error-classifier.ts` | 21 error categories |
| `core/src/agent/tool-guardrails.ts` | Third loop-detection layer (exact_failure, same_tool_failure, no_progress). Path validation lives in `tools/core/path-safety.ts` and `sandbox/path-validation.ts`. The denylist (`rm -rf /`, `mkfs`, `dd`, fork bombs) lives in `approval/enhanced-approval.ts` as `alwaysDeny` patterns. |
| `core/src/agent/toolset-snapshot.ts` | Frozen per-iteration tool list |
| ~~`core/src/agent/prompt-builder.ts`~~ | **DELETED (P2-18)** — dead code, 485 lines, never instantiated. Live assembler is `system-prompt.ts`. |
| `core/src/agent/prompt-caching.ts` | Prompt caching utilities (NOT wired) |
| `core/src/agent/reflexion.ts` | Reflexion engine — **WIRED (P2-18)** into `loop.ts` executeToolCall failure path. `ReflexionEngine.reflect()` runs after a tool fails; the resulting `Reflection.strategy` is injected into the next system prompt via `formatForPrompt()`. |
| ~~`core/src/agent/callback-streaming.ts`~~ | **DELETED (P2-18)** — dead code, 428 lines, never wired into `AgentLoop`. The model client's native async iterator is used directly. |

### AgentRole enum (11 values, NOT 8)

**File**: `core/src/agent/types.ts`

```ts
export type AgentRole =
  | 'orchestrator' | 'scout' | 'researcher' | 'architect' | 'planner'
  | 'implementer' | 'debugger' | 'qa-tester' | 'security-auditor'
  | 'reviewer' | 'documenter';
```

The TUI's `theme/agents.ts:AGENTS` array has only 8 entries with
divergent names (`coder` ≠ `implementer`, `searcher` ≠ `researcher`).
This is a known mismatch (Finding CC-6).

---

## §3 Tool Pipeline

### Approval tiers (5 values, NOT 3)

**File**: `core/src/sandbox/types.ts`

```ts
export type PermissionTier = 'T0' | 'T1' | 'T2' | 'T3' | 'BLK';
```

- **T0** (Safe): read-only (read_file, grep, list_directory)
- **T1** (Risky): file writes (write_file, edit_file, notebook_edit, kill_shell)
- **T2** (Risky): state-modifying shell commands (bash, spawn_subagent)
- **T3** (Destructive): network access (curl, wget, npm publish, git push)
- **BLK**: always-blocked (rm -rf /, mkfs, dd, fork bomb, etc.)

### Approval engine

**File**: `core/src/approval/engine.ts` (NOT `classify.ts` + `decide.ts` — those don't exist)

The `ApprovalEngine` class has `classifyCommand()` and `decide()` as
methods on the same class. `decide()` returns `'allow' | 'deny' | 'ask'`.

**Pre-execution gate** (P1.3): all T1+ tools now call
`ctx.requestApproval()` when `decide() === 'ask'`. The gate is
BLOCKING — the tool's `await` doesn't resolve until the user decides.

### Tool files

| File | Tool | Tier | Notes |
|------|------|------|-------|
| `tool-system/src/core/bash.ts` | `bash` | T2 | Pre-exec approval gate (P1.3) |
| `tool-system/src/core/write-file.ts` | `write_file` | T1 | Pre-exec approval + diff-review (P1.3) |
| `tool-system/src/core/edit-file.ts` | `edit_file` | T1 | Read-before-Edit enforced; pre-exec approval (P1.3) |
| `tool-system/src/core/notebook-edit.ts` | `notebook_edit` | T1 | Pre-exec approval (P1.3) |
| `tool-system/src/core/background-shell.ts` | `bash_output` / `kill_shell` | T0 / T1 | `kill_shell` has pre-exec approval (P1.3) |
| `tool-system/src/core/spawn-subagent.ts` | `spawn_subagent` | T2 | Delegates to `ctx.spawnSubagent` (P3.3 — now wired) |
| `tool-system/src/core/read-file.ts` | `read_file` | T0 | — |
| `tool-system/src/core/grep.ts` | `grep` | T0 | — |
| `tool-system/src/core/list-directory.ts` | `list_directory` | T0 | — |
| `tool-system/src/core/web-search.ts` | `web_search` | T0 | — |
| `tool-system/src/core/web-fetch.ts` | `web_fetch` | T0 | — |
| `tool-system/src/core/lsp-tools.ts` | `lsp_hover` / `lsp_goto_definition` / `lsp_references` / `lsp_diagnostics` | T0 | Delegates to `ctx.lspClient` (P3.4 — now wired) |
| `tool-system/src/core/typescript-lsp-client.ts` | — | — | **NEW (P3.4)**: `TypeScriptLspClient` impl |
| `tool-system/src/core/path-safety.ts` | — | — | `resolveUserPath`, `checkPathInWorkspace` |
| `tool-system/src/core/diff-utils.ts` | — | — | `buildDiffEntry`, `formatDiffAsString` |
| `tool-system/src/core/diff-approval.ts` | — | — | `checkSingleEntryDiffApproval` |
| `tool-system/src/core/tool-streaming.ts` | — | — | Chunk emitter (NOT wired — dead code) |

**Files that DON'T exist** (brief fabricated them):
- `classify.ts`, `decide.ts` — logic is in `engine.ts`
- `plan-task.ts` — `plan_task` is inline in `loop.ts` via `Planner`
- `read-many-files.ts`, `glob.ts` — never implemented

### `blast-radius.ts` — file-diff guard, NOT command scorer

**File**: `core/src/approval/blast-radius.ts`

The brief claimed this file scores shell commands by blast radius
(fabricated examples). It actually guards against large file diffs —
a completely different purpose. The brief's scoring table is
fictional.

### `enhanced-approval.ts` — session-allowlist engine

**File**: `core/src/approval/enhanced-approval.ts`

The brief claimed this is a separate "enhanced" approval engine. It's
actually a session-allowlist engine (`EnhancedApprovalEngine` class)
that remembers "always approve" decisions. It's wired into
`ApprovalEngine.decide()` but the wiring is incomplete (Finding 3.20).

### Sandbox

| File | Purpose |
|------|---------|
| `core/src/sandbox/executor.ts` | `SandboxedExecutor` — spawns via bwrap/seatbelt |
| `core/src/sandbox/seatbelt.ts` | macOS Seatbelt profile generation |
| `core/src/sandbox/landlock.ts` | Linux bubblewrap (MISNAMED — not native Landlock) |
| `core/src/sandbox/cgroups.ts` | cgroups v2 (memory/CPU/PID; IO decorative) |
| `core/src/sandbox/network.ts` | Network policy (allowlist decorative on Linux) |
| `core/src/sandbox/path-validation.ts` | `O_NOFOLLOW`, `realpath()`, null-byte check |
| `core/src/sandbox/audit-log.ts` | Append-only JSONL with hash chain (P1.5) |
| `core/src/sandbox/types.ts` | `AuditLogEntry` (with `prevHash`/`hash`), `PermissionTier`, `SandboxMode` |

### Audit log schema (actual)

```ts
interface AuditLogEntry {
  timestamp: string;
  tool: string;
  action: string;
  sandboxMode: SandboxMode;
  approval: ApprovalDecision;
  tier: PermissionTier;
  ok: boolean;
  exitCode?: number;
  durationMs: number;
  sessionId: string;
  workspaceRoot: string;
  prevHash?: string;  // P1.5 — SHA-256 chain
  hash?: string;      // P1.5 — this entry's hash
}
```

---

## §4 Skill System (L1/L2/L3 + SICA)

### Skills directory (EXISTS, was commented out — P1-bonus re-enabled)

**File**: `core/src/memory/skills/`

| File | Purpose |
|------|---------|
| `loader.ts` | `SkillLoader` — L1/L2 progressive disclosure |
| `catalog.ts` | `SkillCatalog` — list/findByTriggers |
| `writer.ts` | `SkillWriter` — extract skills from trajectories |
| `archive.ts` | `SkillArchiver` — L3 archival after 90 days |
| `seeds.ts` | `SEED_SKILLS` — 5 seed skills |
| `types.ts` | `SkillMetadata`, `SkillCategory`, `DisclosureLevel` |
| `index.ts` | Barrel |

All exported from `core/src/memory/index.ts` (P1-bonus).

### SICA (recursive self-improvement)

**File**: `core/src/memory/sica/`

| File | Purpose |
|------|---------|
| `loop.ts` | `SicaLoop` — 6-phase cycle (Evaluate → Archive → Self-Edit → Guard → Re-evaluate → Adopt/Revert) |
| `overseer.ts` | `SafetyOverseer` — LLM-based with pattern fallback |
| `immutable-registry.ts` | `ImmutableSafetyRegistry` — protects `src/memory/sica/` (P1.2 — was wrong path) |
| `overfit-detector.ts` | `OverfitDetector` — rejects on holdout degradation |
| `rate-limiter.ts` | `SicaRateLimiter` — 10 cycles/day, 50 LOC human review |
| `archive.ts` | `SicaArchive` — cycle history |
| `types.ts` | `SicaTarget`, `SicaProposal`, etc. |

`SicaLoop` is reachable via the `/sica` slash command (P2.8). Full
cycles require a programmatic `SicaProposal`.

---

## §5 Adjacent Systems

### Subagents (P3.3 — now wired)

`ctx.spawnSubagent` is set in `executeToolCall` (P3.3). The
`spawnSubagentInternal()` method constructs a nested `AgentLoop` with:
- Approval independence (`godMode` forced false)
- Depth limiting (max 3)
- Inherited `requestApproval` (subagent T1+ tools still prompt)

Git worktree isolation is NOT implemented (follow-up).

### MCP (P2.5 — now wired)

| File | Purpose |
|------|---------|
| `tool-system/src/mcp/client.ts` | `MCPClientManager` — stdio + http transports |
| `tool-system/src/mcp/types.ts` | `MCPServerConfig`, `MCPTool`, `MCPSession` |
| `tool-system/src/mcp/index.ts` | Barrel + `REFERENCE_MCP_SERVERS` |
| `cli/src/commands/mcp.ts` | `goli mcp add/remove/list/test/enable/disable` |
| `cli/src/commands/mcp-config.ts` | `loadMcpServers` from `$GOLI_HOME/mcp-servers.toml` |

`AgentLoop.connectMcpServers()` connects to each configured server and
registers tools as virtual T1 `Tool`s via `wrapMcpTool()`.

### Hooks (fully working)

**File**: `tool-system/src/hooks/`

6 builtin hooks (all functional):
- `git-checkpoint.ts` — auto-commits before edits
- `block-secrets.ts` — redacts API keys/tokens
- `audit-log.ts` — writes audit entry (with hash chain P1.5)
- `block-writes-outside-workspace.ts` — blocks path traversal
- `block-destructive.ts` — blocks `rm -rf /` etc.
- `auto-format.ts` — runs prettier/black on edited files

### LSP (P3.4 — now functional)

| File | Purpose |
|------|---------|
| `tool-system/src/core/lsp-types.ts` | `LspClient` interface (4 methods) |
| `tool-system/src/core/lsp-tools.ts` | The 4 LSP tools (T0) |
| `tool-system/src/core/typescript-lsp-client.ts` | **NEW (P3.4)**: `TypeScriptLspClient` — spawns `typescript-language-server --stdio` |

Install: `npm install -g typescript-language-server typescript`

### Memory (3-tier)

| File | Tier | Purpose |
|------|------|---------|
| `core/src/memory/session/ephemeral.ts` | L1 | `SessionMemory` — in-memory, cleared per session |
| `core/src/memory/persistent/files.ts` | L2 | `PersistentMemory` — MEMORY.md / USER.md / PROJECT.md |
| `core/src/memory/external/vector-plugin.ts` | L3 | `VectorMemoryPlugin` / `TFIDFMemoryPlugin` (P3.5 — honest name). TF-IDF, NOT vector embeddings. |
| `core/src/memory/curator/agent.ts` | — | `MemoryCurator` — promotes L1 → L2 (P2.6 — now wired) |

### Code intelligence (P2.7 — now wired)

| File | Purpose |
|------|---------|
| `core/src/context/indexer/tree-sitter.ts` | `TreeSitterIndexer` — regex fallback |
| `core/src/context/indexer/real-tree-sitter.ts` | Native tree-sitter adapter (optional dep) |
| `core/src/context/symbol-graph/sqlite.ts` | `SymbolGraph` — better-sqlite3 (NOT sqlite-vec) |
| `core/src/context/retriever/hybrid.ts` | `HybridRetriever` — RRF k=60, ripgrep + keyword (NOT FTS5 + sqlite-vec) |
| `core/src/context/project-map.ts` | `ProjectMapGenerator` — Aider-style ranking (NOT instantiated — follow-up) |
| `core/src/context/compaction/engine.ts` | `CompactionEngine` — separate from `AdvancedCompressor` |
| `core/src/context/subagent/isolation.ts` | `SubagentIsolator` |
| `core/src/context/index.ts` | `createContextEngine()` factory (P2.7 — now wired) |

**Note**: The symbol graph starts empty. Call
`contextEngine.indexWorkspace(filePaths)` to populate it (follow-up:
add a `/index` command).

---

## §6 Safety & Integrity

### Pre-execution approval (P1.3 — now preventive, not post-hoc)

All T1+ tools call `ctx.requestApproval()` BEFORE executing when
`ApprovalEngine.decide() === 'ask'`. The gate is BLOCKING. In
headless mode (no approver wired), tools fail-closed.

### Audit log hash chain (P1.5)

Each entry's `hash = sha256(prevHash + canonicalJSON(entry))`. First
entry's `prevHash = "GENESIS"`. `verifyAuditLog()` recomputes the
chain. `goli audit` now works (P1.1 — was always FAIL due to missing
`await`).

### `PolicyIntegrityManager` (P1.6 — now instantiated)

`verifyPolicyIntegrityAtStartup()` in `cli/src/index.ts` hashes
`approval/`, `sandbox/`, `tools/hooks/`, `memory/sica/`, `config/`
dirs at headless startup. On MISMATCH, aborts. `--god` skips.

### `ImmutableSafetyRegistry` (P1.2 — path fixed)

Protects `packages/core/src/memory/sica/` (was `src/sica/` — wrong).
Also protects `packages/tool-system/src/hooks/` (parent of `builtin/`).

### Mode → sandbox mapping (P1.7 — now implemented)

`modeToSandboxPolicy(mode)` in `cli/src/tui/lib/mode-config.ts`:
- `read-only` → `(read-only, never)`
- `plan` → `(read-only, never)`
- `build` → `(workspace-write, on-request)`
- `god` → `(danger-full-access, never)`
- `local-llms` → `(workspace-write, on-request)`

---

## §7 CLI Commands

### `goli` (top-level flags)

| Flag | Purpose |
|------|---------|
| `-p, --print <prompt>` | Headless mode (CI/CD) |
| `--demo` | Headless mock smoke test (NOT TUI — use `GOLI_TUI_AGENT=mock goli` for TUI) |
| `--god` | Bypass all safety gates |
| `--auto` | Auto-approve T1/T2 |
| `--sandbox <mode>` | Override sandbox mode |
| `--effort <level>` | Override reasoning effort |
| `--spec-mode` | Spec-driven mode (edit_file requires approved spec) |
| `--diff-review` | Diff-first review in headless mode |
| `--local-llms` | Three-axis local-LLM router |

### Subcommands

| Command | Purpose |
|---------|---------|
| `goli audit` | Verify audit log integrity (P1.1 — now works) |
| `goli mcp add/remove/list/test/enable/disable` | MCP server config |
| `goli doctor` | System health check |
| `goli status` | Health dashboard |
| `goli usage` | Model usage stats |
| `goli commit` | Apply pending changes |
| `goli init` | Initialize GOLI.md |
| `goli cron` | Scheduled agent tasks |
| `goli wakeup [prompt]` | Wake up the 8-agent swarm |

### Slash commands (in TUI)

| Command | Purpose |
|---------|---------|
| `/help` | Show help |
| `/mode` | Switch mode |
| `/compact` | Reset token counter |
| `/skills` | **P3.6** — list seed skills + mode-active skills |
| `/cost` | **P3.6** — token/cost breakdown |
| `/audit` | **P3.6** — hash-chain verification in-session |
| `/sica` | **P2.8** — SICA status + enable |
| `/stats` | Session statistics |
| `/theme` | List/switch themes |
| `/vim` | Toggle vim mode |
| `/quit` | Exit |

---

## Local-LLMs Router (actual stats)

**File**: `core/src/agent/local-llms-router.ts` — **833 lines** (brief claimed 755)

Config type: `LocalLlmsConfig` in `core/src/config/schema.ts`. Fields
include `orchestratorModel`, `coderModel`, `generalModel`, `fastModel`,
`cloudModel`, `piiGatingMode`, plus circuit-breaker and fallback
settings.

The router routes each model call across 5 OllamaProvider instances
based on three axes: sensitivity (PII → local-only), complexity
(simple → fast, complex → coder/cloud), availability (circuit
breakers cascade on failure).

---

## Cross-reference: Audit Findings → Fixes

| Audit Finding | Phase | File | Status |
|---------------|-------|------|--------|
| CC-2 (approval post-hoc) | P1.3 | bash.ts + 5 other tools | FIXED |
| 6.15 (goli audit broken) | P1.1 | audit.ts | FIXED |
| 6.26 (no hash chain) | P1.5 | audit-log.ts | FIXED |
| CC-1 (PolicyIntegrityManager) | P1.6 | cli/index.ts | FIXED |
| 4.27 (immutable-registry path) | P1.2 | immutable-registry.ts | FIXED |
| 4.1 (skills dir missing) | P1-bonus | memory/index.ts | FIXED (was commented out) |
| CC-4 (10 dead-code modules) | P2.1–P2.10 | loop.ts + others | FIXED |
| 2.3 (FrozenSnapshot) | P3.1 | frozen-snapshot.ts | IMPLEMENTED |
| 2.15 (5-layer compaction, aspirational) | P3.2 | advanced-compression.ts | IMPLEMENTED as 7-phase |
| 3.35 (subagent unwired) | P3.3 | loop.ts | IMPLEMENTED |
| 5.23 (LSP interface-only) | P3.4 | typescript-lsp-client.ts | IMPLEMENTED |
| 5.27 (VectorMemoryPlugin misnamed) | P3.5 | vector-plugin.ts | FIXED (alias) |
| 4.32 / 1.11 / 1.15 (slash commands) | P3.6 | CommandRegistry.ts | IMPLEMENTED |
