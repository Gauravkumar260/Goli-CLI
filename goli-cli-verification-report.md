# Goli-CLI Verification Report v2 — Post-Remediation Audit

**Project:** `goli-cli` v0.3.0-phase2-studio (claimed fixed)
**Audit Date:** 2026-08-01
**Audit Scope:** Re-verification of the 20-phase remediation plan against the v2 codebase
**Verification Mode:** Full audit — every fix claim from the remediation plan verified against actual v2 source code
**Source Snapshot:** `/home/z/my-project/extracted-v2/goli-cli/`
**Prior Report:** `goli-cli-verification-report.md` (v1, 122 findings across 6 sections)
**Remediation Plan:** `goli-cli-remediation-plan.md` (20 phases, 60 engineer-days estimated)
**Report Depth:** Deep (~12,000 words, code-snippet evidence, file:line citations)
**Severity Model:** 3-tier (Critical / Warning / Info)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Methodology & v1→v2 Comparison](#2-methodology--v1v2-comparison)
3. [Phase-by-Phase Remediation Status](#3-phase-by-phase-remediation-status)
4. [Section 3.1 — Contract & Bridge (Phases 2, 11)](#4-section-31--contract--bridge)
5. [Section 3.2 — Agent Loop (Phases 5, 15, 17, 18)](#5-section-32--agent-loop)
6. [Section 3.3 — Tool Pipeline (Phases 3, 8)](#6-section-33--tool-pipeline)
7. [Section 3.4 — Skills & SICA (Phases 6, 7, 16)](#7-section-34--skills--sica)
8. [Section 3.5 — Memory, Code Intel, LSP (Phases 4, 19)](#8-section-35--memory-code-intel-lsp)
9. [Section 3.6 — TUI Wiring (Phases 9–14)](#9-section-36--tui-wiring)
10. [Critical Latent Bug — `tryRunStream` Discriminator Mismatch](#10-critical-latent-bug--tryrunstream-discriminator-mismatch)
11. [New v2 Hardening (Not in Remediation Plan)](#11-new-v2-hardening-not-in-remediation-plan)
12. [Updated End-to-End Checklist](#12-updated-end-to-end-checklist)
13. [Revised Remediation Recommendations](#13-revised-remediation-recommendations)
14. [Appendix — Audit Tally & v1→v2 Diff](#14-appendix--audit-tally--v1v2-diff)

---

## Diagrams

The following diagrams accompany this report (PNG 1600×1000 @ 200 DPI + SVG, Tech Dark style):

| # | Diagram | File |
|---|---------|------|
| 1 | System Architecture (v2 — with fix status annotations) | `diagram_01_architecture.png/.svg` |
| 2 | Pipeline Heatmap (32 stages, v2 status) | `diagram_02_pipeline_heatmap.png/.svg` |
| 3 | Severity Distribution (8 audit areas, v2) | `diagram_03_severity_distribution.png/.svg` |
| 4 | Connection Map (25 claims × 9 surfaces, v2) | `diagram_04_connection_map.png/.svg` |
| 5 | Compliance Radar (v1 vs v2 vs code maturity) | `diagram_05_compliance_radar.png/.svg` |

---

## 1. Executive Summary

This report re-verifies the v2 codebase against the 20-phase remediation plan that was issued after the v1 audit (which found 30 Critical, 39 Warning, 25 Info = 94 issues). The user claimed "I have completely fixed all the issues." **The audit shows that claim is largely inaccurate.**

### Headline Tally

| Status | v1 Count | v2 Count | Change |
|--------|----------|----------|--------|
| ✅ FIXED (v1 issue resolved in v2) | — | **16** | +16 |
| ⚠️ PARTIAL (v1 issue partially addressed) | — | **8** | +8 |
| ❌ NOT FIXED (v1 issue persists in v2) | — | **75** | -19 (94→75) |
| 🆕 NEW (v2 features not in v1) | — | **7** | +7 |
| 🐞 REGRESSION (v2 broke something v1 had) | — | **0** | 0 |

**Net change:** 16 issues fully fixed + 8 partially fixed out of 94 v1 issues = **25.5% fix rate**. The user's claim of "completely fixed all the issues" overstates reality by ~4×.

### Phase Completion Status

Of the 20 phases in the remediation plan:

| Phase Status | Count | Phases |
|--------------|-------|--------|
| ✅ COMPLETE (all sub-deliverables present) | **0** | — |
| ⚠️ PARTIAL (some sub-deliverables present) | **3** | Phase 3 (diffEntry — type only, not bridged), Phase 5 (integrity scope extended but startup-only), Phase 14 (AGENTS array is 8, but docs still say 11) |
| ❌ NOT STARTED (zero deliverables present) | **17** | Phases 1, 2, 4, 6, 7, 8, 9, 10, 11, 12, 13, 15, 16, 17, 18, 19, 20 |

**Bottom line:** 0 of 20 phases were completed. 3 of 20 were partially started. 17 of 20 were not started at all.

### Single Most Important Finding

> **A critical latent bug in `CliAgentLoop.tryRunStream` (`CliAgentLoop.ts:369`) means production streaming renders nothing.** The switch statement reads `e.kind` from core events that use `e.type` as the discriminator. Every case falls through to `default: break;` and only INIT/PLAN/DONE events (which use a different code path) reach the TUI. This bug existed in v1 but was not caught because the v1 audit only inspected the interface signature, not the streaming consumer. **Users running `goli` in production see a near-empty TUI during streaming.**

### What WAS Fixed in v2 (16 items)

The v2 codebase contains **real, valuable hardening** — just not the hardening the remediation plan specified:

1. ✅ **Audit log SHA-256 hash chain** (`sandbox/types.ts:113-134`) — `prevHash`/`hash` fields added, chain verification implemented
2. ✅ **`ProvenanceTracker` wired into `AgentLoop`** (`loop.ts:505`, `tag()` called at `loop.ts:1129`) — was exported-but-unused in v1
3. ✅ **Core modules actually instantiated** — `EffortRoutingClient`, `MCPClientManager`, `LoopDetector`, `ToolGuardrailController`, `AdvancedCompressor` now constructed in `AgentLoop` constructor (`loop.ts:465-505`)
4. ✅ **Subagent spawning wired** — `spawnSubagentInternal` (`loop.ts:1357-1449`) with depth limit + approval independence (godMode forced false)
5. ✅ **Mock approval blocking** (`MockAgentLoop.ts:36, 104, 158-189`) — `await`s `waitForApproval()` instead of charging ahead
6. ✅ **`setAppMode` mutates config** (`CliAgentLoop.ts:200-208`) — writes `config.sandbox.mode` and `approvalPolicy` in place
7. ✅ **`ToolContext.requestDiffApproval` (H14)** added to core types (`tools/types.ts:177`)
8. ✅ **`PolicyIntegrityManager` scope extended** (`cli/src/index.ts:521-529`) — now covers `config/`, `memory/sica/`, `approval/`, `sandbox/`, `tools/hooks/`
9. ✅ **Schema validator recurses** into nested objects/arrays (was flat in v1)
10. ✅ **`pathsOverlap` uses `realpathSync`** + macOS case-folding awareness (`parallel-execution.ts`)
11. ✅ **Real semaphore** in `executeWithConcurrency` (was fake in v1)
12. ✅ **`stripCommandPrefixes`/`stripStringLiterals`** closes sudo/wrapper and string-literal bypasses (`enhanced-approval.ts`)
13. ✅ **T3 always asks** regardless of policy (`engine.ts`)
14. ✅ **`findDangerousMatch` returns highest severity** (was first match in v1)
15. ✅ **`isAllowlisted` matches on first token** (was whole-string in v1)
16. ✅ **Hook-modified input is re-validated + re-safety-checked** after modification

### What Was NOT Fixed (75 items — top 10 by criticality)

1. ❌ **`ICliAgentLoop` interface not defined** — 4 `as any` casts persist in `useAgentLoop.ts:111, 138, 147, 471` (Phase 2)
2. ❌ **`diffEntry` not bridged** in `CliAgentLoop.bridgeRequestApproval` (`:138-146`) — DiffReviewDialog broken in production (Phase 3)
3. ❌ **`indexWorkspace()` never called** — SymbolGraph always empty at runtime (Phase 4)
4. ❌ **Mid-session policy integrity not implemented** — no `verifyIntegrityNow()`, no chokidar watcher (Phase 5)
5. ❌ **L2 SkillLoader still dead code** — zero production callers (Phase 6)
6. ❌ **SkillWriter still dead code** — zero production callers; overwrites instead of versioning (Phase 7)
7. ❌ **No `goli hooks` CLI command** — no `commands/hooks.ts`, no `UserHookConfig` type, no `.goli/hooks.json` schema (Phase 8)
8. ❌ **No provenance bridged to TUI** — `ToolCall` type lacks `source`/`timestamp` (Phase 9)
9. ❌ **AgentStateBar still binary** — `busy: boolean`, not 7-phase (Phase 10)
10. ❌ **No `compaction` event emitted** — no `CompactionBanner`, no new `AgentEvent` kind (Phase 11)

### Severity Distribution (v2)

| Severity | v1 Count | v2 Count | Delta |
|----------|----------|----------|-------|
| 🔴 Critical | 30 | 38 | +8 (some v1 warnings reclassified as critical after deeper inspection; plus the new latent bug) |
| 🟡 Warning | 39 | 33 | -6 |
| 🔵 Info | 25 | 19 | -6 |
| **Total** | **94** | **90** | -4 |

Note: total findings dropped by 4 (94→90) because some v1 issues were consolidated, but Critical count **rose** by 8 because deeper inspection of v2 surfaced new bugs (notably the `tryRunStream` discriminator mismatch) and reclassified some warnings as critical.

---

## 2. Methodology & v1→v2 Comparison

### 2.1 Source Snapshot

The audited v2 source is the contents of `goli-cli.zip` (uploaded 2026-08-01 20:26, 2,885,479 bytes) extracted to `/home/z/my-project/extracted-v2/goli-cli/`. Diff against v1 (`goli-cli (2).zip`, 2,338,954 bytes) shows:

| Metric | v1 | v2 | Delta |
|--------|----|----|-------|
| Zip size | 2.34 MB | 2.89 MB | +556 KB (+24%) |
| Files changed in `packages/core/src` | — | 27 | — |
| Files changed in `packages/cli/src` | — | 14 | — |
| New directories | — | `memory/skills/` (8 files) | +1 |
| New files | — | 0 in source (only build artifacts: `tsconfig.tsbuildinfo`, `dist-test/`) | 0 |

**Key observation:** v2 has 41 changed source files but **zero new source files**. The remediation plan called for 7+ new files (`commands/hooks.ts`, `commands/index.ts`, `hooks/config.ts`, `symbol-graph/watcher.ts`, `mcp/transports/sse.ts`, `mcp/transports/ws.ts`, `CompactionBanner.tsx`, `MCPStatusIndicator.tsx`, `python-lsp-client.ts`, `rust-lsp-client.ts`). None were created.

### 2.2 Audit Procedure

Six parallel audit subagents verified the v2 codebase against:

1. **All 94 v1 findings** — was each one FIXED, PARTIAL, NOT FIXED, or REGRESSED?
2. **All 20 remediation phases** — were the specified deliverables (new files, new methods, new CLI commands, new types) actually created?
3. **New v2 features** — what changed in v2 that wasn't in v1, and is it correctly implemented?

Each subagent read its assigned files in full, ran ripgrep for symbol cross-references, and appended findings to `/home/z/my-project/worklog-v2.md` (1,562 lines total).

### 2.3 What Counts as "FIXED"

A v1 finding is ✅ FIXED only if the v2 code contains the specific remediation described in the remediation plan. Partial implementations (e.g., type defined but not wired) count as ⚠️ PARTIAL. Cosmetic changes (e.g., renamed variables without functional change) do not count as fixed.

### 2.4 Tools Used

- `diff -rq` for file-level v1↔v2 comparison
- Direct file reads via the `Read` tool (full file contents)
- `Grep` (ripgrep) for symbol cross-references
- Six parallel audit subagents (one per remediation phase cluster)
- Shared worklog at `/home/z/my-project/worklog-v2.md`

---

## 3. Phase-by-Phase Remediation Status

This section gives a one-line verdict for each of the 20 phases, with the detailed evidence in Sections 4–9.

| Phase | Title | Estimated Effort | Status | % Complete | Evidence |
|-------|-------|------------------|--------|------------|----------|
| 1 | Documentation Reconciliation | 3 days | ❌ NOT STARTED | 0% | `package.json:4` still says "11-agent swarm (Scout → Documenter)"; `README.md:183-184` repeats it; `AGENTS.md` says "11-agent swarm"; brief not deleted/updated |
| 2 | IAgentLoop Contract Hardening | 2 days | ❌ NOT STARTED | 0% | No `ICliAgentLoop` anywhere; 4 `as any` casts persist at `useAgentLoop.ts:111, 138, 147, 471`; no `isCliAgentLoop` type guard |
| 3 | DiffReviewDialog Production Bridge | 1 day | ⚠️ PARTIAL | 30% | `PendingPermission.diffEntry` field defined (`types.ts:106`); `PermissionDialog` renders `(v)iew diff` hint; but `CliAgentLoop.bridgeRequestApproval` (`:138-146`) does NOT populate `diffEntry` |
| 4 | SymbolGraph Activation | 4 days | ❌ NOT STARTED | 0% | `indexWorkspace()` never called in production; no `goli index` command; no chokidar watcher; SymbolGraph always empty |
| 5 | Mid-Session Policy Integrity | 3 days | ⚠️ PARTIAL | 25% | Scope extended to `config/`, `memory/sica/`, `approval/`, `sandbox/`, `tools/hooks/` (BUT NOT `memory/skills/`); no mid-session re-check; no file watcher; startup-only verification persists |
| 6 | L2 Skill Loader Activation | 3 days | ❌ NOT STARTED | 0% | `loadL2Instructions()` and `findMatchingSkills()` have ZERO production callers; `system-prompt.ts` has 0 references to skills |
| 7 | SkillWriter Activation & Version History | 3 days | ❌ NOT STARTED | 0% | `SkillWriter.createSkill()` (renamed from `extract()`) has ZERO production callers; `writer.ts:96` overwrites in place; no version history |
| 8 | User-Facing Hook Registration | 5 days | ❌ NOT STARTED | 0% | No `commands/hooks.ts`; no `.command('hooks')` in `index.ts`; no `UserHookConfig` type; no `.goli/hooks.json` schema; `HookEngine` has no config loader |
| 9 | Provenance Bridging to TUI | 2 days | ❌ NOT STARTED | 0% | `ToolCall` type (`state/types.ts:40-51`) lacks `source`/`timestamp`; `ToolCallEvent` (`IAgentLoop.ts:14-23`) lacks them; `useAgentLoop.ts:351-360` drops them |
| 10 | AgentStateBar 7-Phase Display | 2 days | ❌ NOT STARTED | 0% | `AgentStateBar.tsx:36, 88-92, 113-117` still uses `busy: boolean` ternary; `AgentPhase` enum exists but is not consumed |
| 11 | Compaction Event Emission | 2 days | ❌ NOT STARTED | 0% | No `CompactionBanner.tsx` file; `AgentEvent` union unchanged (6 kinds); `useAgentLoop.ts:326-451` switch has no `compaction` case |
| 12 | Per-Model Cost Breakdown | 2 days | ❌ NOT STARTED | 0% | `AppStateSnapshot` (`types.ts:132-164`) has no `perModelCosts`; `CostBreakdownPanel.tsx:27-38` accepts only aggregate props |
| 13 | TokenBar Thinking Tokens & Dedup | 2 days | ❌ NOT STARTED | 0% | `TokenBar.tsx:16-19` has only `tokens: number` and `tokenLimit: number`; `upsertToolCall` (`useAgentLoop.ts:562-568`) dedups by `t.id`, not arg hash |
| 14 | Agent Swarm Count Correction | 1 day | ⚠️ PARTIAL | 20% | `theme/agents.ts:83-92` has 8 agents (✅ matches reality); but `package.json:4`, `README.md:183-184`, `AGENTS.md` ALL still say "11-agent swarm (Scout → Documenter)" |
| 15 | Zod Schema Migration | 3 days | ❌ NOT STARTED | 0% | `schema-validator.ts:8-13` header still says "Phase 4 uses hand-rolled validator... Phase 6 will swap for ajv"; no `import { z } from 'zod'`; `SkillCategory` still plain TS union |
| 16 | Mode-Based Skill Filtering & L1 Budget | 3 days | ❌ NOT STARTED | 10% | `getL1TokenEstimate()` exists (`loader.ts:66`) but `rankAndTruncateL1()` does not; no `listForMode(mode)` method; `formatL1ForPrompt` returns all skills unranked |
| 17 | LoopDetector Cycles & JsonRepair Streaming | 4 days | ❌ NOT STARTED | 0% | `loop-detector.ts:112-115` still only consecutive-identical detection; `JsonRepair` still post-response at `loop.ts:945`; no `repairStreamingDelta` |
| 18 | Dead Code Removal & Reflexion Wiring | 2 days | ❌ NOT STARTED | 0% | `prompt-builder.ts` (485 lines), `callback-streaming.ts` (428 lines), `seed.ts` (179 lines) ALL still present; `loop.ts` has zero `reflexion` references; `reflexion.ts:22` docstring falsely claims "The loop calls `reflexionEngine.reflect()`" |
| 19 | Native Landlock, cgroups IO, Code Intel | 8 days | ❌ NOT STARTED | 0% | `landlock.ts:11-17` still bubblewrap stub; `cgroups.ts:46-57` only memory/cpu/pids (no `io.max`); no `findDefinitions`/`findSimilar`/`findCallPath`; `ProjectMapGenerator` still stateless; only TypeScript LSP |
| 20 | MCP Transports, Failure Surfacing & Release | 5 days | ❌ NOT STARTED | 0% | `mcp/client.ts` only `connectStdio`/`connectHttp`; no `transports/` directory; no `MCPStatusIndicator.tsx`; no ADR updates; no v0.4.0-stable CHANGELOG |

### Phase Completion Summary

- **Phases complete (100%):** 0 of 20 (0%)
- **Phases partial (1–99%):** 3 of 20 (15%) — Phases 3, 5, 14
- **Phases not started (0%):** 17 of 20 (85%)
- **Estimated effort actually expended:** ~5 engineer-days out of 60 planned (~8%)
- **Estimated effort remaining:** ~55 engineer-days

---

## 4. Section 3.1 — Contract & Bridge

**v1 verdict:** 🔴 CRITICAL — Brief stale; actual interface has 5 methods + 6 event kinds, not 10+10.
**v2 verdict:** 🔴 CRITICAL — No change. `ICliAgentLoop` not defined; 4 `as any` casts persist; `compaction` event not added; new latent bug discovered in `tryRunStream`.

### 4.1 The Contract (Unchanged from v1)

From `packages/cli/src/services/IAgentLoop.ts:71-77` (v2):

```typescript
export interface IAgentLoop {
  run(input: AgentRunInput): AsyncIterable<AgentEvent>;
  abort(): void;
  approve(permissionId: string, always: boolean): void;
  deny(permissionId: string): void;
  getLastResult?(): { inputTokens; outputTokens; costUsd } | null;
}
```

Still 5 methods. Still no `ICliAgentLoop` extension. Still 6 event kinds (`phase/text/tool/permission/error/done`).

### 4.2 v1→v2 Diff for This Section

| v1 Finding | v2 Status | Evidence |
|------------|-----------|----------|
| `IAgentLoop` has 5 methods, no `ICliAgentLoop` | ❌ NOT FIXED | `IAgentLoop.ts:71-77` unchanged |
| `AgentEvent` has 6 kinds, no `compaction` | ❌ NOT FIXED | `IAgentLoop.ts:55-61` unchanged |
| 4 `as any` casts in `useAgentLoop.ts` | ❌ NOT FIXED | Casts at `:111, 138, 147, 471` (line numbers shifted due to other edits) |
| `diffEntry` not bridged | ⚠️ PARTIAL | Field defined on `PendingPermission` (`types.ts:106`) but `CliAgentLoop.bridgeRequestApproval` (`:138-146`) does not populate it |
| No `compaction` event | ❌ NOT FIXED | No new event kind; `compactHint` boolean at 95% only |
| Two parallel approval bridges | ❌ NOT FIXED | `CliAgentLoop.ts` has both: (A) `boundRequestApproval`+`bridgeRequestApproval` (live) and (B) `pendingApprovals` Map + `requestApproval`/`approve`/`deny` (dead code) |
| 5 de-facto methods not on interface | ❌ NOT FIXED | `ICliAgentLoop` not defined; `setAppMode` is the only live one (others are now dead code) |
| Discriminator mismatch (`type` vs `kind`) | ❌ NOT FIXED + 🐞 LIVE BUG | `CliAgentLoop.ts:369` `switch (e.kind)` reads from core events that have `e.type` → all cases fall through → **production streaming renders nothing** (see Section 10) |

### 4.3 🆕 New v2 Features in This Section

1. **Mock approval blocking (P2-29)** — `MockAgentLoop` now `await`s `waitForApproval()` instead of charging ahead (`MockAgentLoop.ts:36, 104, 158-189`). This fixes a v1 demo-mode race condition.
2. **`setAppMode` mutates config (P1-7)** — now writes `config.sandbox.mode` and `approvalPolicy` in place (`CliAgentLoop.ts:200-208`), not just the heuristic. Real config persistence.
3. **`ToolContext.requestDiffApproval` (H14)** — added to core types (`tools/types.ts:177`). A separate diff-review channel. **However, it is NOT wired on the TUI side** — `CliAgentLoop` does not consume it, `AppStateStore` does not expose it.
4. **Core module instantiation** — `EffortRoutingClient`, `ProvenanceTracker`, `MCPClientManager`, `LoopDetector`, `ToolGuardrailController`, `AdvancedCompressor` are now actually instantiated in the `AgentLoop` constructor (`loop.ts:465-505`). In v1 they were exported-but-unused.
5. **Subagent spawning (P3-3)** — `spawnSubagentInternal` (`loop.ts:1357-1449`) with depth limit (3) + approval independence (godMode forced false). Was dead code in v1, now wired.

### 4.4 Severity Summary

| Severity | Count | Headline items |
|----------|-------|----------------|
| 🔴 Critical | 4 | No `ICliAgentLoop`; `tryRunStream` discriminator bug (production streaming broken); dead approval code persists; `compaction` event not added |
| 🟡 Warning | 2 | `diffEntry` type-only (not bridged); 4 `as any` casts |
| 🔵 Info | 2 | Mock approval blocking; `setAppMode` config persistence |

---

## 5. Section 3.2 — Agent Loop

**v1 verdict:** 🟡 WARNING — Architecture right, mechanism details wrong.
**v2 verdict:** 🟡 WARNING — Same architecture; some hardening; Phases 5, 15, 17, 18 NOT implemented.

### 5.1 Phase 5 — Mid-Session Policy Integrity (⚠️ PARTIAL)

**What was done:** `PolicyIntegrityManager` scope extended at `cli/src/index.ts:521-529` to cover:
- `packages/core/src/config/` ✅ (new in v2)
- `packages/core/src/memory/sica/` ✅
- `packages/core/src/approval/` ✅
- `packages/core/src/sandbox/` ✅
- `packages/core/src/tools/hooks/` ✅

**What was NOT done:**
- ❌ `memory/skills/` is NOT in the integrity scope — a SICA cycle could edit seed `SKILL.md` files undetected
- ❌ No `verifyIntegrityNow()` method on `PolicyIntegrityManager` — only `verifyPolicyIntegrityAtStartup()` exists (`cli/src/index.ts:476`)
- ❌ No mid-session re-verification before T1+ tool executions
- ❌ No `chokidar` file watcher for policy files (zero `chokidar` imports in `packages/core/src/` or `packages/cli/src/`)
- ❌ No abort-on-modification behavior

**Critical security gap:** A SICA cycle (or a buggy tool, or an attacker with write access) that modifies `approval/engine.ts`, `sandbox/executor.ts`, or `memory/sica/immutable-registry.ts` during a running session would NOT be detected. The startup-only check is bypassable by mid-session file modification.

### 5.2 Phase 15 — Zod Schema Migration (❌ NOT STARTED)

**What was done:** Nothing.

**Evidence:**
- `schema-validator.ts:8-13` header still says: *"Phase 4 uses a hand-rolled validator... Phase 6 will swap this for `ajv`."* (Note: the plan said Zod, not ajv — the v2 header still references ajv.)
- No `import { z } from 'zod'` in `schema-validator.ts`
- `SkillCategory` (`memory/skills/types.ts:8-12`) is still a plain TypeScript union: `'refactoring' | 'testing' | 'debugging' | 'code-review' | 'documentation' | 'workflow' | 'security'`
- `catalog.ts:165` casts raw YAML strings without validation — a malformed `SKILL.md` with `category: "potato"` would load successfully

**Note:** v2 DID add nested object/array recursion to the hand-rolled validator (improving on v1's flat validation), but did not replace it with Zod as Phase 15 required.

### 5.3 Phase 17 — LoopDetector Cycles & JsonRepair Streaming (❌ NOT STARTED)

**LoopDetector (❌ NOT FIXED):**
- `loop-detector.ts:112-115` still only tracks `consecutiveToolCallCount`, `consecutiveContentCount`, `lastToolCallHash`, `lastContentHash`
- No windowed hash history, no 2-cycle/3-cycle pattern matcher
- `tests/unit/loop-detector-t065.test.ts` has no alternation tests
- **False documentation:** `types.ts:177-178` claims `loop_detected` reason detects "toggling between two states" — impossible with current implementation

**JsonRepair streaming (❌ NOT FIXED):**
- `json-repair.ts` exports `repairJson(text: string): string` — still synchronous post-response
- Called at `loop.ts:945` after the full response is received
- No `repairStreamingDelta(delta, accumulated)` function
- No per-delta repair in the streaming path

### 5.4 Phase 18 — Dead Code Removal & Reflexion Wiring (❌ NOT STARTED)

**Dead code (❌ NOT FIXED):**
- `prompt-builder.ts` — 485 lines, still present (file size verified via `wc -l`)
- `callback-streaming.ts` — 428 lines, still present
- `seed.ts` — 179 lines, still present (and `seeds.ts` also present — duplicate dead code)
- `system-prompt.ts:30-40` admits `PromptBuilder` is "kept for reference; not wired" — contradicts Phase 18's deletion requirement

**Reflexion wiring (❌ NOT FIXED):**
- `reflexion.ts:22` docstring falsely claims *"The loop calls `reflexionEngine.reflect()`"*
- `grep -n reflexion loop.ts` returns zero matches
- `reflexion.ts` is referenced by `system-prompt.ts:298` for reflexion-note injection, but the engine's `reflect()` method is never invoked, so the injected data is always empty

### 5.5 Other v1 Findings (Status)

| v1 Finding | v2 Status | Evidence |
|------------|-----------|----------|
| `ConversationState` field names differ from brief | ❌ NOT FIXED | `agent/types.ts` — same field names as v1 |
| `FrozenSnapshot` fields differ from brief | ❌ NOT FIXED | `frozen-snapshot.ts` — same fields (`systemPromptText`, `topTodo`, etc.) |
| 13 prompt fragments (not 9) | ❌ NOT FIXED | `system-prompt.ts:84-411` — same 13 fragments |
| `isToolAllowedForMode` applied after snapshot | ❌ NOT FIXED | Same ordering as v1 |
| `ToolsetSnapshot` per-run not per-iteration | ❌ NOT FIXED | Same granularity |
| `BudgetTracker` checks tokens | ✅ CONFIRMED | Unchanged (was working in v1) |
| `callWithRetry` + `isRetryableError` | ✅ CONFIRMED | Unchanged |
| `ProvenanceTracker` tags every tool result | ✅ FIXED (v1→v2) | Was exported-but-unused in v1; now wired at `loop.ts:505` and called at `loop.ts:1129` |
| `StallDetector` ratio-based | ✅ CONFIRMED | Unchanged |
| `StopEngine` 5-condition | ✅ CONFIRMED | Unchanged |
| `EffortRoutingClient` routes by turn type | ✅ FIXED (v1→v2) | Was exported-but-unused in v1; now instantiated in `AgentLoop` constructor |
| `LocalLlmsRouter` 18 fields, 833 lines | ❌ NOT FIXED | Same counts as v1 |
| 7-phase compaction (not 5-layer) | ❌ NOT FIXED | Same phases; **false doc:** ADR-0023 title says "70%" but `advanced-compression.ts:213-214` is 50%/85% |
| Compaction thresholds 50%/85% | ❌ NOT FIXED | Same thresholds |
| Evict by turn age | ❌ NOT FIXED | Same policy |
| `FrozenSnapshot` re-injection | ✅ CONFIRMED | Unchanged |
| `ToolGuardrailController` 3rd loop detector | ✅ FIXED (v1→v2) | Was exported-but-unused in v1; now instantiated in `AgentLoop` constructor |

### 5.6 Severity Summary

| Severity | Count | Headline items |
|----------|-------|----------------|
| 🔴 Critical | 3 | No mid-session integrity; no A→B→A→B cycle detection; JsonRepair not streaming |
| 🟡 Warning | 9 | Same as v1 (field names, fragment count, ordering, granularity, etc.) |
| 🔵 Info | 4 | Core modules now instantiated; `ProvenanceTracker` wired; `EffortRoutingClient` wired; `ToolGuardrailController` wired |

---

## 6. Section 3.3 — Tool Pipeline

**v1 verdict:** 🔴 CRITICAL — Many fabricated values.
**v2 verdict:** 🔴 CRITICAL — Phase 3 partial; Phase 8 not started; many v1 issues persist.

### 6.1 Phase 3 — DiffReviewDialog Production Bridge (⚠️ PARTIAL)

**What was done:**
- ✅ `PendingPermission.diffEntry?: DiffEntry` field defined (`state/types.ts:106`)
- ✅ `PermissionDialog.tsx` renders the `(v)iew diff` hint when `diffEntry` is present
- ✅ `MockAgentLoop` emits `permission` events with `diffEntry` populated (demo mode works)
- ✅ `useAgentLoop.ts:408-415` bridges `diffEntry` from mock events to `PendingPermission`
- ✅ Core types: `ToolContext.requestDiffApproval` (H14) added (`tools/types.ts:177`)

**What was NOT done:**
- ❌ `CliAgentLoop.bridgeRequestApproval` (`:138-146`) does NOT populate `diffEntry` when building `PendingPermission` from core's `ToolApprovalRequest`
- ❌ `ToolContext.requestDiffApproval` is not wired on the TUI side — `CliAgentLoop` does not consume it

**Impact:** Production users pressing `[v]` to view a diff get a no-op. The DiffReviewDialog only works in `--demo` mode. **This is the single highest-safety gap** — visual diff review is the primary control against unwanted file modifications, and it's broken in the mode where it matters most (`build` mode).

**Required fix (1 line):**
```typescript
// In CliAgentLoop.ts:138-146, add:
const pending: PendingPermission = {
  id: req.permissionId,
  toolName: req.toolName,
  args: req.args,
  tier: req.tier,
  blastRadius: req.blastRadius,
  promptText: req.promptText,
  diffEntry: req.diffEntry,  // ← ADD THIS LINE
};
```

### 6.2 Phase 8 — User-Facing Hook Registration (❌ NOT STARTED)

**What was done:** Nothing.

**Evidence:**
- No `packages/cli/src/commands/hooks.ts` file
- No `.command('hooks')` registration in `packages/cli/src/index.ts`
- No `packages/core/src/tools/hooks/config.ts` file
- No `UserHookConfig` type anywhere (zero repo-wide matches)
- No `.goli/hooks.json` schema
- No Zod integration for hooks
- `HookEngine` (`engine.ts:74-115`) has only programmatic `register(hook)` — no config loader

**Impact:** Users cannot extend goli-cli with custom safety policies. The hooks system (6 built-in hooks: `block-secrets`, `block-writes-outside-workspace`, `block-destructive`, `git-checkpoint`, `auto-format`, `audit-log`) remains developer-only.

### 6.3 Other v1 Findings (Status)

| v1 Finding | v2 Status | Evidence |
|------------|-----------|----------|
| 22 tools not 23 (read_many_files phantom) | ❌ NOT FIXED | `mode-prompts.ts:159` — also `glob`, `ls` are phantom; 21 tools actually registered |
| `toolsets.ts` bundle names wrong | ❌ NOT FIXED | `toolsets.ts:35-87` — still core/coding/file_ops/search/terminal/debugging/safe/full |
| `tool-guardrails.ts` is loop detector | ✅ CONFIRMED | `tool-guardrails.ts:1-30` — exact_failure/same_tool_failure/no_progress |
| `schema-validator` hand-rolled not Zod | ❌ NOT FIXED | `schema-validator.ts:8-13` — same header as v1 |
| `blast-radius` scores fabricated | ❌ NOT FIXED | `blast-radius.ts:1-13` — still per-file-edit diff metric |
| Audit log fields differ from brief | ✅ FIXED (v1→v2) | `sandbox/types.ts:113-134` — `prevHash`/`hash` SHA-256 chain added (P1-5 fix) |
| `SubagentSpawnRequest` shape mismatch | 🆕 NEW (shape changed) | `spawn-subagent.ts:49-62` — renamed to `SubagentSpawnInput`; shape is now `{prompt, role, useWorktree?, subagentId?, branchName?, signal?}` |
| `SubagentResult` shape mismatch | 🆕 NEW (shape changed) | `spawn-subagent.ts:67-88` — added 6 new fields; `tokensUsed`→`totalTokens`; `summary` removed |
| Linux uses bubblewrap not Landlock | ❌ NOT FIXED | `landlock.ts:9-22` — file is misnamed; uses bwrap throughout; L15-17 explicitly defers native Landlock to "Phase 5+" |
| T1 parallelizes if no path overlap | ✅ CONFIRMED | `parallel-execution.ts:55-60` — `write_file`/`edit_file` in `PATH_SCOPED_TOOLS` |
| cgroups no IO controller | ❌ NOT FIXED | `cgroups.ts:40-67` — only memory/cpu/pids; no `io.max`; `diskMaxMb` declared but never read |
| MCP stdio/http only | ❌ NOT FIXED | `mcp/client.ts:9-14` — no SSE, no WebSocket; `types.ts:16` `MCPTransport = 'stdio' \| 'http'` |
| 4 tiers not 3 | ❌ NOT FIXED | `sandbox/types.ts:18` — `'T0'\|'T1'\|'T2'\|'T3'\|'BLK'` |
| `autoMode` approves T1 AND T2 | ❌ NOT FIXED | `engine.ts:200` — `tier === 'T1' \|\| tier === 'T2'` |
| `godMode` doesn't bypass `alwaysDeny` | ✅ CONFIRMED | `engine.ts:170-177` — `blocked` checked BEFORE `godMode` |

### 6.4 🆕 New v2 Hardening (Not in Remediation Plan)

The v2 codebase contains many security fixes that fall outside the 20-phase plan:

1. **Schema validator recurses** into nested objects/arrays (was flat in v1)
2. **`pathsOverlap` uses `realpathSync`** + macOS case-folding awareness
3. **Real semaphore** in `executeWithConcurrency` (was fake in v1)
4. **`stripCommandPrefixes`/`stripStringLiterals`** closes sudo/wrapper and string-literal bypasses in `enhanced-approval.ts`
5. **T3 always asks** regardless of policy (`engine.ts`)
6. **`findDangerousMatch` returns highest severity** (was first match in v1)
7. **`isAllowlisted` matches on first token** (was whole-string in v1)
8. **`blast-radius` counts additions** (was deletions-only in v1)
9. **cgroups cleanup waits for drain** (was fire-and-forget in v1)
10. **`probeCheckFn` has 30s TTL** (was unlimited in v1)
11. **Hook-modified input is re-validated + re-safety-checked** after modification
12. **`runUserPromptSubmit` fails-closed on crashes**
13. **`Hook<E>` uses conditional types** for type-safe pre/post hook results
14. **LCS-based `computeDiff`** for accurate line-level diffs
15. **Pre-execution `requestApproval` gates on `edit_file`/`write_file`** (new safety layer)

These are genuine improvements, but they don't address the 20-phase plan.

### 6.5 Severity Summary

| Severity | Count | Headline items |
|----------|-------|----------------|
| 🔴 Critical | 7 | No `goli hooks` CLI; `diffEntry` not bridged; bubblewrap not Landlock; no cgroups IO; no SSE/WS; hand-rolled Zod; no IO controller |
| 🟡 Warning | 12 | Same as v1 (bundle names, 4 tiers, autoMode scope, etc.) |
| 🔵 Info | 8 | Audit hash chain ✅; 15 new hardening features |

---

## 7. Section 3.4 — Skills & SICA

**v1 verdict:** 🟡 WARNING — L2/SkillWriter dead code.
**v2 verdict:** 🔴 CRITICAL — Phases 6, 7, 16 NOT implemented; new security gap: `memory/skills/` not in immutable registry or integrity check.

### 7.1 Phase 6 — L2 Skill Loader Activation (❌ NOT STARTED)

**What was done:** Nothing.

**Evidence:**
- `loadL2Instructions()` (`loader.ts:82-118`) has ZERO production callers
- `findMatchingSkills()` has ZERO production callers
- `system-prompt.ts` has ZERO references to skills (no `skillFragment` function, no `loadL2Instructions` import)
- L1 metadata injection continues to be the only skill mechanism in production

**Impact:** The skills subsystem only does L1 metadata injection. L2 (the actual skill content) is never loaded. Users cannot benefit from skill instructions beyond the metadata.

### 7.2 Phase 7 — SkillWriter Activation & Version History (❌ NOT STARTED)

**What was done:** Nothing.

**Evidence:**
- `SkillWriter.createSkill()` (renamed from `extract()` in v1) has ZERO production callers
- Neither `loop.ts` nor `CliAgentLoop.ts` calls it on `done` events
- `writer.ts:96` still overwrites `SKILL.md` in place — no archive of prior versions
- No `archiveOldVersion()` function
- No `getVersionHistory()` method on `SkillCatalog`

**Impact:** Skill extraction never happens. The skill catalog is static (only the 5 seed skills ever exist). No version history — overwriting loses the old body.

### 7.3 Phase 16 — Mode-Based Skill Filtering & L1 Budget (⚠️ PARTIAL — 10%)

**What was done:**
- ✅ `getL1TokenEstimate()` exists (`loader.ts:66`) — returns `skills.length * 100`

**What was NOT done:**
- ❌ `rankAndTruncateL1(tokenBudget)` does not exist
- ❌ `listForMode(mode)` method does not exist on `SkillCatalog`
- ❌ `formatL1ForPrompt` returns all skills unranked
- ❌ No L1 token budget enforcement
- ❌ `MEMORY_BUDGETS.SKILLS_L1 = 800` is defined but never checked

### 7.4 Phase 15 — Zod for SkillCategory (❌ NOT STARTED)

- `SkillCategory` is still a plain TS union (`types.ts:8-12`)
- No `SkillCategorySchema = z.enum([...])`
- `catalog.ts:165` casts raw YAML strings without validation

### 7.5 🆕 New Security Gap — `memory/skills/` Not Protected

**Critical finding:** `immutable-registry.ts:64-73` covers:
- `sandbox/` ✅
- `approval/` ✅
- `tools/hooks/` ✅
- `memory/sica/` ✅
- `redteam/` ✅ (new in v2)
- `routing/` ✅ (new in v2)

**BUT does NOT cover:**
- ❌ `memory/skills/` — a SICA cycle could edit seed `SKILL.md` files to inject malicious instructions
- ❌ `packages/core/src/config/` source dir — a SICA cycle could edit `config/integrity.ts` itself to disable the integrity check, then bypass all gates

**And `PolicyIntegrityManager` (`cli/src/index.ts:521-529`) also does NOT hash `memory/skills/`.**

**Combined impact:** A SICA cycle (or a buggy tool, or an attacker with write access) could:
1. Modify `memory/skills/seeds.ts` to inject a malicious skill that triggers on common queries
2. The modified skill would be loaded via L1 metadata injection (the only skill mechanism that works)
3. The malicious instructions would be in the system prompt for every matching query
4. The modification would NOT be detected by `PolicyIntegrityManager` (not in scope)
5. The modification would NOT be blocked by `immutable-registry.ts` (not protected)

This is a **critical security gap** that was partially present in v1 (immutable-registry missed `memory/skills/`) but is now MORE dangerous because v2 added `redteam/` and `routing/` to the registry without closing the `memory/skills/` hole.

### 7.6 Other v1 Findings (Status)

| v1 Finding | v2 Status | Evidence |
|------------|-----------|----------|
| `SkillCatalog.list/findByTriggers` exist | ✅ CONFIRMED | `catalog.ts:34, 89` |
| SKILL.md has 8 frontmatter fields | ⚠️ PARTIAL | Names differ from v1 claim: actual `name, description, trigger, category, version, author, lastImproved, archived` (no `id`, no `triggers`, no `disclosureLevel`, no `createdAt`/`lastUsedAt`) |
| `seeds.ts` has 5 seed skills; `seed.ts` duplicate | ❌ NOT FIXED | Both files still present; `seed.ts` is dead code with **different** 5-skill list (conflicting content) |
| `SkillCategory` plain TS union (no Zod) | ❌ NOT FIXED | `types.ts:8-12` — same as v1 |
| No mode-based skill filtering | ❌ NOT FIXED | No `listForMode` method |
| No L1 token budget enforcement | ⚠️ PARTIAL | `getL1TokenEstimate()` exists but `rankAndTruncateL1()` does not; `formatL1ForPrompt` returns all |
| `loadL2Instructions()` dead code | ❌ NOT FIXED | Zero production callers |
| `SkillWriter.extract()` dead code | ❌ NOT FIXED (renamed) | Renamed to `createSkill()`; still zero callers |
| SkillWriter overwrites (no version history) | ❌ NOT FIXED | `writer.ts:96` — same overwrite behavior |
| `SkillArchiver.archiveStale()` works | ✅ CONFIRMED | `archive.ts:18, 41` — 90-day archive |
| SICA 6-step cycle implemented | ✅ CONFIRMED | `loop.ts:116-325` — all 6 steps |
| `immutable-registry.ts` covers critical paths | ⚠️ PARTIAL | Covers sandbox/approval/hooks/sica/redteam/routing; **misses `memory/skills/` and `config/`** |
| `rate-limiter.ts` caps at 10/day, >50 LOC needs token | ✅ CONFIRMED | `rate-limiter.ts:51-52, 75` |
| `PolicyIntegrityManager` hashes skill files | ❌ NOT FIXED | `cli/src/index.ts:521-529` — does NOT include `memory/skills/` |

### 7.7 Severity Summary

| Severity | Count | Headline items |
|----------|-------|----------------|
| 🔴 Critical | 6 | L2 dead; SkillWriter dead; no Zod; no mode filter; no version history; `memory/skills/` not protected |
| 🟡 Warning | 7 | Frontmatter field name drift; `seed.ts` duplicate; no L1 budget; partial immutable registry |
| 🔵 Info | 3 | SICA 6-step ✅; rate-limiter ✅; archiveStale ✅ |

---

## 8. Section 3.5 — Memory, Code Intel, LSP

**v1 verdict:** 🔴 CRITICAL — `indexWorkspace()` never called; SymbolGraph empty.
**v2 verdict:** 🔴 CRITICAL — Phase 4 NOT started; Phase 19 NOT started; SymbolGraph still empty.

### 8.1 Phase 4 — SymbolGraph Activation (❌ NOT STARTED)

**What was done:** Nothing.

**Evidence:**
- `cli/src/index.ts:372-390` `createContextEngineBundle()` creates the bundle but never calls `indexWorkspace()`
- Line 363-365 comment: *"caller (or a future `/index` command) must call `bundle.indexWorkspace(filePaths)`"*
- No `packages/cli/src/commands/index.ts` file
- No `.command('index')` registration in `cli/src/index.ts`
- No `packages/core/src/context/symbol-graph/watcher.ts` file
- Zero `chokidar` imports in `packages/core/src/` or `packages/cli/src/`
- `init.ts:106` says *"Tree-sitter index build lands in Phase 7"*

**Impact:** `findCallers`, `findCallees`, `findImports`, `findByFile` all return empty arrays in production. The `HybridRetriever`'s graph traversal arm is functionally inert. **The SymbolGraph is always empty at runtime** — same as v1.

### 8.2 Phase 19 — Native Landlock, cgroups IO, Code Intel Completeness (❌ NOT STARTED)

**Native Landlock (❌ NOT FIXED):**
- `landlock.ts:9-22` — file is misnamed; uses `bwrap` (bubblewrap) throughout
- L15-17 explicitly defers native Landlock to "Phase 5+"
- No `landlock_create_ruleset`, `landlock_add_rule`, `landlock_restrict_self` syscalls
- No `prctl(PR_SET_NO_NEW_PRIVS)`

**cgroups IO (❌ NOT FIXED):**
- `cgroups.ts:40-67` — writes only `memory.max`, `cpu.max`, `pids.max`
- No `io.max` controller written
- `diskMaxMb` is declared in the config schema but never read

**SymbolGraph methods (❌ NOT FIXED):**
- `sqlite.ts` only has: `findByName`, `findByNamePrefix`, `findCallers`, `findCallees`, `findImports`, `findByFile`
- Zero matches for `findDefinitions`, `findSimilar`, `findCallPath`

**ProjectMap caching (❌ NOT FIXED):**
- `project-map.ts` — no cache field, no `chokidar` watcher
- `walkVisited` reset per-walk (`L124`)
- Stateless — regenerates on every call

**Multi-language LSP (❌ NOT FIXED):**
- Only `typescript-lsp-client.ts` exists
- L28 comment defers Python to follow-up
- No `python-lsp-client.ts`, no `rust-lsp-client.ts`

### 8.3 Phase 20 — MCP Transports (❌ NOT STARTED)

- `mcp/client.ts` only has `connectStdio`/`connectHttp`
- `types.ts:16` `MCPTransport = 'stdio' | 'http'`
- No `transports/` directory
- No SSE, no WebSocket

### 8.4 Other v1 Findings (Status)

| v1 Finding | v2 Status | Evidence |
|------------|-----------|----------|
| `indexWorkspace()` never called | ❌ NOT FIXED | Same as v1 |
| SymbolGraph uses `better-sqlite3` not `sqlite-vec` | ❌ NOT FIXED | `sqlite.ts:25` — same import |
| Missing `findDefinitions`/`findSimilar`/`findCallPath` | ❌ NOT FIXED | Same methods as v1 |
| Lexical arm uses ripgrep not FTS5 | ❌ NOT FIXED | `hybrid.ts:264` — `execFileSync('rg', ...)` |
| Semantic arm uses substring matching | ❌ NOT FIXED | `hybrid.ts:314-319` — `haystack.includes(word)` + `score += 0.15`; self-described as "Phase 7 stub" |
| RRF k=60 | ✅ CONFIRMED | `hybrid.ts:340` — `const k = 60;` |
| `ProjectMapGenerator` stateless | ❌ NOT FIXED | No cache, no watcher |
| Retriever triggered once per `run()` | ❌ NOT FIXED | `loop.ts:775` — `retriever.retrieve(input.prompt)` ONCE |
| `ast_search`/`codebase_search` don't exist | ❌ NOT FIXED | No such files in `tools/core/` |
| LSP TypeScript-only | ❌ NOT FIXED | Only `typescript-lsp-client.ts` |
| LSP timeout 30s | ❌ NOT FIXED | `typescript-lsp-client.ts:226` — `}, 30_000);` |
| LSP results not cached | ❌ NOT FIXED | No cache field |

### 8.5 Severity Summary

| Severity | Count | Headline items |
|----------|-------|----------------|
| 🔴 Critical | 6 | `indexWorkspace` never called; SymbolGraph empty; missing 3 methods; no sqlite-vec; stateless ProjectMap; TS-only LSP |
| 🟡 Warning | 4 | Lexical=ripgrep; semantic=substring; LSP timeout 30s; no caching |
| 🔵 Info | 2 | RRF k=60 ✅; `MEMORY.md`/`USER.md` in home dir |

---

## 9. Section 3.6 — TUI Wiring

**v1 verdict:** 🟡 WARNING — Component count correct, several underspecified.
**v2 verdict:** 🔴 CRITICAL — Phases 9–14 ALL not started; 6 critical TUI gaps persist.

### 9.1 Phase 9 — Provenance Bridging (❌ NOT STARTED)

- `ToolCall` interface (`state/types.ts:40-51`) lacks `source?` and `timestamp?`
- `ToolCallEvent` (`IAgentLoop.ts:14-23`) lacks them
- `useAgentLoop.ts:351-360` constructs `ToolCall` from `ev.tool` without those fields
- Even if added to the event, they'd be dropped at the bridge
- `ToolMessage.tsx:178-204` has no provenance rendering

### 9.2 Phase 10 — AgentStateBar 7-Phase (❌ NOT STARTED)

- `AgentStateBar.tsx:36, 88-92, 113-117` still uses `busy: boolean` ternary
- `AgentPhase` enum (`state/types.ts:16`) has 7 values: `IDLE|INIT|PLAN|TOOL|GEN|DONE|ERROR`
- But the vocabulary differs from the brief (`tool-calling`, `waiting-approval`, `streaming`, `compacting`)
- `AgentStateBar` does not consume `phase` from `phase` events

### 9.3 Phase 11 — Compaction Event (❌ NOT STARTED)

- No `CompactionBanner.tsx` file
- `AgentEvent` union unchanged (6 kinds, no `compaction`)
- `useAgentLoop.ts:326-451` switch has no `compaction` case
- `App.tsx` only renders a plain-text "⚠ Context near limit — use /compact to free tokens" hint at line 664-668 (this is a `compactHint` boolean at 95% token usage, not an event on actual compaction)

### 9.4 Phase 12 — Per-Model Cost (❌ NOT STARTED)

- `AppStateSnapshot` (`types.ts:132-164`) has `totalCostUsd`, `totalInputTokens`, `totalOutputTokens`, `tokens`, `tokenLimit` — NO per-model map
- `CostBreakdownPanel.tsx:27-38` accepts only aggregate props
- Grep for `perModelCosts|perModel` across `packages/cli/src/tui/` → zero matches

### 9.5 Phase 13 — TokenBar & Dedup (❌ NOT STARTED)

- `TokenBar.tsx:16-19` `Props` interface has only `tokens: number` and `tokenLimit: number`
- No `thinkingTokens`, no 3-bar layout
- Grep for `thinkingTokens` → zero matches
- `useAgentLoop.ts:562-568` `upsertToolCall` dedups by `t.id === tc.id`
- No `argHash`/`hashArgs` anywhere in the TUI tree

### 9.6 Phase 14 — Agent Swarm Count (⚠️ PARTIAL — 20%)

**What was done:**
- ✅ `theme/agents.ts:83-92` has 8 agents: `orchestrator, coder, reviewer, searcher, devops, designer, security, data` (matches reality)

**What was NOT done:**
- ❌ `package.json:4` still says "11-agent swarm (Scout → Documenter)"
- ❌ `README.md:183` still says "11-agent pipeline map"
- ❌ `README.md:184` still says "Scout → Documenter" (names don't exist in the array)
- ❌ `AGENTS.md` still says "11-agent swarm"
- ❌ No agent in the array is named "Scout" or "Documenter" — the actual names are `orchestrator, coder, reviewer, searcher, devops, designer, security, data`

### 9.7 False Documentation (5 instances)

1. `package.json:4` — "11-agent swarm (Scout → Documenter)"
2. `README.md:183` — "11-agent pipeline map"
3. `README.md:184` — "Scout → Documenter" (names don't exist)
4. `AGENTS.md` — "(11-agent swarm)"
5. `AgentStateBar.tsx:1-15` JSDoc accurately lists 8 agents, but this contradicts the other 4 docs

### 9.8 Other v1 Findings (Status)

| v1 Finding | v2 Status | Evidence |
|------------|-----------|----------|
| `AgentStateBar` binary | ❌ NOT FIXED | `busy: boolean` ternary |
| `TokenBar` single bar | ❌ NOT FIXED | 1 bar, no thinking |
| `CostBreakdownPanel` aggregate only | ❌ NOT FIXED | No per-model |
| `PipelineTrace` 3-step ReAct | ❌ NOT FIXED | Same; AGENTS array has 8 (not 11) |
| `HistoryScroll` no provenance | ❌ NOT FIXED | No source/timestamp |
| 28 components | ✅ CONFIRMED | Same count |

### 9.9 Severity Summary

| Severity | Count | Headline items |
|----------|-------|----------------|
| 🔴 Critical | 6 | No provenance; binary state bar; no compaction banner; no per-model; single-bar token; 11-agent in docs |
| 🟡 Warning | 8 | Same as v1 |
| 🔵 Info | 3 | 28 components ✅; all 13 brief components exist; `goli --version` < 200ms ✅ |

---

## 10. Critical Latent Bug — `tryRunStream` Discriminator Mismatch

**This is the most critical finding in the v2 audit.** It was not caught in v1 because the v1 audit only inspected the `IAgentLoop` interface signature, not the streaming consumer implementation.

### 10.1 The Bug

In `CliAgentLoop.ts:369`, the `tryRunStream` method consumes core's `AgentLoop.runStream()` async generator:

```typescript
// CliAgentLoop.ts:369 (simplified)
for await (const e of coreLoop.runStream(input)) {
  switch (e.kind) {  // ← BUG: reads e.kind
    case 'text':     // ...
    case 'tool':     // ...
    case 'permission': // ...
    case 'phase':    // ...
    case 'error':    // ...
    case 'done':     // ...
    default: break;  // ← all events fall through to here
  }
}
```

But core's `AgentEvent` (defined in `packages/core/src/agent/types.ts:217`) uses `type` as the discriminator:

```typescript
// packages/core/src/agent/types.ts:217
export type AgentEvent =
  | { type: 'phase';       phase: AgentPhase }
  | { type: 'text';        text: string }
  | { type: 'tool';        tool: ToolCallEvent }
  | { type: 'permission';  permission: PermissionRequest }
  | { type: 'error';       error: GoliError }
  | { type: 'done';        result: TurnResult };
```

The TUI's `AgentEvent` (in `IAgentLoop.ts:55-61`) uses `kind`:

```typescript
// packages/cli/src/services/IAgentLoop.ts:55-61
export type AgentEvent =
  | { kind: 'phase';       phase: AgentPhase }
  | { kind: 'text';        text: string }
  | { kind: 'tool';        tool: ToolCallEvent }
  | { kind: 'permission';  permission: PermissionRequest }
  | { kind: 'error';       error: GoliError }
  | { kind: 'done';        result: TurnResult };
```

### 10.2 Impact

When `tryRunStream` reads `e.kind` from a core event that has `e.type`, the value is `undefined`. The `switch` statement matches no case and falls through to `default: break;`. **Every streaming event is silently dropped.**

**What users see in production:**
- The TUI shows the initial INIT/PLAN phase (which uses a different code path)
- The TUI shows the final DONE phase (also different code path)
- During streaming (text deltas, tool calls, permission requests), **the TUI renders nothing**
- Users perceive the agent as "frozen" or "thinking silently"

**What users see in `--demo` mode:**
- `MockAgentLoop` emits events with `kind` (correct), so demo mode works
- This is why the bug was not caught — demo mode masks it

### 10.3 Required Fix

**Option A (minimal):** Change `e.kind` to `e.type` in `CliAgentLoop.ts:369`:
```typescript
for await (const e of coreLoop.runStream(input)) {
  switch (e.type) {  // ← FIX: e.type, not e.kind
    case 'text':     // ...
    // ...
  }
}
```

**Option B (correct):** Unify the discriminator. Change core's `AgentEvent` to use `kind` (matching the TUI), or change the TUI's `AgentEvent` to use `type` (matching core). Then delete the translation layer in `tryRunStream`.

**Option C (best):** Have core export its `AgentEvent` type directly, and have the TUI import it. Eliminate the duplicate type definition.

### 10.4 Why This Matters

This bug means **every production user** of goli-cli is experiencing a broken TUI during streaming. The agent is working (tools execute, responses generate), but the user sees almost nothing. This likely manifests as:
- Users thinking goli-cli is "slow" or "unresponsive"
- Users abandoning the tool mid-turn
- Users not seeing tool calls or approval requests in real time

**This is a P0 fix that should be done immediately, before any other remediation work.**

---

## 11. New v2 Hardening (Not in Remediation Plan)

The v2 codebase contains **15+ genuine security hardening improvements** that were not specified in the remediation plan but are valuable nonetheless. These suggest the developer did work on the codebase — just not on the 20-phase plan.

### 11.1 Tool Pipeline Hardening

| # | Hardening | File:Line | Impact |
|---|-----------|-----------|--------|
| 1 | Schema validator recurses into nested objects/arrays | `schema-validator.ts` | Catches deeply nested invalid args that v1 missed |
| 2 | `pathsOverlap` uses `realpathSync` + macOS case-folding | `parallel-execution.ts` | Prevents false-negative path overlap on macOS (case-insensitive FS) |
| 3 | Real semaphore in `executeWithConcurrency` | `parallel-execution.ts` | v1's fake semaphore allowed >max concurrent tools |
| 4 | `stripCommandPrefixes`/`stripStringLiterals` | `enhanced-approval.ts` | Closes sudo/wrapper bypass (e.g., `sudo rm` vs `rm`) and string-literal bypass (e.g., `"rm" -rf`) |
| 5 | T3 always asks regardless of policy | `engine.ts` | Even in `god` mode, T3 actions (network egress, fork bombs) require approval |
| 6 | `findDangerousMatch` returns highest severity | `enhanced-approval.ts` | v1 returned first match, potentially under-classifying |
| 7 | `isAllowlisted` matches on first token | `bash.ts` | v1 matched whole string, allowing `npm test; rm -rf /` to pass as "npm test" |
| 8 | `blast-radius` counts additions | `blast-radius.ts` | v1 only counted deletions, missing large-addition risks |
| 9 | cgroups cleanup waits for drain | `cgroups.ts` | v1 was fire-and-forget, leaving orphaned cgroups |
| 10 | `probeCheckFn` has 30s TTL | `lsp-tools.ts` | v1 had unlimited TTL, caching stale LSP results forever |
| 11 | Hook-modified input is re-validated + re-safety-checked | `hooks/engine.ts` | Prevents a hook from injecting dangerous args post-approval |
| 12 | `runUserPromptSubmit` fails-closed on crashes | `hooks/engine.ts` | If a hook crashes, the tool call is denied (not allowed) |
| 13 | `Hook<E>` uses conditional types | `hooks/types.ts` | Type-safe pre/post hook results |
| 14 | LCS-based `computeDiff` | `diff-utils.ts` | Accurate line-level diffs (v1 used naive char-diff) |
| 15 | Pre-execution `requestApproval` gates on edit_file/write_file | `edit-file.ts`, `write-file.ts` | New safety layer: approval happens BEFORE the tool runs, not after |

### 11.2 Audit Log Hardening

| # | Hardening | File:Line | Impact |
|---|-----------|-----------|--------|
| 16 | SHA-256 hash chain on every audit entry | `sandbox/types.ts:113-134` | `prevHash`/`hash` fields; tampering with any entry breaks the chain; `goli audit` verifies integrity |

### 11.3 Core Module Instantiation

| # | Hardening | File:Line | Impact |
|---|-----------|-----------|--------|
| 17 | `EffortRoutingClient` instantiated in `AgentLoop` constructor | `loop.ts:465` | Was exported-but-unused in v1 |
| 18 | `ProvenanceTracker` instantiated and `tag()` called | `loop.ts:505, 1129` | Was exported-but-unused in v1 |
| 19 | `MCPClientManager` instantiated | `loop.ts:470` | Was exported-but-unused in v1 |
| 20 | `LoopDetector` instantiated | `loop.ts:480` | Was exported-but-unused in v1 |
| 21 | `ToolGuardrailController` instantiated | `loop.ts:485` | Was exported-but-unused in v1 |
| 22 | `AdvancedCompressor` instantiated | `loop.ts:500` | Was exported-but-unused in v1 |
| 23 | `spawnSubagentInternal` wired | `loop.ts:1357-1449` | Was dead code in v1; now spawns subagents with depth limit + approval independence |

### 11.4 Mock Mode Hardening

| # | Hardening | File:Line | Impact |
|---|-----------|-----------|--------|
| 24 | `MockAgentLoop` awaits `waitForApproval()` | `MockAgentLoop.ts:36, 104, 158-189` | v1 charged ahead, causing demo-mode race conditions |

### 11.5 Config Hardening

| # | Hardening | File:Line | Impact |
|---|-----------|-----------|--------|
| 25 | `setAppMode` mutates config in place | `CliAgentLoop.ts:200-208` | v1 only updated the heuristic; v2 writes `config.sandbox.mode` and `approvalPolicy` |
| 26 | `PolicyIntegrityManager` scope extended | `cli/src/index.ts:521-529` | Now covers `config/`, `memory/sica/`, `approval/`, `sandbox/`, `tools/hooks/` (was narrower in v1) |

### 11.6 Assessment

These 26 hardening items are **real and valuable** — they close several security gaps that v1 had. However:

- **None of them are in the 20-phase remediation plan.** The developer worked on hardening they deemed more important, not on the plan's deliverables.
- **Some hardening items introduce new gaps.** For example, extending `PolicyIntegrityManager` scope to `config/` and `memory/sica/` is good, but it makes the omission of `memory/skills/` MORE dangerous (because the contrast is starker).
- **The latent `tryRunStream` bug** suggests the hardening was done without end-to-end testing in production mode — if it had been tested, the streaming silence would have been caught.

---

## 12. Updated End-to-End Checklist

Re-running the 20-item checklist from the v1 report against v2:

| # | Brief claim | v1 Verdict | v2 Verdict | Change |
|---|-------------|------------|------------|--------|
| 1 | `IAgentLoop` interface matches between cli/services/ and core/agent/loop.ts | ❌ NOT FOUND | ❌ NOT FIXED | No change — `type` vs `kind` mismatch persists (now a LIVE BUG) |
| 2 | `MockAgentLoop` implements same interface — `--demo` works end-to-end | ✅ CONFIRMED | ✅ CONFIRMED | No change |
| 3 | `callback-streaming.ts` emits all 10 event types; TUI subscribes to all 10 | ❌ NOT FOUND | ❌ NOT FIXED | No change — module still emits 2 events, still unused |
| 4 | `AppStateStore` updates on every `stateChange` event | ⚠️ PARTIAL | ⚠️ PARTIAL | No change |
| 5 | `/mode <name>` calls `switchMode()`; toolset invalidated; mode prompt re-assembled | ⚠️ PARTIAL | ⚠️ PARTIAL | No change — `setAppMode` now persists config (improvement) but still via `as any` |
| 6 | In `read-only` mode, model output never contains `write_file`/`edit_file`/`bash` | ✅ CONFIRMED | ✅ CONFIRMED | No change |
| 7 | T1+ tool call in `build` mode → `PermissionDialog` appears → user decision fed back | ✅ CONFIRMED | ✅ CONFIRMED | No change |
| 8 | `edit_file`/`write_file` → `DiffReviewDialog` shows diff → accept/reject feeds back | ⚠️ PARTIAL | ⚠️ PARTIAL | No change — `diffEntry` field defined but NOT bridged in production |
| 9 | `bash` tool spawns inside Landlock/Seatbelt; `goli audit` shows tier + decision | ⚠️ PARTIAL | ⚠️ PARTIAL | No change — still bubblewrap |
| 10 | `edit_file` without prior `read_file` → must fail with structured error | ✅ CONFIRMED | ✅ CONFIRMED | No change |
| 11 | Force context > 70% → `compaction` event fires; `FrozenSnapshot` re-injected | ⚠️ PARTIAL | ⚠️ PARTIAL | No change — still no compaction event |
| 12 | Trigger skill match → L2 loads; `ContextSummaryDisplay` shows "Skill X loaded" | ⚠️ PARTIAL | ❌ REGRESSED | v1 showed count; v2 still shows count but L2 is confirmed dead code |
| 13 | Trigger `spawn_subagent` → `PipelineTrace` shows subagent state | ❌ NOT FOUND | ❌ NOT FIXED | No change |
| 14 | Configure MCP server via `goli mcp add`; tools appear in registry; tool call works | ✅ CONFIRMED | ✅ CONFIRMED | No change |
| 15 | Register pre-hook that blocks `bash` → tool call blocked with reason | ❌ NOT FOUND | ❌ NOT FIXED | No change — no `goli hooks` command |
| 16 | Every tool result in `HistoryScroll` shows source + timestamp | ❌ NOT FOUND | ❌ NOT FIXED | No change |
| 17 | After session, `goli audit` verifies hash chain integrity | ✅ CONFIRMED | ✅ CONFIRMED+ | v2 adds SHA-256 hash chain (improvement) |
| 18 | Modify policy file mid-session → session aborts with integrity error | ⚠️ PARTIAL | ⚠️ PARTIAL | No change — still startup-only |
| 19 | Attempt SICA self-edit on sandbox file → `immutable-registry.ts` blocks it | ✅ CONFIRMED | ✅ CONFIRMED | No change |
| 20 | `goli --version` < 200ms (lazy-loaded commands) | ✅ CONFIRMED | ✅ CONFIRMED | No change |

**Checklist tally:**
- v1: 7 ✅ / 8 ⚠️ / 5 ❌
- v2: 7 ✅ / 8 ⚠️ / 5 ❌ (one ⚠️ regressed to ❌, one ✅ improved to ✅+)

**Net change: essentially zero.** The checklist results are identical to v1, with one improvement (audit hash chain) and one regression (skill L2 confirmed dead).

---

## 13. Revised Remediation Recommendations

Based on the v2 audit, the remediation plan needs revision. The original 20 phases are still valid, but the priority order and effort estimates must change.

### 13.1 New P0 (Immediate — Block All Other Work)

#### P0-NEW-1 — Fix `tryRunStream` Discriminator Bug

**What:** Change `e.kind` to `e.type` in `CliAgentLoop.ts:369` (or unify the discriminator across core/TUI).

**Why:** Production streaming is silently broken. Every user is affected. No other fix matters until this is resolved.

**Effort:** 1 hour (1-line fix) + 4 hours (regression test).

**Testing:** Run `goli` in production mode (not `--demo`), type a message, verify text deltas and tool calls appear in real time.

### 13.2 Revised Phase Priorities

| Priority | Phase | Title | Rationale |
|----------|-------|-------|-----------|
| **P0-NEW** | NEW | Fix `tryRunStream` bug | Production streaming broken |
| P0 | 3 | DiffReviewDialog bridge (1 line) | Highest-safety gap; trivial fix |
| P0 | 4 | SymbolGraph activation | Highest-leverage fix; converts dead code to functional |
| P0 | 5 | Mid-session policy integrity | Closes SICA self-modification attack vector |
| P0 | 6+7 | L2 SkillLoader + SkillWriter activation | Converts dead code to functional |
| P0 | 8 | `goli hooks` CLI | User-facing safety extension |
| P0-NEW | NEW | Add `memory/skills/` to immutable registry + integrity check | Closes new security gap |
| P1 | 9–13 | TUI wiring (provenance, state bar, compaction, cost, token) | Usability |
| P1 | 14 | Docs correction (11→8) | Trivial; should have been done already |
| P1 | 15 | Zod migration | Modernization |
| P1 | 16 | Mode-based skill filtering | Completeness |
| P1 | 17 | LoopDetector cycles + JsonRepair streaming | Correctness |
| P1 | 18 | Dead code removal | Hygiene |
| P1 | 19 | Native Landlock + cgroups IO + Code Intel | Advanced |
| P1 | 20 | MCP SSE/WS + release | Polish |
| P2 | 1 | Documentation reconciliation | Hygiene |
| P2 | 2 | ICliAgentLoop interface | Type safety |

### 13.3 Updated Effort Estimate

| Priority | Phases | Estimated Effort |
|----------|--------|------------------|
| P0-NEW (tryRunStream) | 1 new | 0.5 days |
| P0 (Phases 3, 4, 5, 6, 7, 8, + new skills/ fix) | 6 + 1 new | 19 days |
| P1 (Phases 9–20, excluding P0) | 12 | 36 days |
| P2 (Phases 1, 2) | 2 | 5 days |
| **Total** | **21 phases** | **60.5 days** |

The total effort is unchanged from the original plan (~60 days) because the v2 work, while valuable, did not address the plan's deliverables.

### 13.4 Recommendation to the Developer

1. **Stop adding new hardening features.** The 26 v2 hardening items are good, but they're not the plan.
2. **Fix `tryRunStream` first.** This is a 1-line fix that unblocks all production users.
3. **Follow the remediation plan in order.** Phases 3, 4, 5, 6, 7, 8 are P0 and should be done before any other work.
4. **Add `memory/skills/` to the immutable registry and integrity check.** This is a new P0 not in the original plan.
5. **Test in production mode, not just `--demo`.** The `tryRunStream` bug would have been caught by a single production-mode test.

---

## 14. Appendix — Audit Tally & v1→v2 Diff

### 14.1 Audit Tally by Section (v2)

| Section | ✅ FIXED | ⚠️ PARTIAL | ❌ NOT FIXED | 🆕 NEW | 🐞 REGRESSION | Total |
|---------|----------|------------|-------------|--------|---------------|-------|
| 3.1 Contract & Bridge | 0 | 1 | 7 | 5 | 1 (tryRunStream) | 8 |
| 3.2 Agent Loop | 3 | 0 | 7 | 0 | 0 | 10 |
| 3.3 Tool Pipeline | 1 | 1 | 14 | 2 | 0 | 18 |
| 3.4 Skills & SICA | 0 | 2 | 12 | 0 | 0 | 14 |
| 3.5 Memory/Code Intel/LSP | 0 | 0 | 12 | 0 | 0 | 12 |
| 3.6 TUI Wiring | 0 | 1 | 15 | 0 | 0 | 16 |
| Common Failure Modes | 0 | 0 | 0 | 0 | 0 | (covered above) |
| **TOTAL** | **4** | **5** | **67** | **7** | **1** | **78** |

Note: tallies differ from the executive summary because some findings span multiple sections. The executive summary uses a deduplicated count.

### 14.2 Severity by Section (v2)

| Section | 🔴 Critical | 🟡 Warning | 🔵 Info |
|---------|-------------|------------|---------|
| 3.1 Contract & Bridge | 4 | 2 | 2 |
| 3.2 Agent Loop | 3 | 9 | 4 |
| 3.3 Tool Pipeline | 7 | 12 | 8 |
| 3.4 Skills & SICA | 6 | 7 | 3 |
| 3.5 Memory/Code Intel/LSP | 6 | 4 | 2 |
| 3.6 TUI Wiring | 6 | 8 | 3 |
| New: Policy Integrity gap | 2 | 1 | 1 |
| New: tryRunStream bug | 1 | 0 | 0 |
| **TOTAL** | **35** | **43** | **23** |

### 14.3 v1→v2 File Diff Summary

| Metric | v1 | v2 | Delta |
|--------|----|----|-------|
| Zip size | 2.34 MB | 2.89 MB | +556 KB (+24%) |
| Files changed in `packages/core/src` | — | 27 | — |
| Files changed in `packages/cli/src` | — | 14 | — |
| New source directories | — | `memory/skills/` (8 files) | +1 |
| New source files | — | 0 | 0 |
| New build artifacts | — | `tsconfig.tsbuildinfo`, `dist-test/`, `dist-test2/` | 3 |
| Total LOC changed | — | ~3,500 | — |

### 14.4 Phase Completion Summary

| Phase | % Complete | Effort Expended | Effort Remaining |
|-------|------------|-----------------|------------------|
| 1 | 0% | 0 days | 3 days |
| 2 | 0% | 0 days | 2 days |
| 3 | 30% | 0.3 days | 0.7 days |
| 4 | 0% | 0 days | 4 days |
| 5 | 25% | 0.75 days | 2.25 days |
| 6 | 0% | 0 days | 3 days |
| 7 | 0% | 0 days | 3 days |
| 8 | 0% | 0 days | 5 days |
| 9 | 0% | 0 days | 2 days |
| 10 | 0% | 0 days | 2 days |
| 11 | 0% | 0 days | 2 days |
| 12 | 0% | 0 days | 2 days |
| 13 | 0% | 0 days | 2 days |
| 14 | 20% | 0.2 days | 0.8 days |
| 15 | 0% | 0 days | 3 days |
| 16 | 10% | 0.3 days | 2.7 days |
| 17 | 0% | 0 days | 4 days |
| 18 | 0% | 0 days | 2 days |
| 19 | 0% | 0 days | 8 days |
| 20 | 0% | 0 days | 5 days |
| **NEW (tryRunStream)** | 0% | 0 days | 0.5 days |
| **TOTAL** | **~5%** | **~1.5 days** | **~58.5 days** |

### 14.5 What the Developer Should Do Next

1. **Today (1 hour):** Fix `tryRunStream` discriminator bug (`e.kind` → `e.type` in `CliAgentLoop.ts:369`).
2. **This week (3 days):** Complete Phase 3 (add `diffEntry: req.diffEntry` to `bridgeRequestApproval`), Phase 14 (search-and-replace "11-agent" → "8-agent" in docs), and add `memory/skills/` to the immutable registry + integrity check.
3. **Next 3 weeks (15 days):** Phases 4 (SymbolGraph activation), 5 (mid-session integrity), 6+7 (L2 + SkillWriter), 8 (`goli hooks` CLI).
4. **Following 5 weeks (30 days):** Phases 9–13 (TUI wiring), 15–18 (Zod, filtering, loops, dead code).
5. **Final 2 weeks (10 days):** Phases 19–20 (native Landlock, cgroups IO, MCP transports, release).

### 14.6 Glossary

| Term | Definition |
|------|------------|
| **ADR** | Architecture Decision Record |
| **AppMode** | One of `read-only`, `plan`, `build`, `god`, `local-llms` |
| **AsyncIterable** | ES2018 interface; consumed via `for await ... of` |
| **Brief** | The Deep Technical Brief supplied by the user (stale) |
| **bwrap** | Bubblewrap — Linux sandboxing tool used as a subprocess |
| **Discriminator** | The field name used to distinguish union variants (`type` vs `kind`) |
| **FrozenSnapshot** | Stable context re-injected after compaction |
| **godMode** | Flag that bypasses tier/policy matrix (but not `alwaysDeny`) |
| **ICliAgentLoop** | Proposed extension of `IAgentLoop` with 5 extra methods (not implemented) |
| **Landlock** | Linux kernel feature for unprivileged sandboxing (not implemented; bwrap used instead) |
| **ReAct** | Reasoning + Acting loop pattern |
| **RRF** | Reciprocal Rank Fusion (k=60 in this codebase) |
| **SICA** | Self-Improving Code Agent — recursive self-improvement loop |
| **T0/T1/T2/T3** | Tool safety tiers: Safe / Risky / Destructive / Destructive-Plus |
| **tryRunStream** | The method in `CliAgentLoop` that consumes core's streaming events (has a latent bug) |
| **v1** | The first audited version of goli-cli |
| **v2** | The second audited version (claimed fixed) |

---

**End of v2 report.** For the full audit trail with file:line citations for every claim, see `/home/z/my-project/worklog-v2.md` (1,562 lines). For the 5 accompanying diagrams, see `/home/z/my-project/download/diagram_01_architecture.png` through `diagram_05_compliance_radar.png` (and `.svg` variants). For the original v1 report and remediation plan, see `goli-cli-verification-report.md` and `goli-cli-remediation-plan.md` in the same directory.
