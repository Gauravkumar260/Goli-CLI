/**
 * state/AppStateStore.ts — Singleton store outside React.
 *
 * Mirrors the Claude Code / Gemini CLI architecture: state that must
 * survive re-renders lives here, not in React. React components
 * subscribe via `useAppState()` and read the snapshot.
 *
 * Performance tuning (no design change):
 *   - Notifications are coalesced: multiple `.patch()` / `.addUsage()` /
 *     `.setPipelineStep()` calls within the same event-loop tick emit
 *     ONE subscriber notification, not N. Previously each setter would
 *     re-render every subscribed React tree immediately. A typical turn
 *     calls `addUsage` + `bumpTurn` + `setActiveAgents` + `setPipelineStep`
 *     inside one for-await-of, so we were re-rendering 4× per phase
 *     change for the same logical state.
 *   - Implementation: a microtask (`queueMicrotask`) flag. Batched writes
 *     collapse to one notification. Reading `getSnapshot()` is always
 *     synchronous and current (no stale-data risk).
 *   - `flushSync()` is provided for tests / signals where you need
 *     subscribers to run synchronously (e.g. before process.exit).
 */
import { randomUUID } from 'node:crypto';
import type { AllowlistEntry, AppStateSnapshot, BusyInputMode, PendingPermission, QueuedMessage, RunMode, SessionPhase } from './types.js';
import type { TierId, AppMode } from '../theme/agents.js';
import { modeToTierId, modeToRunMode, modeToPermissionMode, getModeColor, getModeDesc } from '../theme/agents.js';

type SystemVariant = 'info' | 'warning' | 'error';

type Subscriber = (snap: AppStateSnapshot) => void;
type ApprovalResolve = (decision: { approve: boolean; always: boolean }) => void;

class AppStateStoreClass {
  private snap: AppStateSnapshot = {
    sessionId: randomUUID(),
    model: 'claude-sonnet-4-6:cloud',
    workspace: process.cwd(),
    branch: 'no-git',
    permissionMode: 'default',
    godMode: false,
    mode: 'SAFE',
    tier: 'T1',
    appMode: 'build' as AppMode,
    activeAgents: ['orchestrator'],
    pipelineStep: 0,
    totalCostUsd: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    tokens: 0,
    tokenLimit: 200000,
    turn: 0,
    startedAt: Date.now(),
    pendingPermission: null,
    sessionPhase: 'NEW',
    busyInputMode: 'interrupt',
    queuedMessages: [],
    pastePlaceholder: null,
    compactHint: false,
  };

  private pending: PendingPermission | null = null;
  private approvalResolver: ApprovalResolve | null = null;

  // T-062: Confirmation queue + session allowlist.
  private confirmationQueue: PendingPermission[] = [];
  private sessionAllowlist: AllowlistEntry[] = [];

  private subs = new Set<Subscriber>();

  // ─── Coalescing (no design change) ────────────────────────────────────
  private notifyScheduled = false;
  private lastEmittedGen = -1;
  private pendingGen = 0;
  private scheduleNotify(): void {
    this.pendingGen++;
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    queueMicrotask(() => {
      this.notifyScheduled = false;
      if (this.subs.size === 0) return;
      if (this.pendingGen === this.lastEmittedGen) return;
      this.lastEmittedGen = this.pendingGen;
      const s = this.snap;
      for (const fn of this.subs) fn(s);
    });
  }

  // ─── Subscription ──────────────────────────────────────────────────────────
  subscribe(fn: Subscriber): () => void {
    this.subs.add(fn);
    return () => {
      this.subs.delete(fn);
    };
  }

  private notify(): void {
    if (this.subs.size === 0) return;
    for (const fn of this.subs) fn(this.snap);
  }

  // ─── Read ──────────────────────────────────────────────────────────────────
  getSnapshot(): AppStateSnapshot {
    return this.snap;
  }

  getPendingPermission(): PendingPermission | null {
    return this.pending;
  }

  // ─── Write (coalesced) ────────────────────────────────────────────────────
  patch(partial: Partial<AppStateSnapshot>): void {
    this.snap = { ...this.snap, ...partial };
    this.scheduleNotify();
  }

  addUsage(inputTokens: number, outputTokens: number, costUsd: number): void {
    const total = inputTokens + outputTokens;
    this.snap = {
      ...this.snap,
      totalInputTokens: this.snap.totalInputTokens + inputTokens,
      totalOutputTokens: this.snap.totalOutputTokens + outputTokens,
      tokens: this.snap.tokens + total,
      totalCostUsd: this.snap.totalCostUsd + costUsd,
    };
    this.scheduleNotify();
  }

  bumpTurn(): void {
    this.snap = { ...this.snap, turn: this.snap.turn + 1 };
    this.scheduleNotify();
  }

  setPermissionMode(mode: AppStateSnapshot['permissionMode']): void {
    this.snap = { ...this.snap, permissionMode: mode };
    this.scheduleNotify();
  }

  toggleGodMode(): void {
    const next: RunMode = this.snap.mode === 'GOD' ? 'SAFE' : 'GOD';
    this.snap = {
      ...this.snap,
      mode: next,
      godMode: next === 'GOD',
      tier: next === 'GOD' ? 'BLK' : (this.snap.tier === 'BLK' ? 'T1' : this.snap.tier),
    };
    this.scheduleNotify();
  }

  setMode(mode: RunMode): void {
    this.snap = { ...this.snap, mode, godMode: mode === 'GOD' };
    this.scheduleNotify();
  }

  setTier(tier: TierId): void {
    this.snap = { ...this.snap, tier };
    this.scheduleNotify();
  }

  /**
   * T-MODE: Set the user-facing permission mode.
   * Maps the mode to the internal tier/mode/permissionMode for backward compat.
   */
  setAppMode(mode: AppMode): void {
    const tierId = modeToTierId(mode);
    const runMode = modeToRunMode(mode);
    const permMode = modeToPermissionMode(mode);
    this.snap = {
      ...this.snap,
      appMode: mode,
      tier: tierId,
      mode: runMode,
      godMode: mode === 'god',
      permissionMode: permMode,
    };
    this.scheduleNotify();
  }

  /**
   * T-MODE: Get the current app mode.
   */
  getAppMode(): AppMode {
    return this.snap.appMode ?? 'build';
  }

  setActiveAgents(agents: string[]): void {
    this.snap = { ...this.snap, activeAgents: agents };
    this.scheduleNotify();
  }

  setPipelineStep(step: number): void {
    this.snap = { ...this.snap, pipelineStep: step };
    this.scheduleNotify();
  }

  resetTokens(): void {
    this.snap = { ...this.snap, tokens: 0 };
    this.scheduleNotify();
  }

  // ─── §4.7 Session state machine ──────────────────────────────────────────
  setSessionPhase(phase: SessionPhase): void {
    this.snap = { ...this.snap, sessionPhase: phase };
    this.scheduleNotify();
  }

  activateSession(): void {
    if (this.snap.sessionPhase === 'NEW') {
      this.snap = { ...this.snap, sessionPhase: 'ACTIVE', startedAt: Date.now() };
      this.scheduleNotify();
    }
  }

  pauseSession(): void {
    this.snap = { ...this.snap, sessionPhase: 'PAUSED' };
    this.scheduleNotify();
  }

  archiveSession(): void {
    this.snap = { ...this.snap, sessionPhase: 'ARCHIVED' };
    this.scheduleNotify();
  }

  // ─── §4.4 Busy-input modes ─────────────────────────────────────────────
  setBusyInputMode(mode: BusyInputMode): void {
    this.snap = { ...this.snap, busyInputMode: mode };
    this.scheduleNotify();
  }

  cycleBusyInputMode(): void {
    const next: Record<BusyInputMode, BusyInputMode> = {
      interrupt: 'queue',
      queue: 'steer',
      steer: 'interrupt',
    };
    this.snap = { ...this.snap, busyInputMode: next[this.snap.busyInputMode] };
    this.scheduleNotify();
  }

  // ─── §5.3 / §4.4 Queue ────────────────────────────────────────────────
  queueMessage(text: string): void {
    const msg: QueuedMessage = { text, timestamp: Date.now() };
    this.snap = { ...this.snap, queuedMessages: [...this.snap.queuedMessages, msg] };
    this.scheduleNotify();
  }

  dequeueMessage(): QueuedMessage | null {
    const q = this.snap.queuedMessages;
    if (q.length === 0) return null;
    const [first, ...rest] = q;
    this.snap = { ...this.snap, queuedMessages: rest };
    this.scheduleNotify();
    return first;
  }

  clearQueue(): void {
    this.snap = { ...this.snap, queuedMessages: [] };
    this.scheduleNotify();
  }

  // ─── T-MODE: Cycle through read-only → plan → build → god ─────────────
  cyclePermissionMode(): void {
    const current = this.getAppMode();
    const cycle: AppMode[] = ['build', 'read-only', 'plan', 'god'];
    const idx = cycle.indexOf(current);
    const next = cycle[(idx + 1) % cycle.length] ?? 'build';
    this.setAppMode(next);
  }

  // ─── §5.5 Paste compaction ────────────────────────────────────────────
  setPastePlaceholder(text: string | null): void {
    this.snap = { ...this.snap, pastePlaceholder: text };
    this.scheduleNotify();
  }

  // ─── §6.4 Context compaction hint ─────────────────────────────────────
  setCompactHint(hint: boolean): void {
    this.snap = { ...this.snap, compactHint: hint };
    this.scheduleNotify();
  }

  checkCompactThreshold(): void {
    const pct = this.snap.tokenLimit > 0
      ? (this.snap.tokens / this.snap.tokenLimit) * 100
      : 0;
    if (pct >= 95 && !this.snap.compactHint) {
      this.snap = { ...this.snap, compactHint: true };
      this.scheduleNotify();
    } else if (pct < 80 && this.snap.compactHint) {
      this.snap = { ...this.snap, compactHint: false };
      this.scheduleNotify();
    }
  }

  // ─── Permission flow ───────────────────────────────────────────────────────
  waitForApproval(permission: PendingPermission): Promise<{ approve: boolean; always: boolean }> {
    this.pending = permission;
    this.snap = { ...this.snap, pendingPermission: permission };
    this.notify();
    return new Promise((resolve) => {
      this.approvalResolver = resolve;
    });
  }

  resolveApproval(decision: { approve: boolean; always: boolean }): void {
    // T-062: if "always" and approve, add to session allowlist.
    if (decision.approve && decision.always && this.pending) {
      const argPrefix = this.pending.arg.split(/\s+/).slice(0, 3).join(" ") || this.pending.arg;
      this.addToAllowlist(this.pending.tool, argPrefix);
    }
    if (this.approvalResolver) {
      this.approvalResolver(decision);
      this.approvalResolver = null;
    }
    this.pending = null;
    // T-062: advance to next queued permission (if any).
    if (this.confirmationQueue.length > 0) {
      this.advanceQueue();
    } else {
      this.snap = { ...this.snap, pendingPermission: null };
      this.notify();
    }
  }

  // ─── System message bridge ─────────────────────────────────────────────────
  private onSystemMessage: ((text: string, variant: SystemVariant) => void) | null = null;

  setOnSystemMessage(fn: ((text: string, variant: SystemVariant) => void) | null): void {
    this.onSystemMessage = fn;
  }

  pushSystemMessage(text: string, variant: SystemVariant = 'info'): void {
    if (!this.onSystemMessage) return;
    this.onSystemMessage(text, variant);
  }

  // T-062: Confirmation queue + session allowlist

  /**
   * Enqueue a permission for confirmation. If the queue was empty,
   * the permission becomes the active pending permission immediately.
   * Otherwise it waits in the queue. Index/total are populated for UI.
   */
  enqueuePermission(permission: PendingPermission): void {
    this.confirmationQueue.push(permission);
    this.updateQueuePositions();
    if (!this.pending) {
      this.advanceQueue();
    }
  }

  /**
   * Check whether a (tool, arg) pair is on the session allowlist.
   * Returns true if any allowlist entry's argPrefix is a prefix of `arg`.
   */
  isAllowlisted(tool: string, arg: string): boolean {
    for (const entry of this.sessionAllowlist) {
      if (entry.tool === tool && arg.startsWith(entry.argPrefix)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Add a (tool, argPrefix) entry to the session allowlist.
   * Duplicate entries (same tool + argPrefix) are ignored.
   */
  addToAllowlist(tool: string, argPrefix: string): void {
    const exists = this.sessionAllowlist.some(
      (e) => e.tool === tool && e.argPrefix === argPrefix,
    );
    if (exists) return;
    this.sessionAllowlist.push({ tool, argPrefix, addedAt: Date.now() });
  }

  /** Get a copy of the current session allowlist. */
  getAllowlist(): AllowlistEntry[] {
    return [...this.sessionAllowlist];
  }

  /** Clear the session allowlist (called on /clear and exit). */
  clearAllowlist(): void {
    this.sessionAllowlist = [];
  }

  /** Get the current confirmation queue length. */
  getQueueLength(): number {
    return this.confirmationQueue.length;
  }

  /** Get a copy of the current confirmation queue. */
  getQueue(): PendingPermission[] {
    return [...this.confirmationQueue];
  }

  /**
   * Clear the confirmation queue (called on /clear and exit).
   * Resolves any pending approval with deny.
   */
  clearConfirmationQueue(): void {
    if (this.approvalResolver) {
      this.approvalResolver({ approve: false, always: false });
      this.approvalResolver = null;
    }
    this.confirmationQueue = [];
    this.pending = null;
    this.snap = { ...this.snap, pendingPermission: null };
    this.notify();
  }

  /**
   * Update index/total on the active pending permission AND all queued permissions.
   * Total = 1 (active) + queue.length. Active gets index=1, queue items get 2+.
   * Called after enqueue/dequeue/advance.
   */
  private updateQueuePositions(): void {
    const queueLen = this.confirmationQueue.length;
    const hasActive = this.pending !== null;
    const total = (hasActive ? 1 : 0) + queueLen;
    if (hasActive && this.pending) {
      this.pending.index = 1;
      this.pending.total = total;
    }
    for (let i = 0; i < queueLen; i++) {
      this.confirmationQueue[i]!.index = (hasActive ? 2 : 1) + i;
      this.confirmationQueue[i]!.total = total;
    }
  }

  /**
   * Advance the queue: pop the next permission and make it active.
   * Called after resolveApproval() or clearQueue().
   */
  private advanceQueue(): void {
    if (this.confirmationQueue.length === 0) {
      this.pending = null;
      this.snap = { ...this.snap, pendingPermission: null };
      this.notify();
      return;
    }
    const next = this.confirmationQueue.shift()!;
    this.pending = next;
    this.updateQueuePositions();
    // Update snapshot with the (now index/total-populated) pending permission.
    this.snap = { ...this.snap, pendingPermission: { ...this.pending } };
    this.notify();
  }
  // ─── Test-only helpers ────────────────────────────────────────────────────
  flushSync(): void {
    if (this.notifyScheduled) {
      this.notifyScheduled = false;
      this.notify();
    }
  }
}

/**
 *
 */
export const AppStateStore = new AppStateStoreClass();
/**
 *
 */
export type { Subscriber };
