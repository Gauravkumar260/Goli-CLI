# Goli-CLI Remediation Plan — 20-Phase Deep Detail

**Companion to:** `goli-cli-verification-report.md`
**Audit baseline:** v0.3.0-phase2-studio
**Plan date:** 2026-08-01
**Total scope:** 30 Critical + 39 Warning + 25 Info findings = 94 issues mapped to 20 phases
**Estimated total effort:** 12–18 engineer-weeks (sequenced), 7–10 weeks (parallelized)
**Target release:** v0.4.0-stable

---

## Table of Contents

| Phase | Title | Priority | Effort | Dependencies |
|-------|-------|----------|--------|--------------|
| 1 | Documentation Reconciliation & Brief Rewrite | P2 | 3 days | None |
| 2 | IAgentLoop Contract Hardening | P1 | 2 days | Phase 1 |
| 3 | DiffReviewDialog Production Bridge | P0 | 1 day | Phase 2 |
| 4 | SymbolGraph Activation | P0 | 4 days | None |
| 5 | Mid-Session Policy Integrity | P0 | 3 days | None |
| 6 | L2 Skill Loader Activation | P0 | 3 days | Phase 1 |
| 7 | SkillWriter Activation & Version History | P0 | 3 days | Phase 6 |
| 8 | User-Facing Hook Registration | P0 | 5 days | None |
| 9 | Provenance Bridging to TUI | P1 | 2 days | Phase 2 |
| 10 | AgentStateBar 7-Phase Display | P1 | 2 days | Phase 2 |
| 11 | Compaction Event Emission | P1 | 2 days | Phase 2 |
| 12 | Per-Model Cost Breakdown | P1 | 2 days | Phase 2 |
| 13 | TokenBar & Tool Call Dedup Fixes | P1 | 2 days | Phase 2 |
| 14 | Agent Swarm Count Correction | P1 | 1 day | None |
| 15 | Zod Schema Migration | P1 | 3 days | None |
| 16 | Mode-Based Skill Filtering & L1 Budget | P1 | 3 days | Phase 6 |
| 17 | LoopDetector Cycles & JsonRepair Streaming | P1 | 4 days | None |
| 18 | Dead Code Removal & Reflexion Wiring | P2 | 2 days | Phase 6 |
| 19 | Native Landlock, cgroups IO, Code Intel Completeness | P1 | 8 days | Phase 4 |
| 20 | MCP Transports, Failure Surfacing & Final Release | P1 | 5 days | All |

---

## Phase 1 — Documentation Reconciliation & Brief Rewrite

**Goal:** Eliminate the gap between the stale technical brief and the actual codebase. Make `CODE-MAP.md` the single source of truth for the `@goli/core` ↔ `@goli/cli` contract.

**Issues addressed:** P2-1, P2-2, P2-3; C1 (docs), C2 (docs), C3 (docs), C6 (docs), C7 (docs), C8 (docs), C9 (docs), C10 (docs), C11 (docs), C13 (docs), C14 (docs), C15 (docs); all "fabricated values" and "inflated counts" from the report's §9.3.

### Problem Statement

The verification report identified 11 fabricated values and 9 inflated counts in the existing brief. The repo's own `CODE-MAP.md` already declares the brief stale. Engineers onboarding to the project cannot trust the brief, which leads to incorrect mental models and wasted debugging time.

### Root Cause

The brief was written against an earlier prototype (likely v0.1.x or v0.2.x). The codebase evolved through Phases 1–2 of the studio migration, but the brief was never updated. `CODE-MAP.md` was introduced as the replacement but the brief was not deleted or redirected.

### Files to Modify

| File | Action | Reason |
|------|--------|--------|
| `docs/design/goli-core-tui-brief.md` (or wherever the brief lives) | **Rewrite or delete** | Replace stale 10-method/10-event claims |
| `CODE-MAP.md` | **Promote to canonical** | Add "Source of Truth" header |
| `README.md` | **Update counts** | 11-agent → 8-agent; 23 tools → 22 tools |
| `package.json` | **Update description** | "11-agent swarm" → "8-agent swarm" |
| `AGENTS.md` | **Update contract section** | Reflect 5-method IAgentLoop |
| `CHANGELOG.md` | **Add entry** | "Documentation reconciliation" |
| `docs/decisions/ADR-0009.md` through `ADR-0046.md` | **Cross-check** | Verify ADR claims match current code |

### Implementation Steps

**Step 1.1 — Audit `CODE-MAP.md` for completeness.** Read the full file. For each section, verify every claim against the actual code (the verification report already did this — use it as the checklist). Fix any drift in `CODE-MAP.md` itself.

**Step 1.2 — Rewrite or delete the brief.** Recommended: delete the brief and replace with a one-page pointer:
```markdown
# @goli/core ↔ @goli/cli Connection

**Canonical reference:** `CODE-MAP.md` (repository root)

The previously maintained "Deep Technical Brief" was deprecated in v0.4.0
because it drifted from the implementation. All architectural claims should
be verified against `CODE-MAP.md` and the actual source code.
```

**Step 1.3 — Fix all inflated counts.** Use the report's §9.3 table as the authoritative list. Specific corrections:

| Location | Old | New |
|----------|-----|-----|
| `README.md` agent count | "11-agent swarm" | "8-agent swarm" |
| `package.json` description | "11-agent swarm" | "8-agent swarm" |
| `AGENTS.md` tool count | "23 core tools" | "22 core tools (21 in registry + plan_task inline)" |
| `AGENTS.md` prompt fragments | "9 fragments" | "13 fragments" |
| `AGENTS.md` compaction | "5-layer" | "7-phase" |
| `AGENTS.md` compaction threshold | "70%" | "50% soft / 85% hard" |
| `AGENTS.md` tiers | "T0/T1/T2" | "T0/T1/T2/T3" |
| `AGENTS.md` LocalLlmsRouter | "17 fields, 755 lines" | "18 fields, 833 lines" |
| `AGENTS.md` MEMORY_BUDGETS | `skillsL1` | `SKILLS_L1` |

**Step 1.4 — Fix all fabricated values.** Remove or correct:

- Blast-radius scores (`1/1/8/10/10`) — replace with: "Blast radius is a per-file-edit diff metric (0–10 scale) based on deletion ratio, addition lines, and file sensitivity. Bash commands are scored by `alwaysDeny` pattern matching, not blast radius."
- Audit log field list — replace with actual `AuditLogEntry` shape from `sandbox/audit-log.ts:34-52`.
- `SubagentSpawnRequest` shape — replace with actual from `tools/core/spawn-subagent.ts:34-48`.
- `SubagentResult` shape — replace with actual from `context/subagent/isolation.ts:42-58`.
- `toolsets.ts` bundle names — replace with actual: `core`, `coding`, `file_ops`, `search`, `terminal`, `debugging`, `safe`, `full`.
- Linux Landlock description — replace with: "Linux uses bubblewrap (`bwrap`) for sandboxing. Native Landlock syscalls are Phase 5+ future work."
- `tool-guardrails.ts` description — replace with: "`tool-guardrails.ts` is a third loop-detection layer (exact_failure, same_tool_failure, no_progress patterns). Path validation lives in `tools/core/path-safety.ts` and `sandbox/path-validation.ts`. The denylist (`rm -rf /`, `mkfs`, `dd`, fork bombs) lives in `approval/enhanced-approval.ts` as `alwaysDeny` patterns."

**Step 1.5 — Add a "Last Verified" header** to `CODE-MAP.md`:
```markdown
<!-- LAST_VERIFIED: 2026-08-01 against v0.3.0-phase2-studio -->
<!-- VERIFICATION_REPORT: goli-cli-verification-report.md -->
```

### Testing & Verification

- `npm run lint` passes (no broken markdown links)
- `grep -rn "11-agent\|10 event\|10 method\|23 core tool\|9 fragment\|5-layer compaction\|70% threshold\|17 config field\|755 line" docs/ AGENTS.md README.md` returns zero results
- New engineers can read `CODE-MAP.md` and successfully locate every described component in the codebase

### Rollback Plan

Pure documentation change — revert the git commit. No runtime risk.

### Effort Estimate

3 engineer-days (1 day to audit `CODE-MAP.md`, 1 day to rewrite brief, 1 day to fix all docs/README/package.json references).

### Dependencies

None. This phase can start immediately and should complete first to establish a stable baseline for subsequent code changes.

---

## Phase 2 — IAgentLoop Contract Hardening

**Goal:** Promote `CliAgentLoop`'s 5 de-facto methods onto a typed `ICliAgentLoop extends IAgentLoop` interface, eliminating the 4 `as any` casts in `useAgentLoop.ts`.

**Issues addressed:** P2-4; the "5 de-facto methods via `as any`" Info finding; enables Phases 9–13 (TUI phases that need typed access to `CliAgentLoop` methods).

### Problem Statement

`useAgentLoop.ts` accesses `setAppMode`, `shouldAskPermission`, `markAlwaysApproved`, `requestCompaction`, `requestApproval` via `as any` casts at lines 124, 151, 160, 484. These methods are real and used in production, but they're not on the `IAgentLoop` interface. This means: (a) TypeScript can't catch typos or signature changes; (b) `MockAgentLoop` doesn't have to implement them, so `--demo` mode silently lacks features; (c) future refactors might break the TUI without compile errors.

### Root Cause

The `IAgentLoop` interface was designed as the minimal contract for `--demo` mode parity. As `CliAgentLoop` grew, methods were added without updating the interface. The `as any` casts were a shortcut to avoid forcing `MockAgentLoop` to implement methods it doesn't need.

### Files to Modify

| File | Action |
|------|--------|
| `packages/cli/src/services/IAgentLoop.ts` | Add `ICliAgentLoop` interface extending `IAgentLoop` |
| `packages/cli/src/services/CliAgentLoop.ts` | Change `implements IAgentLoop` → `implements ICliAgentLoop` |
| `packages/cli/src/services/MockAgentLoop.ts` | Optionally add stub implementations for testing |
| `packages/cli/src/tui/hooks/useAgentLoop.ts` | Replace `as any` with `as ICliAgentLoop` |

### Implementation Steps

**Step 2.1 — Define `ICliAgentLoop`.** Add to `IAgentLoop.ts` after the existing interface (line 77):

```typescript
/**
 * Extended contract for the real CLI agent loop.
 * Adds methods that the TUI needs but MockAgentLoop doesn't implement.
 * MockAgentLoop implements only IAgentLoop; CliAgentLoop implements ICliAgentLoop.
 */
export interface ICliAgentLoop extends IAgentLoop {
  /** Switch the active AppMode mid-session (e.g., /mode build). */
  setAppMode(mode: AppMode): void;

  /** Check whether a tool call would require user approval in the current mode. */
  shouldAskPermission(toolName: string, args: unknown): boolean;

  /** Mark a permission as "always approved" for this session (user clicked [a]). */
  markAlwaysApproved(permissionId: string): void;

  /** Force-trigger context compaction (/compact command). */
  requestCompaction(): void;

  /** Request user approval for a tool call (pre-execution bridge). */
  requestApproval(req: ToolApprovalRequest): Promise<ToolApprovalDecision>;
}
```

**Step 2.2 — Update `CliAgentLoop`.** In `CliAgentLoop.ts:87`, change:
```typescript
// Before:
export class CliAgentLoop implements IAgentLoop {
// After:
export class CliAgentLoop implements ICliAgentLoop {
```

Verify all 5 methods already exist with matching signatures (they do, per the audit). If any signature differs, adjust the interface to match the implementation (the implementation is the source of truth).

**Step 2.3 — Replace `as any` casts in `useAgentLoop.ts`.** At lines 124, 151, 160, 484, change:
```typescript
// Before:
(loop as any).setAppMode(mode);
// After:
const cliLoop = loop as ICliAgentLoop;
if ('setAppMode' in cliLoop) {
  cliLoop.setAppMode(mode);
} else {
  // MockAgentLoop — mode switching not supported in --demo
  console.warn('setAppMode not available in demo mode');
}
```

For `requestCompaction` and `requestApproval`, the guard is important because `MockAgentLoop` won't have these methods. The `if ('method' in obj)` pattern is safer than `instanceof` because it works across the interface boundary.

**Step 2.4 — Add a type guard.** Add to `IAgentLoop.ts`:
```typescript
export function isCliAgentLoop(loop: IAgentLoop): loop is ICliAgentLoop {
  return 'setAppMode' in loop && 'requestCompaction' in loop;
}
```

Then in `useAgentLoop.ts`, replace the `as` casts with the type guard:
```typescript
if (isCliAgentLoop(loop)) {
  loop.setAppMode(mode);
}
```

### Testing & Verification

- `npm run typecheck` passes with zero errors
- `npm run lint` passes (no `as any` in `useAgentLoop.ts`)
- `npm test -- --grep "useAgentLoop"` passes
- `--demo` mode still works (MockAgentLoop is unaffected; the type guards prevent calling methods that don't exist)
- Manual test: run `goli --demo`, type a message, verify no "setAppMode not available" warnings appear (they should only appear if the user tries `/mode` in demo mode)

### Rollback Plan

Revert the 4 file changes. The `as any` casts were functional, so reverting restores the previous behavior.

### Effort Estimate

2 engineer-days (1 day to define interface + type guard, 1 day to replace all casts and test).

### Dependencies

Phase 1 (documentation) should complete first so the contract is documented accurately. Phases 9–13 (TUI fixes) depend on this phase because they need typed access to `CliAgentLoop` methods.

---

## Phase 3 — DiffReviewDialog Production Bridge (P0)

**Goal:** Wire the `diffEntry` field through `CliAgentLoop.bridgeRequestApproval` so that `DiffReviewDialog` displays actual diffs in production `build` mode, not just in `--demo` mode.

**Issues addressed:** P0-1; C29; checklist item #8 (partial → confirmed); restores the primary safety control against unwanted file modifications.

### Problem Statement

`CliAgentLoop.bridgeRequestApproval` (`CliAgentLoop.ts:146-170`) translates core's `ToolApprovalRequest` into a TUI `PendingPermission` but omits the `diffEntry` field. When `edit_file` or `write_file` triggers an approval request in real mode, the `DiffReviewDialog` cannot display the diff. The dialog only works in `--demo` mode where `MockAgentLoop` emits a `permission` event with `diffEntry` populated.

**Impact:** Users in `build` mode cannot visually review diffs before approving edits. This is the single highest-safety gap in the codebase.

### Root Cause

When `bridgeRequestApproval` was written, the `PendingPermission` type was defined without a `diffEntry` field. `MockAgentLoop` was written later (or independently) and added `diffEntry` to its `permission` event payload. The two paths were never reconciled.

### Files to Modify

| File | Action |
|------|--------|
| `packages/cli/src/tui/state/types.ts` | Verify `PendingPermission` has `diffEntry?` field; add if missing |
| `packages/cli/src/services/CliAgentLoop.ts` | Add `diffEntry: req.diffEntry` to `bridgeRequestApproval` |
| `packages/core/src/agent/loop.ts` | Verify `ToolApprovalRequest` populates `diffEntry` for edit/write tools |
| `packages/core/src/tools/core/edit-file.ts` | Verify diff computation is passed to approval request |
| `packages/core/src/tools/core/write-file.ts` | Verify diff computation is passed to approval request |
| `packages/cli/src/tui/components/DiffReviewDialog.tsx` | Verify it reads `diffEntry` from `PendingPermission` |

### Implementation Steps

**Step 3.1 — Verify the core side.** Read `packages/core/src/agent/loop.ts` around the `requestApproval` callback invocation (search for `requestApproval(`). Verify that when `edit_file` or `write_file` calls `requestApproval`, the `ToolApprovalRequest` object includes a `diffEntry` field with the computed diff.

If core does NOT populate `diffEntry`, that's a separate P0 fix in core:

```typescript
// In edit-file.ts, before calling requestApproval:
const diffEntry = computeDiff(oldContent, newContent, filePath);
const approvalReq: ToolApprovalRequest = {
  toolName: 'edit_file',
  args: { filePath, oldContent, newContent },
  tier: 1,
  blastRadius: computeBlastRadius(diffEntry),
  diffEntry,  // ← ADD THIS
  promptText: `Apply edit to ${filePath}?`,
};
```

**Step 3.2 — Verify the TUI type.** In `packages/cli/src/tui/state/types.ts`, check the `PendingPermission` type (around line 80). It should have:

```typescript
export interface PendingPermission {
  id: string;
  toolName: string;
  args: unknown;
  tier: 0 | 1 | 2 | 3;
  blastRadius?: number;
  promptText: string;
  diffEntry?: DiffEntry;  // ← VERIFY THIS EXISTS
}

export interface DiffEntry {
  filePath: string;
  oldContent: string;
  newContent: string;
  unifiedDiff: string;  // for display
}
```

If `diffEntry` is missing from `PendingPermission`, add it.

**Step 3.3 — Bridge the field.** In `CliAgentLoop.ts:155-163`, update `bridgeRequestApproval`:

```typescript
// Before (line 155-163):
const pending: PendingPermission = {
  id: req.permissionId,
  toolName: req.toolName,
  args: req.args,
  tier: req.tier,
  blastRadius: req.blastRadius,
  promptText: req.promptText,
};

// After:
const pending: PendingPermission = {
  id: req.permissionId,
  toolName: req.toolName,
  args: req.args,
  tier: req.tier,
  blastRadius: req.blastRadius,
  promptText: req.promptText,
  diffEntry: req.diffEntry,  // ← ADD THIS
};
```

**Step 3.4 — Verify DiffReviewDialog consumes it.** Read `DiffReviewDialog.tsx:38-92`. Verify it reads `permission.diffEntry` and renders the `unifiedDiff` field. If it reads from a different field name, align the names.

**Step 3.5 — Add integration test.** Create `tests/integration/diff-review-bridge.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { CliAgentLoop } from '../../packages/cli/src/services/CliAgentLoop';
import { DiffReviewDialog } from '../../packages/cli/src/tui/components/DiffReviewDialog';

describe('DiffReviewDialog production bridge', () => {
  it('displays diff when edit_file triggers approval in build mode', async () => {
    const loop = new CliAgentLoop({ mode: 'build' });
    // ... simulate edit_file approval request
    // ... verify DiffReviewDialog renders the diff
  });
});
```

### Testing & Verification

- `npm run typecheck` passes
- `npm test -- --grep "diff-review"` passes
- Manual test: run `goli` in `build` mode, ask the agent to edit a file, verify the `DiffReviewDialog` appears with the actual diff
- Manual test: run `goli --demo`, verify `--demo` mode still works (regression check)
- Verify the `[v]` (view diff) key in `PermissionDialog` now routes to `DiffReviewDialog` in production mode

### Rollback Plan

Revert the single-line addition (`diffEntry: req.diffEntry`). The previous behavior (no diff display) is restored.

### Effort Estimate

1 engineer-day (0.5 day to verify core + TUI types, 0.5 day to bridge + test). If core doesn't populate `diffEntry`, add 1 more day for the core fix.

### Dependencies

Phase 2 (contract hardening) should complete first so the `ICliAgentLoop` type is available for typed access in tests.

---

## Phase 4 — SymbolGraph Activation (P0)

**Goal:** Wire `indexWorkspace()` into `AgentLoop.run()` startup so the symbol graph is populated at runtime. Add a `goli index` CLI command for manual re-indexing. Add a file watcher for incremental updates.

**Issues addressed:** P0-2; C24; activates `findCallers`, `findCallees`, `findImports`, `findByFile` (currently return empty arrays); makes `HybridRetriever`'s graph traversal arm functional; highest-leverage fix per the report.

### Problem Statement

`context/symbol-graph/sqlite.ts:162-204` implements `indexWorkspace(rootDir)` which populates the symbol graph by walking the file tree and inserting symbols. Repo-wide ripgrep finds **zero callers** in production code. The function is exercised in unit tests but never invoked from `AgentLoop`, any CLI command, or any hook. **The SymbolGraph is always empty at runtime.**

**Impact:** All `SymbolGraph` query methods return empty arrays. The `HybridRetriever`'s graph traversal arm is functionally inert. The "code intelligence" subsystem is structurally present but provides zero value at runtime.

### Root Cause

The indexing subsystem was built (Phase 2 of development) but never wired into the runtime. The `AgentLoop.run()` startup sequence was finalized before indexing was ready, and the wiring was deferred. It was never picked up.

### Files to Modify

| File | Action |
|------|--------|
| `packages/core/src/agent/loop.ts` | Call `indexWorkspace()` in `run()` startup |
| `packages/core/src/context/symbol-graph/sqlite.ts` | Add incremental indexing methods |
| `packages/cli/src/commands/index.ts` | **New file** — `goli index` CLI command |
| `packages/cli/src/index.ts` | Register the `index` command |
| `packages/core/src/context/symbol-graph/watcher.ts` | **New file** — file watcher for incremental updates |
| `packages/core/package.json` | Add `chokidar` dependency |

### Implementation Steps

**Step 4.1 — Add the startup call.** In `packages/core/src/agent/loop.ts`, in the `run()` method (around line 231-258 where `AgentLoop` is constructed), add indexing after config load but before the first iteration:

```typescript
// In AgentLoop.run() or AgentLoop constructor, after config is loaded:
async function initializeSymbolGraph(state: ConversationState): Promise<void> {
  const symbolGraph = state.symbolGraph;
  if (!symbolGraph) return;

  // Check if already indexed (avoid re-indexing on every run)
  const indexedAt = await symbolGraph.getIndexedAt();
  const stats = await import('fs').then(fs => fs.statSync);
  
  // Re-index if never indexed, or if .goli/symbol-graph.cache is stale
  if (!indexedAt || Date.now() - indexedAt > 24 * 60 * 60 * 1000) {
    const logger = state.logger?.child({ component: 'symbol-graph' });
    logger?.info({ rootDir: state.cwd }, 'Indexing workspace symbols...');
    
    const startTime = Date.now();
    const stats = await symbolGraph.indexWorkspace(state.cwd);
    
    logger?.info({
      rootDir: state.cwd,
      durationMs: Date.now() - startTime,
      ...stats,
    }, 'Workspace indexing complete');
  }
}
```

Call this function at the start of `run()`, before the ReAct while-loop begins.

**Step 4.2 — Add `getIndexedAt()` to SymbolGraph.** In `sqlite.ts`, add:

```typescript
async getIndexedAt(): Promise<number | null> {
  const row = this.db.prepare(
    'SELECT value FROM metadata WHERE key = ?'
  ).get('indexed_at');
  return row ? parseInt(row.value, 10) : null;
}

async setIndexedAt(timestamp: number): Promise<void> {
  this.db.prepare(
    'INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)'
  ).run('indexed_at', String(timestamp));
}
```

Add a `metadata` table to the schema (in the `init()` method):
```sql
CREATE TABLE IF NOT EXISTS metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

Update `indexWorkspace()` to call `this.setIndexedAt(Date.now())` at the end.

**Step 4.3 — Add incremental indexing.** In `sqlite.ts`, add:

```typescript
async indexFile(filePath: string): Promise<void> {
  // Parse single file with tree-sitter, upsert symbols
  const symbols = await parseFileForSymbols(filePath);
  this.db.prepare('DELETE FROM symbols WHERE file_path = ?').run(filePath);
  for (const sym of symbols) {
    this.db.prepare(
      'INSERT INTO symbols (name, kind, file_path, line, col, ...) VALUES (?, ?, ?, ?, ?, ...)'
    ).run(sym.name, sym.kind, filePath, sym.line, sym.col, ...);
  }
}

async removeFile(filePath: string): Promise<void> {
  this.db.prepare('DELETE FROM symbols WHERE file_path = ?').run(filePath);
}
```

**Step 4.4 — Add file watcher.** Create `packages/core/src/context/symbol-graph/watcher.ts`:

```typescript
import chokidar from 'chokidar';
import type { SymbolGraph } from './sqlite';

export class SymbolGraphWatcher {
  private watcher: chokidar.FSWatcher | null = null;

  constructor(
    private readonly graph: SymbolGraph,
    private readonly rootDir: string,
    private readonly logger?: { info: (msg: unknown) => void },
  ) {}

  start(): void {
    this.watcher = chokidar.watch(
      [
        '**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx',
        '**/*.py', '**/*.go', '**/*.rs',
      ],
      {
        cwd: this.rootDir,
        ignored: ['node_modules/**', '.git/**', 'dist/**', 'build/**'],
        persistent: true,
        ignoreInitial: true,  // initial index done by indexWorkspace
      },
    );

    this.watcher.on('add', (path) => {
      this.logger?.info({ path, event: 'add' }, 'Re-indexing new file');
      this.graph.indexFile(path).catch(err => {
        this.logger?.info({ path, error: err.message }, 'Re-index failed');
      });
    });

    this.watcher.on('change', (path) => {
      this.graph.indexFile(path).catch(() => {});
    });

    this.watcher.on('unlink', (path) => {
      this.graph.removeFile(path).catch(() => {});
    });
  }

  async stop(): Promise<void> {
    await this.watcher?.close();
    this.watcher = null;
  }
}
```

Start the watcher in `AgentLoop.run()` after the initial indexing completes. Stop it in `AgentLoop.abort()` or when the loop exits.

**Step 4.5 — Add `goli index` CLI command.** Create `packages/cli/src/commands/index.ts`:

```typescript
import { Command } from 'commander';
import { loadConfig } from '@goli/core';
import { SymbolGraph } from '@goli/core/dist/context/symbol-graph/sqlite';

export const indexCommand = new Command('index')
  .description('Index workspace symbols for code intelligence')
  .option('-f, --force', 'Force re-index even if cache is fresh')
  .action(async (opts) => {
    const config = await loadConfig();
    const graph = new SymbolGraph(config.databasePath);
    await graph.init();
    
    if (opts.force) {
      await graph.clear();
    }
    
    const stats = await graph.indexWorkspace(process.cwd());
    console.log('Indexing complete:', stats);
    await graph.close();
  });
```

Register it in `packages/cli/src/index.ts`:
```typescript
import { indexCommand } from './commands/index';
program.addCommand(indexCommand);
```

### Testing & Verification

- `npm run typecheck` passes
- `npm test -- --grep "symbol-graph"` passes
- New test: `tests/integration/symbol-graph-runtime.test.ts` — verifies `indexWorkspace()` is called during `AgentLoop.run()`
- New test: `tests/unit/symbol-graph-watcher.test.ts` — verifies file watcher triggers incremental indexing
- Manual test: run `goli index` in the goli-cli repo itself, verify symbols are inserted
- Manual test: run `goli`, ask the agent "find callers of AgentLoop.run", verify non-empty results
- Performance check: indexing a 10K-file repo should complete in < 30 seconds

### Rollback Plan

Remove the `initializeSymbolGraph()` call from `AgentLoop.run()`. The symbol graph returns to empty-state behavior (no regression — it was already empty). The `goli index` command can remain as a manual tool.

### Effort Estimate

4 engineer-days (1 day for startup wiring + `getIndexedAt`, 1 day for incremental indexing, 1 day for file watcher, 1 day for CLI command + tests).

### Dependencies

None — this is self-contained. Phase 19 (SymbolGraph methods, ProjectMap caching) builds on this phase.

---

## Phase 5 — Mid-Session Policy Integrity (P0)

**Goal:** Detect mid-session modification of policy/config files by adding a file watcher and per-T1+-tool-call integrity verification.

**Issues addressed:** P0-3; C30; checklist item #18 (partial → confirmed); closes a SICA self-modification attack vector.

### Problem Statement

`verifyPolicyIntegrityAtStartup()` (`config/integrity.ts:24-58`) computes SHA-256 hashes of all policy/config files at session start and aborts on mismatch. However, no re-verification occurs mid-session. An attacker (or a buggy tool, or SICA itself) that modifies `approval/engine.ts`, `sandbox/executor.ts`, or `memory/sica/immutable-registry.ts` during a running session would not be detected.

**Impact:** The PolicyIntegrityManager's protection is bypassable by mid-session file modification. This is particularly dangerous for SICA self-improvement — SICA could theoretically modify its own guard code mid-session.

### Root Cause

The integrity check was designed as a startup gate (T-064 task). Mid-session verification was not implemented because the original threat model assumed policy files are immutable during a session. SICA's introduction (ADR-0030) changed this assumption — SICA can write to `memory/sica/` and potentially to adjacent directories.

### Files to Modify

| File | Action |
|------|--------|
| `packages/core/src/config/integrity.ts` | Add `verifyPolicyIntegrity()` (non-startup variant) + caching + file watcher |
| `packages/core/src/agent/loop.ts` | Call `verifyPolicyIntegrity()` before T1+ tool executions |
| `packages/core/src/approval/engine.ts` | Add integrity check in `decide()` for T1+ tiers |
| `packages/core/src/memory/sica/immutable-registry.ts` | Verify registry paths are covered by integrity check |

### Implementation Steps

**Step 5.1 — Refactor `integrity.ts`.** Split the existing function into a startup variant and a runtime variant:

```typescript
// config/integrity.ts

const HASH_CACHE_TTL_MS = 60_000;  // 60 seconds
let cachedHashes: Map<string, string> | null = null;
let cacheTimestamp = 0;

export async function verifyPolicyIntegrityAtStartup(): Promise<void> {
  cachedHashes = await computeAllHashes();
  cacheTimestamp = Date.now();
  // ... existing startup verification logic
}

export async function verifyPolicyIntegrity(): Promise<boolean> {
  // Use cache if fresh
  if (cachedHashes && Date.now() - cacheTimestamp < HASH_CACHE_TTL_MS) {
    const freshHashes = await computeAllHashes();
    for (const [path, hash] of freshHashes) {
      const cached = cachedHashes.get(path);
      if (cached !== hash) {
        return false;  // tampering detected
      }
    }
    cachedHashes = freshHashes;
    cacheTimestamp = Date.now();
    return true;
  }
  
  // Cache stale — recompute and compare to baseline
  const freshHashes = await computeAllHashes();
  const baseline = await loadBaselineHashes();
  for (const [path, hash] of freshHashes) {
    if (baseline.get(path) !== hash) {
      return false;
    }
  }
  cachedHashes = freshHashes;
  cacheTimestamp = Date.now();
  return true;
}

async function computeAllHashes(): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();
  const policyPaths = getPolicyFilePaths();  // existing helper
  for (const path of policyPaths) {
    const hash = await computeFileHash(path);
    hashes.set(path, hash);
  }
  return hashes;
}
```

**Step 5.2 — Add per-T1+-call verification.** In `approval/engine.ts`, in the `decide()` method (around line 168-221), add an integrity check for T1+ tiers:

```typescript
export async function decide(
  classification: ActionClassification,
  state: ConversationState,
): Promise<'allow' | 'ask' | 'deny'> {
  // Existing godMode check...
  
  // NEW: Verify policy integrity before approving T1+ actions
  if (classification.tier >= 1 && !state.godMode) {
    const integrityOk = await verifyPolicyIntegrity();
    if (!integrityOk) {
      state.logger?.error({
        tier: classification.tier,
        tool: classification.toolName,
      }, 'Policy integrity check failed — denying tool execution');
      return 'deny';
    }
  }
  
  // Existing decision matrix logic...
}
```

Note: The check is skipped in `godMode` for performance (god mode is already bypassing all checks) and skipped for T0 (read-only tools don't warrant the overhead).

**Step 5.3 — Add file watcher (belt-and-suspenders).** In addition to per-call verification, add a file watcher that aborts the session immediately on any policy file modification:

```typescript
// config/integrity.ts

import chokidar from 'chokidar';

let watcher: chokidar.FSWatcher | null = null;

export function startPolicyIntegrityWatcher(
  onViolation: (path: string) => void,
): void {
  if (watcher) return;
  
  const policyPaths = getPolicyFilePaths();
  const dirs = Array.from(new Set(policyPaths.map(p => path.dirname(p))));
  
  watcher = chokidar.watch(policyPaths, {
    persistent: true,
    ignoreInitial: true,
  });
  
  watcher.on('all', (event, filePath) => {
    if (event === 'change' || event === 'unlink') {
      onViolation(filePath);
    }
  });
}

export async function stopPolicyIntegrityWatcher(): Promise<void> {
  await watcher?.close();
  watcher = null;
}
```

In `AgentLoop.run()` startup:
```typescript
startPolicyIntegrityWatcher((filePath) => {
  state.logger?.fatal(
    { filePath },
    'Policy file modified mid-session — aborting',
  );
  // Emit an error event to the TUI
  this.emit({ kind: 'error', error: new PolicyIntegrityError(filePath) });
  this.abort();
});
```

**Step 5.4 — Verify SICA paths are covered.** Read `memory/sica/immutable-registry.ts:18-42`. Verify the protected paths (`sandbox/`, `tools/hooks/`, `approval/`, `memory/sica/`, `config/integrity.ts`, `memory/skills/`) are all included in `getPolicyFilePaths()`. If not, add them.

**Step 5.5 — Add audit log entry.** When integrity check fails, log to the audit log:
```typescript
await auditLog.append({
  timestamp: Date.now(),
  tool: '<integrity-check>',
  action: 'policy_integrity_violation',
  sandboxMode: 'n/a',
  approval: 'deny',
  tier: 3,
  ok: false,
  durationMs: 0,
  sessionId: state.sessionId,
  workspaceRoot: state.cwd,
});
```

### Testing & Verification

- `npm run typecheck` passes
- New test: `tests/unit/policy-integrity-mid-session.test.ts` — modify a policy file mid-test, verify the next T1+ tool call is denied
- New test: `tests/unit/policy-integrity-watcher.test.ts` — modify a policy file, verify the watcher fires and the session aborts
- Manual test: start `goli` in `build` mode, modify `approval/engine.ts` in another terminal, try to run an `edit_file` — verify it's denied with an integrity error
- Performance check: 1000 consecutive T1 tool calls should add < 5% overhead from integrity checks (the 60-second cache should make this negligible)

### Rollback Plan

Remove the `verifyPolicyIntegrity()` call from `decide()` and remove the watcher startup call. The startup-only check is restored.

### Effort Estimate

3 engineer-days (1 day for refactoring + caching, 1 day for per-call verification + watcher, 1 day for tests).

### Dependencies

None — this is self-contained. However, it should complete before Phase 7 (SkillWriter activation) because SkillWriter writes to `memory/skills/` which is a protected path.

---

## Phase 6 — L2 Skill Loader Activation (P0)

**Goal:** Wire `findMatchingSkills(userQuery)` and `loadL2Instructions(skillId)` into the system prompt assembly so L2 skill instructions are loaded on demand.

**Issues addressed:** P0-4a; C16; makes the L2 progressive disclosure layer functional; activates the "load full instructions on demand" mechanism.

### Problem Statement

`loader.ts:82-118` implements `loadL2Instructions(skillId)` which reads the full `SKILL.md` from disk. Repo-wide ripgrep finds **zero callers** in production code. L2 progressive disclosure is dead code. The skills subsystem only does L1 metadata injection — users cannot benefit from skill instructions beyond the metadata.

### Root Cause

The L2 loader was built but never wired into `system-prompt.ts`. The `assembleSystemPrompt()` function was written to include only L1 metadata (the `formatL1ForPrompt()` call at line 298), and the L2 on-demand loading was deferred.

### Files to Modify

| File | Action |
|------|--------|
| `packages/core/src/agent/system-prompt.ts` | Add L2 loading after L1 metadata |
| `packages/core/src/memory/skills/loader.ts` | Verify `findMatchingSkills()` and `loadL2Instructions()` are production-ready |
| `packages/core/src/agent/loop.ts` | Pass user query to prompt assembler |
| `tests/unit/l2-skill-loading.test.ts` | **New** — verify L2 loading on trigger match |

### Implementation Steps

**Step 6.1 — Verify the L2 API.** Read `loader.ts:82-118` and `catalog.ts` (the `findByTriggers` method). Confirm:

```typescript
// loader.ts
export async function loadL2Instructions(skillId: string): Promise<string | null> {
  const skill = await catalog.get(skillId);
  if (!skill) return null;
  const filePath = path.join(SKILLS_DIR, `${skillId}.md`);
  return await fs.readFile(filePath, 'utf-8');
}

// catalog.ts
export function findByTriggers(query: string): SkillMetadata[] {
  return allSkills.filter(s =>
    s.triggerKeywords.some(k => query.toLowerCase().includes(k.toLowerCase()))
  );
}
```

If these don't exist or have different signatures, fix them first.

**Step 6.2 — Add L2 loading to `system-prompt.ts`.** In `assembleSystemPrompt()` (around line 298 where L1 metadata is injected), add L2 loading:

```typescript
// Existing L1 injection (line ~298):
const l1Metadata = formatL1ForPrompt(skillCatalog.list());
fragments.push({ id: 'skills-l1', content: l1Metadata });

// NEW: L2 on-demand loading
const matchingSkills = skillCatalog.findByTriggers(state.userQuery);
for (const skill of matchingSkills.slice(0, 3)) {  // top 3 matches
  const l2Content = await loadL2Instructions(skill.id);
  if (l2Content) {
    fragments.push({
      id: `skill-l2-${skill.id}`,
      content: `## Skill: ${skill.name}\n\n${l2Content}`,
    });
    state.logger?.info(
      { skillId: skill.id, skillName: skill.name },
      'L2 skill instructions loaded on-demand',
    );
  }
}
```

**Step 6.3 — Pass user query to the assembler.** In `loop.ts`, verify `state.userQuery` is set before `assembleSystemPrompt()` is called. If not, add:

```typescript
// In run() or the first iteration:
state.userQuery = input.prompt;  // AgentRunInput.prompt
```

Update `ConversationState` type (`agent/types.ts`) to include `userQuery: string` if missing.

**Step 6.4 — Add L2 token budget.** To prevent L2 from consuming too much context, add a budget check:

```typescript
const L2_BUDGET_TOKENS = 4000;  // ~4K tokens for L2 skills
let l2TokensUsed = 0;

for (const skill of matchingSkills) {
  if (l2TokensUsed >= L2_BUDGET_TOKENS) break;
  
  const l2Content = await loadL2Instructions(skill.id);
  if (l2Content) {
    const tokens = estimateTokens(l2Content);
    if (l2TokensUsed + tokens > L2_BUDGET_TOKENS) {
      // Truncate to fit
      const truncated = truncateToTokens(l2Content, L2_BUDGET_TOKENS - l2TokensUsed);
      fragments.push({ id: `skill-l2-${skill.id}`, content: truncated });
      l2TokensUsed = L2_BUDGET_TOKENS;
    } else {
      fragments.push({ id: `skill-l2-${skill.id}`, content: l2Content });
      l2TokensUsed += tokens;
    }
  }
}
```

**Step 6.5 — Add test.** Create `tests/unit/l2-skill-loading.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { assembleSystemPrompt } from '../../packages/core/src/agent/system-prompt';

describe('L2 skill loading', () => {
  it('loads L2 instructions when user query matches a skill trigger', async () => {
    const state = makeTestState({ userQuery: 'help me refactor this function' });
    const prompt = await assembleSystemPrompt(state);
    
    // Verify the refactoring skill's L2 content is in the prompt
    expect(prompt).toContain('## Skill: Refactoring');
    expect(prompt).toContain('extract method');  // content from seeds.ts
  });
  
  it('does not load L2 when no triggers match', async () => {
    const state = makeTestState({ userQuery: 'what is the weather' });
    const prompt = await assembleSystemPrompt(state);
    
    expect(prompt).not.toContain('## Skill:');
  });
  
  it('respects L2 token budget', async () => {
    // Create 10 skills that all match the query
    // Verify only top 3 are loaded and total tokens < 4000
  });
});
```

### Testing & Verification

- `npm run typecheck` passes
- `npm test -- --grep "l2-skill"` passes
- Manual test: run `goli`, type "help me refactor this function", verify the refactoring skill's full instructions appear in the system prompt (check via debug mode or `goli doctor --show-prompt`)
- Manual test: type a query that doesn't match any skill, verify no L2 content is loaded
- Token budget check: verify total prompt size doesn't exceed `maxInputTokens` with L2 loaded

### Rollback Plan

Remove the L2 loading block from `system-prompt.ts`. L1 metadata injection continues to work.

### Effort Estimate

3 engineer-days (1 day for API verification + L2 loading, 1 day for token budget, 1 day for tests).

### Dependencies

Phase 1 (documentation) should complete first so the skill API is documented accurately. Phase 7 (SkillWriter activation) depends on this phase.

---

## Phase 7 — SkillWriter Activation & Version History (P0)

**Goal:** Wire `SkillWriter.extract(trajectory)` into the `done` event handler so skills are extracted from successful trajectories. Implement append-only version history so old skill versions are preserved.

**Issues addressed:** P0-4b; C17; C20; makes the "learn from successful trajectories" mechanism functional; preserves skill history.

### Problem Statement

`writer.ts:38-142` implements `SkillWriter.extract(trajectory)` which extracts a skill from a successful trajectory with ≥5 tool calls. Repo-wide ripgrep finds **zero callers** in production. Additionally, `writer.ts:108-134` **overwrites** the existing `SKILL.md` in place — there is no version history. The `version` field is incremented in YAML but the old body is lost.

### Root Cause

Same as Phase 6 — the SkillWriter was built but never wired. The overwrite behavior was a simplification; version history was deferred.

### Files to Modify

| File | Action |
|------|--------|
| `packages/core/src/memory/skills/writer.ts` | Implement append-only version history |
| `packages/cli/src/services/CliAgentLoop.ts` | Call `SkillWriter.extract()` on `done` event |
| `packages/core/src/memory/skills/catalog.ts` | Add `getVersionHistory(skillId)` method |
| `tests/unit/skill-writer-versioning.test.ts` | **New** — verify version history |

### Implementation Steps

**Step 7.1 — Implement version history in `writer.ts`.** Change the write logic from overwrite to versioned:

```typescript
// writer.ts

export async function extract(trajectory: Trajectory): Promise<SkillMetadata | null> {
  if (trajectory.toolCalls.length < 5) return null;
  if (!trajectory.success) return null;
  
  const skillId = generateSkillId(trajectory);
  const existing = await catalog.get(skillId);
  
  const newVersion = existing ? existing.version + 1 : 1;
  const content = await generateSkillContent(trajectory);
  
  // NEW: Archive old version before writing new one
  if (existing) {
    await archiveOldVersion(skillId, existing.version);
  }
  
  const metadata: SkillMetadata = {
    id: skillId,
    name: generateSkillName(trajectory),
    category: categorizeByToolPattern(trajectory),
    version: newVersion,
    triggers: extractTriggers(trajectory),
    disclosureLevel: 'L2',
    createdAt: existing?.createdAt ?? Date.now(),
    lastUsedAt: Date.now(),
  };
  
  // Write new version
  await writeSkillFile(skillId, metadata, content);
  await catalog.upsert(metadata);
  
  return metadata;
}

async function archiveOldVersion(skillId: string, version: number): Promise<void> {
  const currentPath = path.join(SKILLS_DIR, `${skillId}.md`);
  const archiveDir = path.join(SKILLS_DIR, 'archive', skillId);
  await fs.mkdir(archiveDir, { recursive: true });
  
  const archivePath = path.join(archiveDir, `v${version}-${Date.now()}.md`);
  await fs.copyFile(currentPath, archivePath);
  
  // Also archive in SICA's archive for traceability
  await sicaArchive.archive({
    type: 'skill-version',
    skillId,
    version,
    timestamp: Date.now(),
    archivedPath: archivePath,
  });
}
```

**Step 7.2 — Add `getVersionHistory()` to catalog.** In `catalog.ts`:

```typescript
export async function getVersionHistory(skillId: string): Promise<SkillArchiveEntry[]> {
  const archiveDir = path.join(SKILLS_DIR, 'archive', skillId);
  try {
    const files = await fs.readdir(archiveDir);
    const entries: SkillArchiveEntry[] = [];
    for (const file of files.sort().reverse()) {  // newest first
      const match = file.match(/^v(\d+)-(\d+)\.md$/);
      if (match) {
        entries.push({
          skillId,
          version: parseInt(match[1], 10),
          archivedAt: parseInt(match[2], 10),
          archivePath: path.join(archiveDir, file),
        });
      }
    }
    return entries;
  } catch (err: any) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}
```

**Step 7.3 — Wire extraction into `done` event.** In `CliAgentLoop.ts`, in the event handler for `done` (or in `tryRunStream` where `done` events are yielded):

```typescript
// In CliAgentLoop.ts, where 'done' events are handled:
private async handleTurnComplete(result: TurnResult, state: ConversationState): Promise<void> {
  // Existing logic (cost tracking, etc.)...
  
  // NEW: Extract skill from successful trajectory
  if (result.success && result.toolCalls.length >= 5) {
    try {
      const trajectory: Trajectory = {
        toolCalls: result.toolCalls,
        success: result.success,
        userQuery: state.userQuery,
        durationMs: result.durationMs,
      };
      
      const skill = await this.skillWriter.extract(trajectory);
      if (skill) {
        this.logger.info(
          { skillId: skill.id, skillName: skill.name, version: skill.version },
          'Skill extracted from trajectory',
        );
        
        // Emit a notification to the TUI
        this.emit({
          kind: 'phase',
          phase: 'skill-extracted',
          info: { skillId: skill.id, skillName: skill.name },
        });
      }
    } catch (err: any) {
      this.logger.warn(
        { error: err.message },
        'Skill extraction failed (non-fatal)',
      );
    }
  }
}
```

**Step 7.4 — Add SICA guard for SkillWriter.** Verify that `immutable-registry.ts` covers `memory/skills/` (it does per the audit). SkillWriter can write to `memory/skills/<id>.md` and `memory/skills/archive/`, but NOT to `memory/skills/seeds.ts` (protected). Add an explicit check in `writeSkillFile`:

```typescript
async function writeSkillFile(skillId: string, metadata: SkillMetadata, content: string): Promise<void> {
  const filePath = path.join(SKILLS_DIR, `${skillId}.md`);
  
  // Verify the path is not in the immutable registry
  if (await immutableRegistry.isProtected(filePath)) {
    throw new Error(`Cannot write to protected path: ${filePath}`);
  }
  
  // Verify path is within the skills directory (no traversal)
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(SKILLS_DIR))) {
    throw new Error(`Path traversal detected: ${filePath}`);
  }
  
  const yaml = formatYamlFrontmatter(metadata);
  await fs.writeFile(resolved, `${yaml}\n\n${content}`);
}
```

**Step 7.5 — Add tests.** Create `tests/unit/skill-writer-versioning.test.ts`:

```typescript
describe('SkillWriter version history', () => {
  it('archives old version before overwriting', async () => {
    // Create a skill v1
    // Extract again → should create v2 and archive v1
    // Verify archive file exists
    // Verify getVersionHistory returns [v2, v1]
  });
  
  it('preserves createdAt across versions', async () => {
    // Extract v1, record createdAt
    // Wait, extract v2
    // Verify v2.createdAt === v1.createdAt
  });
  
  it('refuses to write to protected paths', async () => {
    // Attempt to write to seeds.ts
    // Verify error is thrown
  });
});
```

### Testing & Verification

- `npm run typecheck` passes
- `npm test -- --grep "skill-writer"` passes
- `npm test -- --grep "version-history"` passes
- Manual test: run a 5+ tool-call session that succeeds, verify a skill is created
- Manual test: trigger the same trajectory pattern again, verify version increments from v1 to v2
- Manual test: check `memory/skills/archive/<id>/v1-<timestamp>.md` exists
- SICA guard test: attempt SICA self-edit on `memory/skills/seeds.ts`, verify it's blocked

### Rollback Plan

Remove the `handleTurnComplete` extraction call. Skill extraction stops, but existing skills remain. The version history code is additive — it doesn't break existing skills.

### Effort Estimate

3 engineer-days (1 day for version history, 1 day for wiring + SICA guard, 1 day for tests).

### Dependencies

Phase 6 (L2 Skill Loader) should complete first so the skill lifecycle is coherent. Phase 5 (Policy Integrity) should complete first so the SICA guard is active.

---

## Phase 8 — User-Facing Hook Registration (P0)

**Goal:** Add `goli hooks add/remove/list/enable/disable` CLI commands and a documented `.goli/hooks.json` schema so users can register custom pre/post hooks.

**Issues addressed:** P0-5; C28; checklist item #15 (not found → confirmed); makes the hooks subsystem user-facing.

### Problem Statement

The hooks subsystem (`tools/hooks/`) is fully implemented and 6 built-in hooks ship with the codebase (`block-secrets`, `block-writes-outside-workspace`, `block-destructive`, `git-checkpoint`, `auto-format`, `audit-log`). However, there is no `goli hooks add` command, no documented `.goli/hooks.json` schema, and no way for users to register custom hooks without editing source code.

### Root Cause

The hooks engine was built for internal use (the 6 built-in hooks). User-facing registration was deferred and never implemented.

### Files to Modify

| File | Action |
|------|--------|
| `packages/cli/src/commands/hooks.ts` | **New** — `goli hooks` command with subcommands |
| `packages/cli/src/index.ts` | Register the `hooks` command |
| `packages/core/src/tools/hooks/config.ts` | **New** — load `.goli/hooks.json` |
| `packages/core/src/tools/hooks/engine.ts` | Load user-defined hooks from config |
| `packages/core/src/tools/hooks/types.ts` | Add `UserHookConfig` type |
| `docs/user/how-to/custom-hooks.md` | **New** — documentation |

### Implementation Steps

**Step 8.1 — Define the config schema.** Create `packages/core/src/tools/hooks/config.ts`:

```typescript
import { z } from 'zod';

export const UserHookConfigSchema = z.object({
  hooks: z.array(z.object({
    name: z.string(),
    type: z.enum(['pre', 'post']),
    tool: z.string().or(z.literal('*')),  // tool name or wildcard
    action: z.enum(['block', 'modify', 'log']),
    condition: z.object({
      type: z.enum(['command-match', 'path-match', 'always']),
      pattern: z.string().optional(),
    }).optional(),
    message: z.string().optional(),  // shown to user when blocking
  })),
});

export type UserHookConfig = z.infer<typeof UserHookConfigSchema>;

export async function loadUserHooks(configPath: string): Promise<UserHookConfig> {
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    const parsed = JSON.parse(content);
    return UserHookConfigSchema.parse(parsed);
  } catch (err: any) {
    if (err.code === 'ENOENT') return { hooks: [] };
    throw new Error(`Invalid hook config at ${configPath}: ${err.message}`);
  }
}
```

**Step 8.2 — Load user hooks in the engine.** In `packages/core/src/tools/hooks/engine.ts`:

```typescript
import { loadUserHooks } from './config';

export class HookEngine {
  private userHooks: UserHookConfig['hooks'] = [];
  
  async init(configPath: string): Promise<void> {
    const config = await loadUserHooks(configPath);
    this.userHooks = config.hooks;
  }
  
  async runPreHooks(toolName: string, args: unknown): Promise<PreHookResult> {
    // Run built-in hooks (existing logic)...
    
    // Run user-defined hooks
    for (const hook of this.userHooks.filter(h => h.type === 'pre')) {
      if (hook.tool !== '*' && hook.tool !== toolName) continue;
      
      if (hook.condition && !this.matchesCondition(args, hook.condition)) continue;
      
      if (hook.action === 'block') {
        return {
          action: 'deny',
          reason: hook.message || `Blocked by user hook: ${hook.name}`,
        };
      }
      // ... handle 'modify' and 'log'
    }
    
    return { action: 'allow' };
  }
  
  private matchesCondition(args: unknown, condition: UserHookConfig['hooks'][0]['condition']): boolean {
    if (!condition) return true;
    if (condition.type === 'always') return true;
    
    const argsObj = args as Record<string, unknown>;
    if (condition.type === 'command-match' && typeof argsObj.command === 'string') {
      return new RegExp(condition.pattern || '').test(argsObj.command);
    }
    if (condition.type === 'path-match' && typeof argsObj.filePath === 'string') {
      return new RegExp(condition.pattern || '').test(argsObj.filePath);
    }
    return false;
  }
}
```

**Step 8.3 — Create the CLI command.** Create `packages/cli/src/commands/hooks.ts`:

```typescript
import { Command } from 'commander';
import { loadUserHooks, UserHookConfigSchema } from '@goli/core';
import { promises as fs } from 'fs';
import path from 'path';

const CONFIG_PATH = '.goli/hooks.json';

export const hooksCommand = new Command('hooks')
  .description('Manage user-defined tool hooks');

hooksCommand
  .command('list')
  .description('List all configured hooks')
  .action(async () => {
    const config = await loadUserHooks(CONFIG_PATH);
    if (config.hooks.length === 0) {
      console.log('No user hooks configured. Use "goli hooks add" to create one.');
      return;
    }
    for (const hook of config.hooks) {
      console.log(`  ${hook.name} [${hook.type}/${hook.tool}] → ${hook.action}`);
    }
  });

hooksCommand
  .command('add')
  .description('Add a new hook')
  .requiredOption('-n, --name <name>', 'Hook name')
  .requiredOption('-t, --type <type>', 'pre or post')
  .requiredOption('--tool <tool>', 'Tool name (or * for all)')
  .requiredOption('-a, --action <action>', 'block, modify, or log')
  .option('--condition-type <type>', 'command-match, path-match, or always')
  .option('--condition-pattern <pattern>', 'Regex pattern for condition')
  .option('-m, --message <message>', 'Message shown when blocking')
  .action(async (opts) => {
    const config = await loadUserHooks(CONFIG_PATH);
    
    const newHook = {
      name: opts.name,
      type: opts.type,
      tool: opts.tool,
      action: opts.action,
      condition: opts.conditionType ? {
        type: opts.conditionType,
        pattern: opts.conditionPattern,
      } : undefined,
      message: opts.message,
    };
    
    config.hooks.push(newHook);
    UserHookConfigSchema.parse(config);  // validate
    
    await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
    await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
    console.log(`Hook "${opts.name}" added to ${CONFIG_PATH}`);
  });

hooksCommand
  .command('remove <name>')
  .description('Remove a hook by name')
  .action(async (name) => {
    const config = await loadUserHooks(CONFIG_PATH);
    const before = config.hooks.length;
    config.hooks = config.hooks.filter(h => h.name !== name);
    if (config.hooks.length === before) {
      console.error(`Hook "${name}" not found`);
      process.exit(1);
    }
    await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
    console.log(`Hook "${name}" removed`);
  });

hooksCommand
  .command('enable <name>')
  .description('Enable a disabled hook')
  .action(async (name) => {
    // Toggle a `disabled: false` field
  });

hooksCommand
  .command('disable <name>')
  .description('Disable a hook without removing it')
  .action(async (name) => {
    // Toggle a `disabled: true` field
  });
```

**Step 8.4 — Register the command.** In `packages/cli/src/index.ts`:

```typescript
import { hooksCommand } from './commands/hooks';
program.addCommand(hooksCommand);
```

**Step 8.5 — Write documentation.** Create `docs/user/how-to/custom-hooks.md`:

````markdown
# Custom Hooks

Goli-CLI supports user-defined pre/post hooks that run before or after tool
executions. Hooks can block tools, modify arguments, or log actions.

## Configuration

Hooks are configured in `.goli/hooks.json`:

```json
{
  "hooks": [
    {
      "name": "block-npm-publish",
      "type": "pre",
      "tool": "bash",
      "action": "block",
      "condition": {
        "type": "command-match",
        "pattern": "npm publish"
      },
      "message": "npm publish is blocked by policy"
    }
  ]
}
```

## CLI Commands

- `goli hooks list` — list all configured hooks
- `goli hooks add --name <n> --type <pre|post> --tool <name|*> --action <block|modify|log> [options]`
- `goli hooks remove <name>` — remove a hook
- `goli hooks enable <name>` — enable a disabled hook
- `goli hooks disable <name>` — disable a hook without removing it

## Examples

### Block `npm publish`

```bash
goli hooks add \
  --name block-publish \
  --type pre \
  --tool bash \
  --action block \
  --condition-type command-match \
  --condition-pattern "npm publish" \
  --message "npm publish is blocked"
```

### Auto-format on write

```bash
goli hooks add \
  --name auto-format \
  --type post \
  --tool write_file \
  --action modify \
  --condition-type path-match \
  --condition-pattern "\\.ts$"
```
````

### Testing & Verification

- `npm run typecheck` passes
- `npm test -- --grep "hooks"` passes
- New test: `tests/unit/user-hooks-config.test.ts` — verify Zod schema validates/invalidates correctly
- New test: `tests/integration/user-hooks-blocking.test.ts` — add a blocking hook, verify tool is blocked
- Manual test: `goli hooks add --name test --type pre --tool bash --action block --condition-type command-match --condition-pattern "rm -rf" --message "blocked"`, then run `goli` and try to `rm -rf` something
- Manual test: `goli hooks list` shows the hook
- Manual test: `goli hooks remove test` removes it

### Rollback Plan

Remove the `hooks` command registration and the `loadUserHooks` call in `HookEngine.init()`. Built-in hooks continue to work.

### Effort Estimate

5 engineer-days (2 days for config schema + engine integration, 2 days for CLI command, 1 day for docs + tests).

### Dependencies

None — this is self-contained. Phase 15 (Zod migration) provides the Zod dependency.

---

## Phase 9 — Provenance Bridging to TUI (P1)

**Goal:** Add `source` and `timestamp` fields to the TUI `ToolCall` type and bridge them from core's `ProvenanceTracker`, then render them in `HistoryScroll`.

**Issues addressed:** P1-2; C27; checklist item #16 (not found → confirmed); makes provenance visible to users.

### Problem Statement

Core's `ProvenanceTracker` (`provenance.ts:38-92`) attaches `{ source, toolName, timestamp, sessionId, turn }` to every tool result. The TUI's `ToolCall` type (`state/types.ts:40-51`) lacks `source` and `timestamp` fields. The provenance data is computed but never displayed.

### Root Cause

The TUI `ToolCall` type was defined before `ProvenanceTracker` was introduced. The bridge in `CliAgentLoop` translates tool events but drops the provenance fields.

### Files to Modify

| File | Action |
|------|--------|
| `packages/cli/src/tui/state/types.ts` | Add `source?` and `timestamp?` to `ToolCall` |
| `packages/cli/src/services/CliAgentLoop.ts` | Bridge provenance fields in tool event translation |
| `packages/cli/src/tui/components/HistoryScroll.tsx` | Render source + timestamp next to tool calls |
| `packages/cli/src/tui/components/messages/ToolMessage.tsx` | Display provenance in tool message bubble |

### Implementation Steps

**Step 9.1 — Extend the TUI type.** In `packages/cli/src/tui/state/types.ts:40-51`:

```typescript
export interface ToolCall {
  id: string;
  toolName: string;
  args: unknown;
  result?: unknown;
  tier: 0 | 1 | 2 | 3;
  status: 'pending' | 'running' | 'done' | 'error';
  // NEW:
  source?: string;       // 'tool' | 'mcp' | 'subagent' | 'hook'
  timestamp?: number;    // Unix epoch ms
  sessionId?: string;
  turn?: number;
}
```

**Step 9.2 — Bridge in `CliAgentLoop`.** In the tool event translation (search for where `kind: 'tool'` events are constructed in `tryRunStream`), add the provenance fields:

```typescript
// In CliAgentLoop.ts, where tool events are emitted:
this.emit({
  kind: 'tool',
  tool: {
    id: toolCall.id,
    toolName: toolCall.name,
    args: toolCall.input,
    result: toolCall.output,
    tier: toolCall.tier,
    status: 'done',
    // NEW: bridge provenance from core
    source: toolCall.provenance?.source,
    timestamp: toolCall.provenance?.timestamp,
    sessionId: toolCall.provenance?.sessionId,
    turn: toolCall.provenance?.turn,
  },
});
```

Verify that core's `ToolCallEvent` (in `agent/types.ts`) includes the `provenance` field. If not, add it:

```typescript
// packages/core/src/agent/types.ts
export interface ToolCallEvent {
  id: string;
  name: string;
  input: unknown;
  output?: unknown;
  tier: 0 | 1 | 2 | 3;
  provenance?: {
    source: string;
    toolName: string;
    timestamp: number;
    sessionId: string;
    turn: number;
  };
}
```

**Step 9.3 — Render in `HistoryScroll`.** In `HistoryScroll.tsx:42-118`, update the tool call rendering:

```tsx
// In HistoryScroll.tsx, where each ToolCall is rendered:
<Text key={tool.id}>
  <Text color="cyan">▸ {tool.toolName}</Text>
  {tool.tier >= 1 && <Text color="yellow"> [T{tool.tier}]</Text>}
  {tool.source && (
    <Text color="gray" dimColor>
      {' '}({tool.source})
    </Text>
  )}
  {tool.timestamp && (
    <Text color="gray" dimColor>
      {' '}@ {new Date(tool.timestamp).toLocaleTimeString()}
    </Text>
  )}
</Text>
```

**Step 9.4 — Render in `ToolMessage`.** In `messages/ToolMessage.tsx`, add a provenance footer:

```tsx
// At the bottom of the tool message bubble:
{tool.source && tool.timestamp && (
  <Box marginTop={1}>
    <Text color="gray" dimColor>
      source: {tool.source} · turn {tool.turn ?? '?'} · {new Date(tool.timestamp).toISOString()}
    </Text>
  </Box>
)}
```

### Testing & Verification

- `npm run typecheck` passes
- `npm test -- --grep "provenance"` passes
- New test: `tests/unit/provenance-bridge.test.ts` — verify tool events include provenance fields
- Manual test: run `goli`, execute a tool call, verify the `HistoryScroll` shows `(tool) @ 14:23:05` next to the tool name
- Manual test: trigger an MCP tool call, verify the source shows `(mcp)` instead of `(tool)`

### Rollback Plan

Remove the `source`/`timestamp` fields from the TUI `ToolCall` type and the rendering code. The bridge in `CliAgentLoop` is additive — removing the TUI side reverts the display.

### Effort Estimate

2 engineer-days (1 day for types + bridge, 1 day for rendering + tests).

### Dependencies

Phase 2 (contract hardening) should complete first so `ICliAgentLoop` is available for typed access.

---

## Phase 10 — AgentStateBar 7-Phase Display (P1)

**Goal:** Upgrade `AgentStateBar` from a binary `busy: boolean` indicator to a 7-phase display that consumes core's `AgentPhase` model.

**Issues addressed:** P1-3; AgentStateBar partial warning; makes the TUI reflect the actual agent state.

### Problem Statement

The brief claims `AgentStateBar` shows `thinking / tool-calling / waiting-approval / done`. The actual component renders a binary `busy: boolean` indicator. Core's `AgentPhase` model (`agent/types.ts:42-58`) has 7 phases: `idle / thinking / tool-calling / waiting-approval / streaming / compacting / done`.

### Root Cause

`AgentStateBar` was written before the `AgentPhase` model was finalized. It was never updated to consume `phase` events.

### Files to Modify

| File | Action |
|------|--------|
| `packages/cli/src/tui/components/AgentStateBar.tsx` | Consume `phase` from `phase` events |
| `packages/cli/src/tui/state/types.ts` | Add `currentPhase` to `AppStateSnapshot` |
| `packages/cli/src/tui/state/AppStateStore.ts` | Update `currentPhase` on `phase` events |

### Implementation Steps

**Step 10.1 — Add `currentPhase` to state.** In `state/types.ts`:

```typescript
export interface AppStateSnapshot {
  // ... existing fields
  currentPhase: AgentPhase;  // NEW
}
```

In `AppStateStore.ts`, update the `phase` event handler:

```typescript
// In AppStateStore, where 'phase' events are handled:
case 'phase':
  this.state.currentPhase = event.phase;
  this.notify();
  break;
```

**Step 10.2 — Rewrite `AgentStateBar`.** In `AgentStateBar.tsx:24-58`:

```tsx
import React from 'react';
import { Text, Box } from 'ink';
import { useAppState } from '../state/useAppState';

const PHASE_CONFIG: Record<AgentPhase, { label: string; color: string; icon: string }> = {
  idle:               { label: 'Idle',              color: 'gray',   icon: '○' },
  thinking:           { label: 'Thinking',          color: 'cyan',   icon: '◐' },
  'tool-calling':     { label: 'Calling tool',      color: 'yellow', icon: '▶' },
  'waiting-approval': { label: 'Waiting approval',  color: 'magenta',icon: '⏸' },
  streaming:          { label: 'Streaming',         color: 'cyan',   icon: '∿' },
  compacting:         { label: 'Compacting',        color: 'blue',   icon: '⇄' },
  done:               { label: 'Done',              color: 'green',  icon: '✓' },
};

export function AgentStateBar() {
  const { currentPhase } = useAppState();
  const config = PHASE_CONFIG[currentPhase] ?? PHASE_CONFIG.idle;
  
  return (
    <Box>
      <Text color={config.color}>{config.icon} {config.label}</Text>
    </Box>
  );
}
```

### Testing & Verification

- `npm run typecheck` passes
- `npm test -- --grep "agent-state"` passes
- Manual test: run `goli`, type a message, observe the state bar cycling through `Thinking → Calling tool → Done`
- Manual test: trigger an `edit_file` in `build` mode, observe `Waiting approval` phase

### Rollback Plan

Revert `AgentStateBar.tsx` to the binary `busy` version. Remove `currentPhase` from state.

### Effort Estimate

2 engineer-days (1 day for state + component, 1 day for testing).

### Dependencies

Phase 2 (contract hardening) should complete first.

---

## Phase 11 — Compaction Event Emission (P1)

**Goal:** Emit a `compaction` event (or fold into `phase` events) so the TUI can display compaction activity to the user.

**Issues addressed:** P1-4; the "no compaction event emitted" finding; checklist item #11 (partial).

### Problem Statement

When `advanced-compression.ts` runs (7-phase compaction), no event is emitted to the TUI. The user has no visibility into when compaction occurred, what was summarized, what was evicted, or how much context was reclaimed.

### Root Cause

Compaction was implemented as an internal operation. Event emission was not added because the `AgentEvent` union didn't have a `compaction` kind, and folding it into `phase` was considered but never done.

### Files to Modify

| File | Action |
|------|--------|
| `packages/cli/src/services/IAgentLoop.ts` | Add `compaction` info to `phase` event payload |
| `packages/core/src/agent/advanced-compression.ts` | Emit a `phase: 'compacting'` event with info |
| `packages/core/src/agent/loop.ts` | Propagate the event |
| `packages/cli/src/tui/components/CompactionBanner.tsx` | **New** — display compaction info |
| `packages/cli/src/tui/App.tsx` | Render `CompactionBanner` |

### Implementation Steps

**Step 11.1 — Extend the `phase` event.** In `IAgentLoop.ts`, update the `phase` event type:

```typescript
export type AgentEvent =
  | { kind: 'phase'; phase: AgentPhase; info?: CompactionInfo }
  // ... other kinds
```

Add `CompactionInfo`:
```typescript
export interface CompactionInfo {
  triggeredBy: 'auto' | 'manual' | 'overflow';
  layersApplied: string[];  // ['snap', 'dedupe', 'summarize', 'freeze', 'evict']
  tokensBefore: number;
  tokensAfter: number;
  tokensReclaimed: number;
  durationMs: number;
  evictedTurns: number;
  summarizedTurns: number;
}
```

**Step 11.2 — Emit in `advanced-compression.ts`.** After compaction completes:

```typescript
// In advanced-compression.ts, at the end of the compaction function:
const info: CompactionInfo = {
  triggeredBy: trigger.reason,  // 'auto' | 'manual' | 'overflow'
  layersApplied: appliedLayers,
  tokensBefore: beforeTokens,
  tokensAfter: afterTokens,
  tokensReclaimed: beforeTokens - afterTokens,
  durationMs: Date.now() - startTime,
  evictedTurns: evictedCount,
  summarizedTurns: summarizedCount,
};

// Emit via callback
state.emitPhase?.('compacting', info);
```

**Step 11.3 — Create `CompactionBanner`.** New component:

```tsx
// packages/cli/src/tui/components/CompactionBanner.tsx
import React, { useState, useEffect } from 'react';
import { Text, Box } from 'ink';
import { useAppState } from '../state/useAppState';

export function CompactionBanner() {
  const { lastCompaction } = useAppState();
  const [visible, setVisible] = useState(false);
  
  useEffect(() => {
    if (lastCompaction) {
      setVisible(true);
      const timer = setTimeout(() => setVisible(false), 5000);  // show for 5s
      return () => clearTimeout(timer);
    }
  }, [lastCompaction]);
  
  if (!visible || !lastCompaction) return null;
  
  return (
    <Box borderStyle="round" borderColor="blue" paddingX={1}>
      <Text color="blue">⇄ Context compacted: </Text>
      <Text color="cyan">
        {lastCompaction.tokensBefore} → {lastCompaction.tokensAfter} tokens
      </Text>
      <Text color="green"> ({lastCompaction.tokensReclaimed} reclaimed)</Text>
      <Text color="gray"> · {lastCompaction.layersApplied.join(' → ')}</Text>
    </Box>
  );
}
```

**Step 11.4 — Render in `App.tsx`.** Add `<CompactionBanner />` near the top of the layout.

### Testing & Verification

- `npm run typecheck` passes
- Manual test: run a long session that triggers compaction, verify the banner appears
- Manual test: run `/compact`, verify the banner appears with `triggeredBy: 'manual'`

### Rollback Plan

Remove the `CompactionBanner` from `App.tsx`. The event emission is additive and harmless if unconsumed.

### Effort Estimate

2 engineer-days.

### Dependencies

Phase 2 (contract hardening).

---

## Phase 12 — Per-Model Cost Breakdown (P1)

**Goal:** Add a `perModelCosts: Map<string, number>` to `AppStateSnapshot` and render it in `CostBreakdownPanel`.

**Issues addressed:** P1-5; CostBreakdownPanel partial warning; helps users with multi-model routing.

### Problem Statement

`CostBreakdownPanel.tsx:22-48` renders a single `totalCostUsd` scalar. Users with multi-model routing cannot see which model consumed the budget.

### Files to Modify

| File | Action |
|------|--------|
| `packages/cli/src/tui/state/types.ts` | Add `perModelCosts` and `perModelTokens` |
| `packages/cli/src/services/CliAgentLoop.ts` | Accumulate per-model costs from `done` events |
| `packages/cli/src/tui/components/CostBreakdownPanel.tsx` | Render per-model breakdown |

### Implementation Steps

**Step 12.1 — Extend state.** In `state/types.ts`:

```typescript
export interface AppStateSnapshot {
  // ... existing
  totalCostUsd: number;
  perModelCosts: Record<string, number>;    // NEW
  perModelTokens: Record<string, { input: number; output: number }>;  // NEW
}
```

**Step 12.2 — Accumulate in `CliAgentLoop`.** On `done` events:

```typescript
case 'done':
  const model = result.modelSpec?.id ?? 'unknown';
  this.state.perModelCosts[model] = (this.state.perModelCosts[model] ?? 0) + result.costUsd;
  this.state.perModelTokens[model] = {
    input: (this.state.perModelTokens[model]?.input ?? 0) + result.inputTokens,
    output: (this.state.perModelTokens[model]?.output ?? 0) + result.outputTokens,
  };
  break;
```

**Step 12.3 — Render in `CostBreakdownPanel`.** Update the component to show a small table:

```tsx
// CostBreakdownPanel.tsx
{Object.keys(perModelCosts).length > 1 && (
  <Box flexDirection="column" marginTop={1}>
    <Text color="gray" underline>Per-model breakdown:</Text>
    {Object.entries(perModelCosts).map(([model, cost]) => (
      <Text key={model}>
        {'  '}{model}: ${cost.toFixed(4)}{' '}
        <Text color="gray">({perModelTokens[model]?.input ?? 0} in / {perModelTokens[model]?.output ?? 0} out)</Text>
      </Text>
    ))}
  </Box>
)}
```

### Testing & Verification

- Manual test: use `--effort max` (which routes to multiple models), verify the breakdown shows multiple entries
- Verify `totalCostUsd` equals the sum of `perModelCosts` values

### Rollback Plan

Remove the per-model rendering. The state fields are additive.

### Effort Estimate

2 engineer-days.

### Dependencies

Phase 2 (contract hardening).

---

## Phase 13 — TokenBar Thinking Tokens & Tool Call Dedup (P1)

**Goal:** Add thinking-token display to `TokenBar`, split input/output bars, and fix tool-call deduplication to use argument hashing (not just `toolCallId`).

**Issues addressed:** TokenBar partial warning; common failure mode "tool call appears twice" (dedup by `toolCallId` only).

### Problem Statement

`TokenBar.tsx:18-42` renders a single bar for `totalInputTokens + totalOutputTokens`. Thinking tokens are not displayed, and input/output are summed. Additionally, `parallel-execution.ts` deduplicates by `toolCallId` only, so two tool calls with identical args but different IDs can both execute.

### Files to Modify

| File | Action |
|------|--------|
| `packages/cli/src/tui/components/TokenBar.tsx` | Render 3 bars: input, output, thinking |
| `packages/core/src/tools/parallel-execution.ts` | Add arg-hash dedup |

### Implementation Steps

**Step 13.1 — Extend `TokenBar`.** Render 3 stacked bars:

```tsx
// TokenBar.tsx
<Box flexDirection="column">
  <Text color="cyan">in  [{bar(inputTokens, maxInput)}] {inputTokens}/{maxInput}</Text>
  <Text color="yellow">out [{bar(outputTokens, maxOutput)}] {outputTokens}/{maxOutput}</Text>
  <Text color="magenta">thnk[{bar(thinkingTokens, maxThinking)}] {thinkingTokens}/{maxThinking}</Text>
</Box>
```

Add `thinkingTokens`, `maxThinkingTokens` to `AppStateSnapshot` if missing.

**Step 13.2 — Fix dedup.** In `parallel-execution.ts:48-62`, add arg-hash dedup:

```typescript
// Before executing a batch of tool calls, dedup by arg hash
const seen = new Set<string>();
const deduped = calls.filter(c => {
  const hash = `${c.name}:${stableStringify(c.input)}`;
  if (seen.has(hash)) {
    logger.warn({ tool: c.name, args: c.input }, 'Duplicate tool call detected, skipping');
    return false;
  }
  seen.add(hash);
  return true;
});
```

### Testing & Verification

- Manual test: verify TokenBar shows 3 bars
- New test: `tests/unit/parallel-dedup.test.ts` — submit 2 identical tool calls, verify only 1 executes

### Rollback Plan

Revert TokenBar to single bar. Remove the dedup filter.

### Effort Estimate

2 engineer-days.

### Dependencies

Phase 2.

---

## Phase 14 — Agent Swarm Count Correction (P1)

**Goal:** Correct all "11-agent swarm" references to "8-agent" or extend the `AGENTS` array to 11 entries.

**Issues addressed:** P1-1; C26; consistency across codebase.

### Problem Statement

The brief, README, package.json description, and `PipelineTrace.tsx` all reference an "11-agent swarm." The actual `AGENTS` array at `theme/agents.ts:83-92` has 8 entries.

### Decision Point

Two options:
- **Option A (recommended):** Update all references to "8-agent"
- **Option B:** Extend `AGENTS` to 11 entries (add 3 roles, e.g., `SecurityAuditor`, `PerformanceEngineer`, `DevOpsEngineer`)

### Files to Modify (Option A)

| File | Change |
|------|--------|
| `README.md` | "11-agent" → "8-agent" |
| `package.json` description | Same |
| `AGENTS.md` | Same |
| `docs/design/*.md` | Same |
| `PipelineTrace.tsx` | Update label if it says "11 agents" |

### Implementation Steps

1. `grep -rn "11-agent\|11 agent" .` to find all references
2. Replace each with "8-agent" (or "8 agent")
3. Verify `AGENTS.length === 8` matches the documentation

If Option B is chosen:
1. Add 3 new agent entries to `theme/agents.ts`
2. Define their roles, colors, icons
3. Update `PipelineTrace.tsx` to render all 11
4. Add tests for the new agents

### Testing & Verification

- `grep -rn "11-agent\|11 agent" .` returns zero results (Option A)
- `npm test` passes

### Rollback Plan

Revert the text changes.

### Effort Estimate

1 engineer-day (Option A) or 3 days (Option B).

### Dependencies

None.

---

## Phase 15 — Zod Schema Migration (P1)

**Goal:** Replace the hand-rolled schema validator with Zod, and add Zod validation for `SkillCategory`.

**Issues addressed:** schema-validator Zod warning; SkillCategory Zod warning; modernizes validation.

### Problem Statement

`schema-validator.ts:1-12` header explicitly states: "Hand-rolled AJV-style validator; AJV dependency is Phase 6 future work." `SkillCategory` is a plain TS union with no runtime validation.

### Files to Modify

| File | Action |
|------|--------|
| `packages/core/src/tools/schema-validator.ts` | Replace with Zod-based validator |
| `packages/core/src/memory/skills/types.ts` | Add Zod schema for `SkillCategory` |
| `packages/core/src/memory/skills/catalog.ts` | Validate skill files on load |
| `packages/core/package.json` | Add `zod` dependency |

### Implementation Steps

**Step 15.1 — Install Zod.** `cd packages/core && npm install zod`

**Step 15.2 — Rewrite schema-validator.** Replace the hand-rolled logic with Zod:

```typescript
// schema-validator.ts
import { z, ZodSchema } from 'zod';

export function validateToolInput(toolName: string, input: unknown, schema: ZodSchema): {
  ok: boolean;
  errors: string[];
} {
  const result = schema.safeParse(input);
  if (result.success) {
    return { ok: true, errors: [] };
  }
  return {
    ok: false,
    errors: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
  };
}
```

Each tool definition should export a Zod schema for its input. Update `tools/core/*.ts` to add `inputSchema: z.object({...})`.

**Step 15.3 — Add Zod for SkillCategory.** In `memory/skills/types.ts`:

```typescript
import { z } from 'zod';

export const SkillCategorySchema = z.enum([
  'refactoring', 'testing', 'debugging', 'code-review',
  'documentation', 'workflow', 'security',
]);
export type SkillCategory = z.infer<typeof SkillCategorySchema>;

export const SkillMetadataSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: SkillCategorySchema,
  version: z.number().int().positive(),
  triggers: z.array(z.string()),
  disclosureLevel: z.enum(['L1', 'L2', 'L3']),
  createdAt: z.number(),
  lastUsedAt: z.number(),
});
```

**Step 15.4 — Validate on load.** In `catalog.ts`, when parsing YAML frontmatter:

```typescript
const parsed = yaml.parse(frontmatter);
const result = SkillMetadataSchema.safeParse(parsed);
if (!result.success) {
  throw new Error(`Invalid skill metadata in ${filePath}: ${result.error.message}`);
}
```

### Testing & Verification

- `npm run typecheck` passes
- `npm test -- --grep "schema-validator"` passes
- New test: `tests/unit/skill-zod-validation.test.ts` — load a skill with `category: "potato"`, verify it fails

### Rollback Plan

Revert to hand-rolled validator. Zod dependency can remain.

### Effort Estimate

3 engineer-days (1 day for schema-validator rewrite, 1 day for tool schemas, 1 day for skill Zod + tests).

### Dependencies

None. Phase 8 (hooks) benefits from Zod being available.

---

## Phase 16 — Mode-Based Skill Filtering & L1 Budget (P1)

**Goal:** Implement mode-based skill category filtering and L1 token budget enforcement with top-K ranking.

**Issues addressed:** C18; C19; common failure mode "skill never loads."

### Problem Statement

`types.ts:24-27` JSDoc documents mode-based filtering intent, but no code enforces it. `formatL1ForPrompt()` returns all skills unranked — no L1 budget enforcement.

### Files to Modify

| File | Action |
|------|--------|
| `packages/core/src/memory/skills/catalog.ts` | Add `listForMode(mode)` method |
| `packages/core/src/memory/skills/loader.ts` | Add `getL1TokenEstimate()` and top-K ranking |
| `packages/core/src/agent/system-prompt.ts` | Use `listForMode()` and ranked L1 |

### Implementation Steps

**Step 16.1 — Add mode filtering.** In `catalog.ts`:

```typescript
const MODE_CATEGORIES: Record<AppMode, SkillCategory[]> = {
  'read-only':   ['code-review', 'documentation'],
  'plan':        ['code-review', 'documentation', 'refactoring'],
  'build':       ['refactoring', 'testing', 'debugging', 'code-review', 'documentation', 'workflow', 'security'],
  'god':         ['refactoring', 'testing', 'debugging', 'code-review', 'documentation', 'workflow', 'security'],
  'local-llms':  ['refactoring', 'testing', 'debugging', 'code-review', 'documentation', 'workflow', 'security'],
};

export function listForMode(mode: AppMode): SkillMetadata[] {
  const allowed = MODE_CATEGORIES[mode];
  return this.list().filter(s => allowed.includes(s.category));
}
```

**Step 16.2 — Add L1 budget.** In `loader.ts`:

```typescript
export function getL1TokenEstimate(skills: SkillMetadata[]): number {
  return skills.length * 100;  // ~100 tokens per skill
}

export function rankAndTruncateL1(skills: SkillMetadata[], query: string, budget: number): SkillMetadata[] {
  // Rank by trigger relevance
  const ranked = skills.map(s => ({
    skill: s,
    score: s.triggerKeywords.filter(k => query.toLowerCase().includes(k.toLowerCase())).length,
  })).sort((a, b) => b.score - a.score);
  
  // Keep top-K within budget
  const result: SkillMetadata[] = [];
  let tokens = 0;
  for (const { skill } of ranked) {
    if (tokens + 100 > budget) break;
    result.push(skill);
    tokens += 100;
  }
  return result;
}
```

**Step 16.3 — Use in `system-prompt.ts`:**

```typescript
const modeSkills = skillCatalog.listForMode(state.mode);
const budget = MEMORY_BUDGETS.SKILLS_L1;
const l1Skills = rankAndTruncateL1(modeSkills, state.userQuery, budget);
const l1Metadata = formatL1ForPrompt(l1Skills);
```

### Testing & Verification

- New test: `tests/unit/skill-mode-filtering.test.ts` — verify `read-only` mode only returns `code-review` + `documentation` skills
- New test: `tests/unit/l1-budget.test.ts` — create 20 skills, verify only top-K (within budget) are included

### Rollback Plan

Remove the `listForMode` and `rankAndTruncateL1` calls. Revert to `list()` + `formatL1ForPrompt(allSkills)`.

### Effort Estimate

3 engineer-days.

### Dependencies

Phase 6 (L2 Skill Loader) should complete first. Phase 15 (Zod) provides the validation.

---

## Phase 17 — LoopDetector Cycles & JsonRepair Streaming (P1)

**Goal:** Implement A→B→A→B cycle detection in `LoopDetector` and per-delta `JsonRepair` on streaming output.

**Issues addressed:** C4; C5; C6 (evict by relevance, optional).

### Problem Statement

`LoopDetector` only detects consecutive identical calls, not alternating cycles (A→B→A→B). `JsonRepair` runs post-response only, not on streaming deltas — malformed JSON during streaming causes parse failures.

### Files to Modify

| File | Action |
|------|--------|
| `packages/core/src/agent/loop-detector.ts` | Add cycle detection (Lloyd's algorithm or sliding window) |
| `packages/core/src/agent/json-repair.ts` | Add `repairStreamingDelta(delta: string): string` |
| `packages/core/src/agent/loop.ts` | Call `repairStreamingDelta` on each delta |

### Implementation Steps

**Step 17.1 — Cycle detection.** In `loop-detector.ts`:

```typescript
export class LoopDetector {
  private history: string[] = [];  // tool call signatures
  private readonly windowSize = 10;
  
  record(toolCall: ToolCall): void {
    const sig = `${toolCall.name}:${stableStringify(toolCall.input)}`;
    this.history.push(sig);
    if (this.history.length > this.windowSize) {
      this.history.shift();
    }
  }
  
  isCycling(): boolean {
    const h = this.history;
    if (h.length < 4) return false;
    
    // Check for cycles of length 2 (A→B→A→B)
    for (let cycleLen = 2; cycleLen <= 4; cycleLen++) {
      if (h.length < cycleLen * 2) continue;
      const recent = h.slice(-cycleLen);
      const previous = h.slice(-cycleLen * 2, -cycleLen);
      if (recent.every((v, i) => v === previous[i])) {
        return true;  // cycle detected
      }
    }
    return false;
  }
}
```

**Step 17.2 — Streaming JsonRepair.** In `json-repair.ts`:

```typescript
export function repairStreamingDelta(delta: string, accumulated: string): {
  repaired: string;
  newAccumulated: string;
} {
  const combined = accumulated + delta;
  
  // Try to parse as complete JSON
  try {
    JSON.parse(combined);
    return { repaired: combined, newAccumulated: '' };
  } catch {
    // Try to repair
    const repaired = repairJson(combined);
    try {
      JSON.parse(repaired);
      return { repaired, newAccumulated: '' };
    } catch {
      // Still incomplete — return nothing, keep accumulating
      return { repaired: '', newAccumulated: combined };
    }
  }
}
```

In `loop.ts`, call this on each delta:

```typescript
for await (const delta of stream) {
  const { repaired, newAccumulated } = repairStreamingDelta(delta, jsonAccumulator);
  jsonAccumulator = newAccumulated;
  if (repaired) {
    // Process the repaired JSON
  }
}
```

### Testing & Verification

- New test: `tests/unit/loop-detector-cycles.test.ts` — submit A→B→A→B sequence, verify `isCycling()` returns true
- New test: `tests/unit/json-repair-streaming.test.ts` — feed partial JSON deltas, verify repair

### Rollback Plan

Revert `loop-detector.ts` to consecutive-only detection. Remove `repairStreamingDelta` calls from `loop.ts`.

### Effort Estimate

4 engineer-days (2 days for cycle detection algorithm, 2 days for streaming repair + tests).

### Dependencies

None.

---

## Phase 18 — Dead Code Removal & Reflexion Wiring (P2)

**Goal:** Remove dead code (`prompt-builder.ts`, `callback-streaming.ts`, `seed.ts` duplicate) and wire `reflexion.ts` into the agent loop.

**Issues addressed:** Info findings: `prompt-builder.ts` dead, `callback-streaming.ts` unused, `reflexion.ts` unwired, `seed.ts` + `seeds.ts` duplicate.

### Problem Statement

`prompt-builder.ts` (485 lines) is dead code. `callback-streaming.ts` (428 lines) is unused in production. `seed.ts` duplicates `seeds.ts`. `reflexion.ts` is referenced by `system-prompt.ts:298` but never invoked.

### Files to Modify

| File | Action |
|------|--------|
| `packages/core/src/agent/prompt-builder.ts` | **Delete** |
| `packages/core/src/agent/callback-streaming.ts` | **Delete** (or mark as H9 future work with a clear comment) |
| `packages/core/src/memory/skills/seed.ts` | **Delete** (use `seeds.ts` only) |
| `packages/core/src/agent/reflexion.ts` | Wire into `loop.ts` |
| `packages/core/src/agent/loop.ts` | Call `ReflexionEngine` after tool failures |

### Implementation Steps

**Step 18.1 — Delete dead code.**

```bash
rm packages/core/src/agent/prompt-builder.ts
rm packages/core/src/agent/callback-streaming.ts
rm packages/core/src/memory/skills/seed.ts
```

Update any imports that reference these files (there should be none, but verify with `grep`).

**Step 18.2 — Wire Reflexion.** In `loop.ts`, after a tool failure:

```typescript
// After a tool call fails:
if (!toolResult.ok) {
  const reflexionNote = await this.reflexionEngine.recordFailure({
    toolName: toolCall.name,
    args: toolCall.input,
    error: toolResult.error,
    turn: state.turn,
  });
  
  if (reflexionNote) {
    state.reflexionNotes.push(reflexionNote);
    // These will be injected into the next system prompt via the existing
    // 'reflexion notes' fragment in system-prompt.ts:298
  }
}
```

Verify `ReflexionEngine.recordFailure()` exists in `reflexion.ts`. If not, implement it:

```typescript
export class ReflexionEngine {
  private notes: ReflexionNote[] = [];
  
  async recordFailure(failure: ToolFailure): Promise<ReflexionNote | null> {
    const note: ReflexionNote = {
      id: `reflexion-${Date.now()}`,
      toolName: failure.toolName,
      error: failure.error,
      lesson: await this.generateLesson(failure),  // LLM call
      timestamp: Date.now(),
    };
    this.notes.push(note);
    return note;
  }
  
  getNotes(): ReflexionNote[] {
    return this.notes.slice(-5);  // last 5 notes
  }
}
```

### Testing & Verification

- `npm run typecheck` passes (no broken imports)
- `npm test` passes
- `grep -rn "prompt-builder\|callback-streaming\|memory/skills/seed'" packages/` returns zero results
- Manual test: trigger a tool failure, verify reflexion notes appear in the next system prompt

### Rollback Plan

Restore deleted files from git. Remove the Reflexion wiring.

### Effort Estimate

2 engineer-days (0.5 days for deletions, 1.5 days for Reflexion wiring + tests).

### Dependencies

Phase 6 (L2 Skill Loader) should complete first so `seed.ts` deletion doesn't conflict.

---

## Phase 19 — Native Landlock, cgroups IO, Code Intel Completeness (P1)

**Goal:** Implement native Linux Landlock syscalls (replacing the bubblewrap stub), add cgroups IO limits, add missing SymbolGraph methods (`findDefinitions`, `findSimilar`, `findCallPath`), add ProjectMap caching with chokidar, and add multi-language LSP support.

**Issues addressed:** C12; cgroups IO warning; C22; C23; C25.

### Problem Statement

1. Linux sandbox uses bubblewrap instead of native Landlock (brief claims Landlock).
2. cgroups don't enforce IO limits.
3. SymbolGraph is missing `findDefinitions`, `findSimilar`, `findCallPath`.
4. `ProjectMapGenerator` is stateless (no caching, no watcher).
5. LSP is TypeScript-only.

### Files to Modify

| File | Action |
|------|--------|
| `packages/core/src/sandbox/landlock.ts` | Implement native Landlock syscalls |
| `packages/core/src/sandbox/cgroups.ts` | Add `io.max` controller |
| `packages/core/src/context/symbol-graph/sqlite.ts` | Add `findDefinitions`, `findSimilar`, `findCallPath` |
| `packages/core/src/context/project-map.ts` | Add caching + chokidar watcher |
| `packages/core/src/tools/core/python-lsp-client.ts` | **New** — Python LSP client |
| `packages/core/src/tools/core/rust-lsp-client.ts` | **New** — Rust LSP client |
| `packages/core/src/tools/core/lsp-tools.ts` | Route to correct LSP client by file extension |

### Implementation Steps

**Step 19.1 — Native Landlock.** Use the `landlock` npm package or call syscalls directly via `ffi-napi`:

```typescript
// landlock.ts
import { landlock_create_ruleset, landlock_add_rule, landlock_restrict_self } from 'landlock-syscalls';
import { prctl, PR_SET_NO_NEW_PRIVS } from 'prctl-syscalls';

export function applyLandlock(workspaceRoot: string): void {
  const ruleset = {
    handled_access_fs: [
      'LANDLOCK_ACCESS_FS_READ_FILE',
      'LANDLOCK_ACCESS_FS_WRITE_FILE',
      'LANDLOCK_ACCESS_FS_READ_DIR',
      'LANDLOCK_ACCESS_FS_EXECUTE',
    ],
  };
  
  const fd = landlock_create_ruleset(ruleset, 0);
  
  // Allow workspace
  landlock_add_rule(fd, 'LANDLOCK_RULE_PATH_BENEATH', {
    allowed_access: ruleset.handled_access_fs,
    parent_fd: open(workspaceRoot, O_PATH),
  });
  
  // Allow /usr, /lib, /bin (read-only)
  landlock_add_rule(fd, 'LANDLOCK_RULE_PATH_BENEATH', {
    allowed_access: ['LANDLOCK_ACCESS_FS_READ_FILE', 'LANDLOCK_ACCESS_FS_READ_DIR'],
    parent_fd: open('/usr', O_PATH),
  });
  
  prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0);
  landlock_restrict_self(fd);
  close(fd);
}
```

**Step 19.2 — cgroups IO.** In `cgroups.ts`:

```typescript
export async function setIoLimit(cgroupPath: string, device: string, limits: { rbps?: number; wbps?: number }): Promise<void> {
  const ioMax = `${device} rbps=${limits.rbps ?? 'max'} wbps=${limits.wbps ?? 'max'}`;
  await fs.writeFile(path.join(cgroupPath, 'io.max'), ioMax);
}
```

**Step 19.3 — SymbolGraph methods.** In `sqlite.ts`:

```typescript
async findDefinitions(symbolName: string): Promise<Symbol[]> {
  // Definitions are symbols with kind 'function', 'class', 'method', etc.
  return this.db.prepare(
    `SELECT * FROM symbols WHERE name = ? AND kind IN ('function', 'class', 'method', 'interface', 'type')`
  ).all(symbolName);
}

async findSimilar(symbolName: string, limit = 10): Promise<Symbol[]> {
  // Levenshtein distance via SQLite custom function or fuzzy matching
  return this.db.prepare(
    `SELECT *, levenshtein(name, ?) as dist FROM symbols 
     WHERE dist < 3 ORDER BY dist LIMIT ?`
  ).all(symbolName, limit);
}

async findCallPath(fromSymbol: string, toSymbol: string): Promise<Symbol[][]> {
  // BFS/DFS over the call graph
  const visited = new Set<string>();
  const paths: Symbol[][] = [];
  
  const bfs = (current: string, path: Symbol[]): void => {
    if (current === toSymbol) {
      paths.push([...path]);
      return;
    }
    if (visited.has(current) || path.length > 10) return;
    visited.add(current);
    
    const callees = this.findCallees(current);
    for (const callee of callees) {
      bfs(callee.name, [...path, callee]);
    }
  };
  
  bfs(fromSymbol, []);
  return paths;
}
```

Register the `levenshtein` function with `better-sqlite3`:

```typescript
this.db.function('levenshtein', (a: string, b: string) => {
  // Standard Levenshtein distance implementation
  // ...
});
```

**Step 19.4 — ProjectMap caching.** In `project-map.ts`:

```typescript
import chokidar from 'chokidar';

export class ProjectMapGenerator {
  private cache: string | null = null;
  private watcher: chokidar.FSWatcher | null = null;
  
  async generate(rootDir: string): Promise<string> {
    if (this.cache) return this.cache;
    this.cache = await this.buildMap(rootDir);
    this.startWatcher(rootDir);
    return this.cache;
  }
  
  private startWatcher(rootDir: string): void {
    if (this.watcher) return;
    this.watcher = chokidar.watch('**/*.{ts,js,py,go,rs}', {
      cwd: rootDir,
      ignored: ['node_modules/**', '.git/**'],
      persistent: true,
      ignoreInitial: true,
    });
    this.watcher.on('all', () => {
      this.cache = null;  // invalidate
    });
  }
}
```

**Step 19.5 — Multi-language LSP.** Create `python-lsp-client.ts` (wrapping `pylsp`), `rust-lsp-client.ts` (wrapping `rust-analyzer`). In `lsp-tools.ts`, route by file extension:

```typescript
function getClientForFile(filePath: string): LspClient {
  const ext = path.extname(filePath);
  switch (ext) {
    case '.ts': case '.tsx': case '.js': case '.jsx':
      return typescriptLspClient;
    case '.py':
      return pythonLspClient;
    case '.rs':
      return rustLspClient;
    default:
      throw new Error(`No LSP client for extension: ${ext}`);
  }
}
```

### Testing & Verification

- Native Landlock test: run on Linux kernel 5.13+, verify `goli audit` shows `sandboxTech: 'landlock'`
- cgroups IO test: write a tool that reads a large file, verify IO is throttled
- SymbolGraph tests: `findDefinitions('AgentLoop')`, `findSimilar('AgentLoop')`, `findCallPath('main', 'editFile')`
- ProjectMap test: modify a file, verify cache is invalidated and regenerated
- LSP test: open a `.py` file, verify `lsp_hover` works

### Rollback Plan

Revert `landlock.ts` to bubblewrap. Remove IO limits. Remove new SymbolGraph methods. Revert ProjectMap to stateless. Remove new LSP clients.

### Effort Estimate

8 engineer-days (2 days Landlock, 1 day cgroups IO, 2 days SymbolGraph methods, 1 day ProjectMap caching, 2 days multi-language LSP).

### Dependencies

Phase 4 (SymbolGraph Activation) must complete first.

---

## Phase 20 — MCP Transports, Failure Surfacing & Final Release (P1)

**Goal:** Add SSE and WebSocket MCP transports, surface MCP connection failures to the TUI, and finalize the release with full E2E tests, ADR updates, and CHANGELOG.

**Issues addressed:** MCP http-not-SSE/WS warning; MCP failure-silent warning; common failure mode "MCP tool not in registry"; release readiness.

### Problem Statement

MCP client supports only `stdio` and `http` transports (brief claims `stdio/SSE/WS`). Connection failures are logged but not surfaced to the TUI — users don't know why their MCP tools aren't appearing.

### Files to Modify

| File | Action |
|------|--------|
| `packages/core/src/tools/mcp/client.ts` | Add SSE and WebSocket transports |
| `packages/core/src/tools/mcp/transports/sse.ts` | **New** — SSE transport |
| `packages/core/src/tools/mcp/transports/ws.ts` | **New** — WebSocket transport |
| `packages/cli/src/services/CliAgentLoop.ts` | Surface MCP connection failures as TUI events |
| `packages/cli/src/tui/components/MCPStatusIndicator.tsx` | **New** — show MCP server status |
| `docs/decisions/ADR-*.md` | Update all ADRs to reflect final implementation |
| `CHANGELOG.md` | Add v0.4.0-stable entry |

### Implementation Steps

**Step 20.1 — SSE transport.** Create `transports/sse.ts`:

```typescript
import { EventSource } from 'eventsource';

export class SSETransport {
  private source: EventSource | null = null;
  
  async connect(url: string): Promise<void> {
    this.source = new EventSource(url);
    this.source.addEventListener('message', (event) => {
      this.handleMessage(JSON.parse(event.data));
    });
    this.source.addEventListener('error', (err) => {
      this.handleError(err);
    });
  }
  
  async send(message: unknown): Promise<void> {
    // SSE is server-push only; for bidirectional, use POST
    await fetch(this.url, {
      method: 'POST',
      body: JSON.stringify(message),
    });
  }
  
  async close(): Promise<void> {
    this.source?.close();
  }
}
```

**Step 20.2 — WebSocket transport.** Create `transports/ws.ts`:

```typescript
import WebSocket from 'ws';

export class WebSocketTransport {
  private ws: WebSocket | null = null;
  
  async connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);
      this.ws.on('open', resolve);
      this.ws.on('error', reject);
      this.ws.on('message', (data) => {
        this.handleMessage(JSON.parse(data.toString()));
      });
    });
  }
  
  async send(message: unknown): Promise<void> {
    this.ws?.send(JSON.stringify(message));
  }
  
  async close(): Promise<void> {
    this.ws?.close();
  }
}
```

**Step 20.3 — Surface failures.** In `mcp/client.ts`, emit events on connection failure:

```typescript
// In McpClient.connect():
try {
  await transport.connect(url);
} catch (err) {
  this.emit('connection-failed', {
    serverName,
    url,
    error: err.message,
  });
  // Also surface to TUI via the agent loop
  state.emit?.({
    kind: 'phase',
    phase: 'mcp-connection-failed',
    info: { serverName, error: err.message },
  });
}
```

**Step 20.4 — MCP status indicator.** Create `MCPStatusIndicator.tsx`:

```tsx
export function MCPStatusIndicator() {
  const { mcpServers } = useAppState();
  
  return (
    <Box>
      {Object.entries(mcpServers).map(([name, status]) => (
        <Text key={name} color={status.connected ? 'green' : 'red'}>
          {status.connected ? '●' : '✗'} {name}
        </Text>
      ))}
    </Box>
  );
}
```

**Step 20.5 — Final E2E test suite.** Create `tests/e2e/full-pipeline.test.ts` that runs the entire 20-item checklist from the verification report:

1. Start `goli` in `build` mode
2. Verify IAgentLoop contract (Phase 2)
3. Trigger `edit_file`, verify `DiffReviewDialog` shows diff (Phase 3)
4. Verify SymbolGraph has data (Phase 4)
5. Modify a policy file, verify session aborts (Phase 5)
6. Trigger a skill match, verify L2 loads (Phase 6)
7. Run a 5+ tool-call trajectory, verify skill extracted (Phase 7)
8. `goli hooks add`, verify hook blocks (Phase 8)
9. Verify provenance in HistoryScroll (Phase 9)
10. Verify 7-phase AgentStateBar (Phase 10)
11. Trigger compaction, verify banner (Phase 11)
12. Verify per-model cost (Phase 12)
13. Verify 3-bar TokenBar (Phase 13)
14. Verify "8-agent" in docs (Phase 14)
15. Verify Zod validation (Phase 15)
16. Verify mode-based skill filtering (Phase 16)
17. Verify cycle detection (Phase 17)
18. Verify no dead code (Phase 18)
19. Verify native Landlock + SymbolGraph methods (Phase 19)
20. Verify MCP SSE/WS + status indicator (Phase 20)

**Step 20.6 — Update ADRs.** Review all ADRs referenced in the brief (ADR-0009, 0010, 0018, 0023, 0024, 0030, 0039, 0042, 0045, 0046). Update each to reflect the final implementation. Add new ADRs for:
- ADR-0047: Native Landlock adoption (Phase 19)
- ADR-0048: User-facing hooks (Phase 8)
- ADR-0049: L2 skill loading (Phase 6)
- ADR-0050: Per-delta JsonRepair (Phase 17)

**Step 20.7 — CHANGELOG.** Add v0.4.0-stable entry:

```markdown
## v0.4.0-stable (2026-XX-XX)

### Breaking Changes
- `IAgentLoop` contract updated: 5 methods, `AsyncIterable<AgentEvent>` with 6+1 event kinds
- `SkillCategory` now validated with Zod
- Linux sandbox uses native Landlock (requires kernel 5.13+)

### New Features
- DiffReviewDialog now works in production `build` mode
- SymbolGraph is now populated at runtime (`indexWorkspace()` wired)
- L2 skill instructions load on-demand
- SkillWriter extracts skills from successful trajectories
- `goli hooks add/remove/list` commands for custom hooks
- Per-model cost breakdown in CostBreakdownPanel
- 7-phase AgentStateBar
- Compaction event banner
- Provenance displayed in HistoryScroll
- Native Linux Landlock + cgroups IO limits
- Multi-language LSP (TypeScript, Python, Rust)
- MCP SSE and WebSocket transports
- MCP status indicator in TUI

### Bug Fixes
- 30 Critical issues resolved (see goli-cli-verification-report.md)
- 39 Warnings resolved
- 25 Info items addressed

### Documentation
- Brief reconciled with CODE-MAP.md
- All counts corrected (22 tools, 13 fragments, 7-phase compaction, etc.)
- 4 new ADRs added
```

### Testing & Verification

- `npm run verify` (typecheck + lint + format + test) passes with zero errors
- `npm run test:e2e` passes all 20 checklist items
- `goli --version` still < 200ms
- `goli doctor` reports all green
- Manual smoke test: full session in `build` mode with all features exercised

### Rollback Plan

This is the release phase — rollback means reverting to v0.3.0-phase2-studio via git tag.

### Effort Estimate

5 engineer-days (2 days for MCP transports, 1 day for failure surfacing + status indicator, 2 days for E2E tests + ADRs + CHANGELOG).

### Dependencies

All previous phases (1–19) must complete before this phase.

---

## Summary

### Effort Breakdown

| Phase | Effort (days) | Priority | Can Parallelize With |
|-------|---------------|----------|---------------------|
| 1 — Documentation | 3 | P2 | All |
| 2 — Contract Hardening | 2 | P1 | 1 |
| 3 — DiffReviewDialog Bridge | 1 | P0 | 4, 5, 8, 14, 15 |
| 4 — SymbolGraph Activation | 4 | P0 | 3, 5, 8, 14, 15 |
| 5 — Policy Integrity | 3 | P0 | 3, 4, 8, 14, 15 |
| 6 — L2 Skill Loader | 3 | P0 | 3, 4, 5, 8, 14 |
| 7 — SkillWriter | 3 | P0 | 8, 14, 15 (after 5, 6) |
| 8 — Hook Registration | 5 | P0 | 3, 4, 5, 6, 14 |
| 9 — Provenance Bridging | 2 | P1 | 10, 11, 12, 13 (after 2) |
| 10 — AgentStateBar | 2 | P1 | 9, 11, 12, 13 (after 2) |
| 11 — Compaction Event | 2 | P1 | 9, 10, 12, 13 (after 2) |
| 12 — Per-Model Cost | 2 | P1 | 9, 10, 11, 13 (after 2) |
| 13 — TokenBar & Dedup | 2 | P1 | 9, 10, 11, 12 (after 2) |
| 14 — Swarm Count | 1 | P1 | All |
| 15 — Zod Migration | 3 | P1 | 3, 4, 5, 6, 8, 14 |
| 16 — Skill Filtering & Budget | 3 | P1 | 7, 8, 14, 15 (after 6) |
| 17 — LoopDetector & JsonRepair | 4 | P1 | All (no deps) |
| 18 — Dead Code & Reflexion | 2 | P2 | All (after 6) |
| 19 — Landlock & Code Intel | 8 | P1 | 8, 14, 15, 17 (after 4) |
| 20 — MCP & Release | 5 | P1 | None (after all) |
| **Total** | **60 days** | | |

### Critical Path

The longest dependency chain is:
**Phase 1 → 2 → 9/10/11/12/13 → 20** (parallel TUI phases)
**Phase 4 → 19 → 20** (code intelligence)
**Phase 5 → 7 → 20** (skills + SICA safety)

Critical path length: **~25 days** (5 weeks) if phases are parallelized across 3 engineers.

### Issue Coverage

| Issue Category | Count | Phases |
|----------------|-------|--------|
| Critical (🔴) | 30 | All 20 phases |
| Warning (🟡) | 39 | Phases 1, 2, 9–17, 19, 20 |
| Info (🔵) | 25 | Phases 1, 18, 20 |
| P0 recommendations | 5 | Phases 3, 4, 5, 6+7, 8 |
| P1 recommendations | 5 | Phases 9, 10, 11, 12, 14 |
| P2 recommendations | 4 | Phases 1, 2, 18 |
| **Total issues addressed** | **94** | **20 phases** |

### Success Criteria

The remediation is complete when:
1. `npm run verify` passes with zero errors
2. All 20 E2E checklist items pass
3. `goli-cli-verification-report.md` is re-run and shows 0 Critical, 0 Warning findings
4. `CODE-MAP.md` matches the codebase exactly
5. v0.4.0-stable is tagged and released

---

**End of remediation plan.** For the original audit findings, see `goli-cli-verification-report.md`. For the 5 accompanying diagrams, see `diagram_01_architecture` through `diagram_05_compliance_radar` in `/home/z/my-project/download/`.
