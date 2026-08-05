/**
 * SICA loop (Module 5, part 4).
 *
 * The recursive self-improvement loop:
 *
 *   Evaluate → Archive → Self-Edit → Guard → Re-evaluate → Adopt/Revert
 *
 * 1. **Evaluate**: run the current version against a benchmark subset
 * 2. **Archive**: snapshot the current version (append-only)
 * 3. **Self-Edit**: the agent proposes changes to its own code/prompts
 * 4. **Guard**: the immutable safety registry + LLM overseer review the diff
 * 5. **Re-evaluate**: run the modified version against the same benchmark + holdout
 * 6. **Adopt/Revert**: if benchmark improved AND holdout didn't degrade
 *    AND overseer approved AND tests passed → adopt; otherwise → revert
 *
 * ## Safety Guardrails
 *
 * - **Immutable safety registry**: protects sandbox, hooks, approval, SICA itself
 * - **LLM-based overseer**: separate model with veto power
 * - **Test-gated adoption**: full test suite must pass AND benchmark must improve
 * - **Overfitting detection**: reject if holdout degrades beyond threshold
 * - **Rate limiting**: max 10 cycles/day, human review >50 LOC
 * - **Rollback**: any prior version restorable from the append-only archive
 *
 * @module memory/sica/loop
 */

import { randomUUID } from 'node:crypto';

import { SicaArchive } from './archive.js';
import { ImmutableSafetyRegistry } from './immutable-registry.js';
import { OverfitDetector } from './overfit-detector.js';
import { SafetyOverseer } from './overseer.js';
import { SicaRateLimiter } from './rate-limiter.js';
import { DEFAULT_SICA_OPTIONS } from './types.js';

import type {
  SicaProposal,
  SicaEvaluation,
  SicaCycleResult,
  SicaTarget,
  SicaLoopOptions,
} from './types.js';
import type { Logger } from '../../utils/logger.js';

/** Options for the SicaLoop. */
export interface SicaLoopConstructorOptions extends SicaLoopOptions {
  /** Logger instance. */
  logger?: Logger;
  /** The workspace root. */
  workspaceRoot?: string;
  /** Optional LLM client for the overseer. */
  llmClient?: {
    call: (params: {
      messages: Array<{ role: string; content: string; timestamp: string }>;
      effort?: string;
    }) => Promise<{ content: string }>;
  };
  /** Optional evaluation function (runs the agent against a benchmark).
   *
   * The `proposal` parameter is passed when evaluating the "after" state
   * so the function can apply the proposed change before running the
   * benchmark. Without this, the SICA loop would compare before/after
   * evaluations that are identical.
   */
  evaluate?: (benchmark: string, proposal?: SicaProposal) => Promise<SicaEvaluation>;
}

/** The SICA loop — recursive self-improvement with guardrails. */
export class SicaLoop {
  private readonly opts: Required<SicaLoopOptions>;
  private readonly log?: Logger;
  private readonly registry: ImmutableSafetyRegistry;
  private readonly overseer: SafetyOverseer;
  private readonly archive: SicaArchive;
  private readonly overfitDetector: OverfitDetector;
  private readonly rateLimiter: SicaRateLimiter;
  private readonly evaluateFn?: SicaLoopConstructorOptions['evaluate'];

  constructor(opts: SicaLoopConstructorOptions = {}) {
    this.opts = { ...DEFAULT_SICA_OPTIONS, ...opts };
    this.log = opts.logger;

    this.registry = new ImmutableSafetyRegistry({
      logger: this.log,
      workspaceRoot: opts.workspaceRoot,
    });

    this.overseer = new SafetyOverseer({
      registry: this.registry,
      llmClient: opts.llmClient,
      logger: this.log,
    });

    this.archive = new SicaArchive({ logger: this.log });

    this.overfitDetector = new OverfitDetector({
      maxHoldoutDegradation: this.opts.maxHoldoutDegradation,
    });

    this.rateLimiter = new SicaRateLimiter({
      maxCyclesPerDay: this.opts.maxCyclesPerDay,
      humanReviewLocThreshold: this.opts.humanReviewLocThreshold,
      logger: this.log,
    });

    this.evaluateFn = opts.evaluate;
  }

  /**
   * Toggle the enabled flag without reconstructing the loop.
   *
   * Round-2 verification item #2 (SICA singleton reconstruction):
   * previously, `CommandRegistry.ts` reconstructed `new SicaLoop({...})`
   * on every `/sica` invocation where `sicaEnabled === true`, defeating
   * state persistence across invocations (rate-limiter counters reset,
   * archive state lost, etc.). With `setEnabled()`, callers can flip
   * the flag on the existing singleton — the rate limiter, archive,
   * and immutable-safety registry all retain their state.
   *
   * @param enabled - Whether SICA is enabled.
   */
  setEnabled(enabled: boolean): void {
    this.opts.enabled = enabled;
  }

  /** Whether SICA is currently enabled. */
  get isEnabled(): boolean {
    return this.opts.enabled;
  }

  /**
   * Run a single SICA cycle.
   *
   * @param proposal - The proposed change.
   * @returns The cycle result (adopted or reverted).
   */
  async runCycle(proposal: SicaProposal): Promise<SicaCycleResult> {
    // ─── 0. Check if SICA is enabled ────────────────────────────
    if (!this.opts.enabled) {
      return this.reject(proposal, 'SICA is disabled. Set enabled: true to enable.');
    }

    // ─── 1. Check rate limit ────────────────────────────────────
    if (!this.rateLimiter.canRunCycle()) {
      return this.reject(proposal, `Rate limit exceeded: ${this.opts.maxCyclesPerDay} cycles/day. ${this.rateLimiter.cyclesToday} cycles already run today.`);
    }

    // ─── 2. Check if human review is required ──────────────────
    if (this.rateLimiter.requiresHumanReview(proposal)) {
      this.log?.warn('SICA proposal requires human review', {
        proposalId: proposal.proposalId,
        linesChanged: proposal.linesChanged,
        threshold: this.opts.humanReviewLocThreshold,
      });
      // For Phase 11, we auto-reject proposals requiring human review
      // In production, this would surface a UI for human approval
      //
      // NOTE: the previous implementation did NOT call
      // `rateLimiter.recordCycle()` on this rejection path —
      // inconsistent with the veto path (line 171) and the
      // overfitting path (line 220) which DO record. An agent
      // could spam proposals requiring human review without
      // consuming rate-limit budget, potentially flooding the
      // review queue. We now record so this counts toward the
      // daily cycle budget.
      this.rateLimiter.recordCycle();
      return this.reject(proposal, `Human review required: proposal changes ${proposal.linesChanged} lines (threshold: ${this.opts.humanReviewLocThreshold}). Please review manually.`);
    }

    // ─── 3. Evaluate the current version (before) ──────────────
    const beforeEvaluation = await this.evaluate('swe-bench-verified-50');

    // ─── 4. Archive the current version ────────────────────────
    const currentVersion = this.archive.getCurrentVersion(proposal.target, proposal.targetName);
    this.archive.append({
      version: currentVersion + 1,
      target: proposal.target,
      targetName: proposal.targetName,
      content: proposal.oldContent,
      // Use 'snapshot' for the pre-cycle snapshot, not 'initial'.
      // 'initial' is supposed to mean "the original version before
      // any SICA changes" (per types.ts), but the previous
      // implementation used 'initial' for EVERY cycle's pre-cycle
      // snapshot, polluting the archive. `getLastAdopted` searched
      // for `status === 'adopted' || status === 'initial'`, so the
      // 'initial' snapshots were returned as "last adopted", which
      // is wrong. We now use 'snapshot' for these so the 'initial'
      // fallback in getLastAdopted only matches the genuine initial
      // version.
      status: 'snapshot',
    });

    // ─── 5. Guard: overseer review ─────────────────────────────
    const overseerVerdict = await this.overseer.review(proposal);
    if (!overseerVerdict.approved) {
      this.log?.warn('SICA proposal vetoed by overseer', {
        proposalId: proposal.proposalId,
        maxSeverity: overseerVerdict.maxSeverity,
        concerns: overseerVerdict.concerns.length,
      });

      // Archive the vetoed proposal
      this.archive.append({
        version: currentVersion + 2,
        target: proposal.target,
        targetName: proposal.targetName,
        content: proposal.oldContent, // Unchanged
        proposalId: proposal.proposalId,
        status: 'reverted',
      });

      this.rateLimiter.recordCycle();

      return {
        proposal,
        beforeEvaluation,
        afterEvaluation: beforeEvaluation, // No change → same evaluation
        overseerVerdict,
        adopted: false,
        reason: `Vetoed by overseer: ${overseerVerdict.reasoning}`,
        resolutionDelta: 0,
        holdoutDegraded: false,
        timestamp: new Date().toISOString(),
      };
    }

    // ─── 6. Re-evaluate with the proposed change ───────────────
    // Compute ALL "before" evaluations first, then ALL "after"
    // evaluations. The previous implementation computed
    // `afterEvaluation` BEFORE `beforeHoldout` — if `evaluateFn`
    // has side effects (e.g., applies the proposal to the agent's
    // state and doesn't roll back), then `beforeHoldout` (the "no
    // proposal" baseline) was actually evaluating the post-proposal
    // state, not the pre-proposal state. The variable name said
    // "before" but the state was "after". The previous fix only
    // changed the call order without explicit state management.
    // We now compute both BEFORE evaluations first, then both
    // AFTER. The `evaluateFn` contract should explicitly state
    // whether it applies/rolls back the proposal.
    const beforeHoldout = await this.evaluate('swe-bench-holdout-50');
    const afterEvaluation = await this.evaluate('swe-bench-verified-50', proposal);
    const holdoutEvaluation = await this.evaluate('swe-bench-holdout-50', proposal);

    // ─── 7. Check overfitting ──────────────────────────────────
    const overfittingResult = this.overfitDetector.detect(
      beforeEvaluation,
      afterEvaluation,
      beforeHoldout,
      holdoutEvaluation,
    );

    if (overfittingResult.detected) {
      this.log?.warn('SICA proposal rejected: overfitting detected', {
        proposalId: proposal.proposalId,
        optimizationDelta: overfittingResult.optimizationDelta,
        holdoutDelta: overfittingResult.holdoutDelta,
      });

      this.archive.append({
        version: currentVersion + 2,
        target: proposal.target,
        targetName: proposal.targetName,
        content: proposal.oldContent, // Unchanged
        proposalId: proposal.proposalId,
        status: 'reverted',
      });

      this.rateLimiter.recordCycle();

      return {
        proposal,
        beforeEvaluation,
        afterEvaluation,
        overseerVerdict,
        adopted: false,
        reason: `Overfitting detected: ${overfittingResult.reason}`,
        resolutionDelta: afterEvaluation.resolutionRate - beforeEvaluation.resolutionRate,
        holdoutDegraded: true,
        timestamp: new Date().toISOString(),
      };
    }

    // ─── 8. Check resolution improvement ───────────────────────
    const resolutionDelta = afterEvaluation.resolutionRate - beforeEvaluation.resolutionRate;
    if (resolutionDelta < this.opts.minResolutionImprovement) {
      this.log?.info('SICA proposal rejected: insufficient improvement', {
        proposalId: proposal.proposalId,
        resolutionDelta,
        threshold: this.opts.minResolutionImprovement,
      });

      this.archive.append({
        version: currentVersion + 2,
        target: proposal.target,
        targetName: proposal.targetName,
        content: proposal.oldContent,
        proposalId: proposal.proposalId,
        status: 'reverted',
      });

      this.rateLimiter.recordCycle();

      return {
        proposal,
        beforeEvaluation,
        afterEvaluation,
        overseerVerdict,
        adopted: false,
        reason: `Insufficient improvement: delta ${(resolutionDelta * 100).toFixed(1)}% < threshold ${(this.opts.minResolutionImprovement * 100).toFixed(1)}%`,
        resolutionDelta,
        holdoutDegraded: false,
        timestamp: new Date().toISOString(),
      };
    }

    // ─── 9. Adopt the change ───────────────────────────────────
    this.log?.info('SICA proposal adopted', {
      proposalId: proposal.proposalId,
      target: proposal.target,
      targetName: proposal.targetName,
      resolutionDelta,
    });

    this.archive.append({
      version: currentVersion + 2,
      target: proposal.target,
      targetName: proposal.targetName,
      content: proposal.newContent,
      proposalId: proposal.proposalId,
      status: 'adopted',
    });

    this.rateLimiter.recordCycle();

    return {
      proposal,
      beforeEvaluation,
      afterEvaluation,
      overseerVerdict,
      adopted: true,
      reason: `Adopted: resolution improved by ${(resolutionDelta * 100).toFixed(1)}%, holdout stable, overseer approved.`,
      resolutionDelta,
      holdoutDegraded: false,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Rollback to a prior version.
   *
   * The previous implementation called `archive.getVersion()` which
   * returns the content regardless of `status` — a user could roll
   * back to a version that was `reverted` (i.e., a rejected
   * proposal), re-introducing a change that was previously deemed
   * unsafe. We now use `getVersionEntry()` and refuse to roll back
   * to a `reverted` version.
   *
   * NOTE: this function STILL does not write the rolled-back
   * content to the actual target (the system prompt fragment,
   * tool description, hook config, etc.) — it returns the content
   * string and the caller is responsible for applying it. There
   * is no caller in the codebase that does so. A future
   * `TargetWriter` would fix this; tracked as a HIGH finding in
   * the audit.
   *
   * @param target - What to rollback.
   * @param targetName - The target name.
   * @param version - The version to rollback to.
   * @returns The content at that version, or null if not found / refused.
   */
  rollback(target: SicaTarget, targetName: string, version: number): string | null {
    const entry = this.archive.getVersionEntry(target, targetName, version);
    if (entry === null) {
      this.log?.warn('Rollback failed: version not found', { target, targetName, version });
      return null;
    }
    // Refuse to roll back to a `reverted` version — that was a
    // rejected proposal, not a live state. Allow rollback to
    // 'adopted', 'initial', and 'snapshot' statuses (all
    // represent valid live states at some point).
    if (entry.status === 'reverted') {
      this.log?.error('Rollback refused: target version was reverted (rejected proposal, not live state)', {
        target, targetName, version,
      });
      return null;
    }
    const content = entry.content;

    // Archive the rollback as a new version
    const currentVersion = this.archive.getCurrentVersion(target, targetName);
    this.archive.append({
      version: currentVersion + 1,
      target,
      targetName,
      content,
      status: 'adopted',
    });

    this.log?.info('Rollback complete', { target, targetName, rolledBackTo: version, newVersion: currentVersion + 1 });
    return content;
  }

  /**
   * Create a SICA proposal.
   * @param params
   * @param params.target
   * @param params.targetName
   * @param params.oldContent
   * @param params.newContent
   * @param params.rationale
   */
  createProposal(params: {
    target: SicaTarget;
    targetName: string;
    oldContent: string;
    newContent: string;
    rationale: string;
  }): SicaProposal {
    const linesChanged = this.countChangedLines(params.oldContent, params.newContent);
    const diff = this.generateDiff(params.oldContent, params.newContent);

    return {
      proposalId: randomUUID(),
      target: params.target,
      targetName: params.targetName,
      oldContent: params.oldContent,
      newContent: params.newContent,
      diff,
      linesChanged,
      rationale: params.rationale,
      timestamp: new Date().toISOString(),
    };
  }

  /** Get the immutable safety registry. */
  getRegistry(): ImmutableSafetyRegistry {
    return this.registry;
  }

  /** Get the archive. */
  getArchive(): SicaArchive {
    return this.archive;
  }

  /** Get the rate limiter. */
  getRateLimiter(): SicaRateLimiter {
    return this.rateLimiter;
  }

  // ─── Internal helpers ──────────────────────────────────────────

  /**
   * Evaluate against a benchmark (uses the provided function or a stub).
   *
   * The `proposal` parameter is passed through to the evaluate function
   * so it can apply the proposed change before running the benchmark.
   * Without this, the SICA loop would compare before/after evaluations
   * that are identical (the proposal was never applied).
   * @param benchmark
   * @param proposal
   */
  private async evaluate(benchmark: string, proposal?: SicaProposal): Promise<SicaEvaluation> {
    if (this.evaluateFn) {
      // Pass the proposal to the evaluate function so it can apply the
      // change before running the benchmark. The previous implementation
      // called `this.evaluateFn(benchmark)` without the proposal, so the
      // "after" evaluation was identical to the "before" — the SICA loop
      // never actually tested the proposed change.
      return this.evaluateFn(benchmark, proposal);
    }

    // Safety default: no evaluateFn was provided, so we cannot safely
    // measure whether the proposal actually improves the agent. The
    // previous stub returned `improvement = 0.02` whenever a proposal
    // was passed, which made `runCycle` ALWAYS adopt (the resolution-
    // improvement check, `delta >= minResolutionImprovement`, always
    // passed) and NEVER trigger overfitting detection (the holdout
    // delta was also +0.02). That effectively bypassed every SICA
    // safety guardrail whenever the loop was enabled without a real
    // evaluator.
    //
    // The correct safe-default is to return ZERO improvement so that
    // the resolution-improvement check rejects the proposal. Enabling
    // SICA without an evaluator is now a no-op ("nothing adopted")
    // rather than a security hole ("everything adopted").
    this.log?.warn(
      'SICA evaluate called without evaluateFn — returning zero-improvement stub (proposal will not be adopted)',
      { benchmark, hasProposal: proposal !== undefined },
    );
    const baseRate = benchmark.includes('holdout') ? 0.45 : 0.50;

    return {
      benchmark,
      resolutionRate: baseRate, // No improvement — proposal will fail the threshold.
      instanceCount: 50,
      resolvedCount: Math.round(baseRate * 50),
      semanticErrorRate: 0.15,
      totalTokens: 50000,
      totalCostUsd: 0.25,
      durationMs: 30000,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Reject a proposal with a given reason.
   * @param proposal
   * @param reason
   */
  private reject(proposal: SicaProposal, reason: string): SicaCycleResult {
    const stubEval: SicaEvaluation = {
      benchmark: 'swe-bench-verified-50',
      resolutionRate: 0,
      instanceCount: 0,
      resolvedCount: 0,
      semanticErrorRate: 0,
      totalTokens: 0,
      totalCostUsd: 0,
      durationMs: 0,
      timestamp: new Date().toISOString(),
    };

    return {
      proposal,
      beforeEvaluation: stubEval,
      afterEvaluation: stubEval,
      overseerVerdict: {
        approved: false,
        reasoning: reason,
        concerns: [],
        maxSeverity: 'info',
      },
      adopted: false,
      reason,
      resolutionDelta: 0,
      holdoutDegraded: false,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Count the number of changed lines between two strings using
   * a proper LCS-based diff (not naive line-by-line).
   *
   * The previous implementation iterated `max(oldLines.length,
   * newLines.length)` and compared `oldLines[i] !== newLines[i]`.
   * If you insert a single line at the BEGINNING of a 100-line
   * file, all 100 subsequent lines shift by one index, so all 100
   * are counted as "changed". This means a 1-line insertion
   * triggered `linesChanged = 100`, which exceeds the
   * human-review threshold (50), causing automatic rejection of
   * small, safe edits. We now use a Myers-style LCS diff that
   * returns the actual edit distance (insertions + deletions +
   * modifications).
   * @param oldContent
   * @param newContent
   */
  private countChangedLines(oldContent: string, newContent: string): number {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    // LCS table: dp[i][j] = LCS length of oldLines[0..i) and newLines[0..j)
    const m = oldLines.length;
    const n = newLines.length;
    // Use a 1D rolling array to avoid O(m*n) memory for large files.
    // dp[j] = LCS length so far for column j.
    const dp = new Array<number>(n + 1).fill(0);
    for (let i = 1; i <= m; i++) {
      const prev = new Array<number>(n + 1).fill(0);  // dp[i-1]
      // Copy current dp into prev before overwriting dp.
      for (let j = 0; j <= n; j++) prev[j] = dp[j];
      dp[0] = 0;
      for (let j = 1; j <= n; j++) {
        if (oldLines[i - 1] === newLines[j - 1]) {
          dp[j] = prev[j - 1] + 1;
        } else {
          dp[j] = Math.max(prev[j], dp[j - 1]);
        }
      }
    }
    const lcs = dp[n];
    // Count changed lines as `max(deletions, insertions)` so a 1-line
    // replacement (`- old / + new`) counts as 1 changed line, matching
    // `git diff --stat` semantics. The previous formula
    // `(m - lcs) + (n - lcs)` (deletions + insertions) double-counted
    // replacements: a single 1-line edit was reported as 2 changed lines.
    const deletions = m - lcs;
    const insertions = n - lcs;
    return Math.max(deletions, insertions);
  }

  /**
   * Generate a simple unified diff using LCS-based alignment.
   *
   * The previous implementation used the same naive line-by-line
   * comparison as `countChangedLines` — inserting a single line at
   * the start of a file showed ALL lines as `- old / + new`. We
   * now use the LCS to align unchanged lines and only show
   * insertions / deletions as `-` / `+`.
   * @param oldContent
   * @param newContent
   */
  private generateDiff(oldContent: string, newContent: string): string {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    const m = oldLines.length;
    const n = newLines.length;
    // Build full LCS table for backtracking (small enough here — diff
    // is only generated for review display, not on the hot path).
    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (oldLines[i - 1] === newLines[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }
    // Backtrack to build the diff.
    const diff: string[] = [];
    let i = m, j = n;
    while (i > 0 && j > 0) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        diff.push(`  ${oldLines[i - 1]}`);
        i--; j--;
      } else if (dp[i - 1][j] >= dp[i][j - 1]) {
        diff.push(`- ${oldLines[i - 1]}`);
        i--;
      } else {
        diff.push(`+ ${newLines[j - 1]}`);
        j--;
      }
    }
    while (i > 0) {
      diff.push(`- ${oldLines[i - 1]}`);
      i--;
    }
    while (j > 0) {
      diff.push(`+ ${newLines[j - 1]}`);
      j--;
    }
    // Reverse because we built it backwards.
    diff.reverse();

    return diff.join('\n');
  }
}
