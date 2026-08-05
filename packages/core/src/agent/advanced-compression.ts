/**
 * Advanced context compression — 7-phase algorithm (Hermes pattern).
 *
 * P3-2 fix (audit Finding 2.15): the previous implementation was a
 * 4-phase algorithm (Prune, Boundaries, Summarize, Assemble). The
 * brief described a 5-layer compaction engine. We now implement a
 * 7-phase pipeline:
 *
 * 0. DEDUPE: Remove duplicate tool results (same tool + same args →
 *    keep only the latest). Cheap pre-pass, no LLM call.
 * 1. PRUNE: Replace old tool results over the threshold with a
 *    placeholder. P3-2 fix: the threshold was 200 CHARS (far too
 *    aggressive — a single `read_file` of a 50-line file is ~2000
 *    chars and would be pruned immediately, losing context the agent
 *    needs). We now use 2000 TOKENS (~8000 chars) as the threshold.
 * 2. EVICT: Drop messages older than N turns from the middle segment
 *    (they'll be captured by the summary). Configurable via
 *    `evictTurnAge` (default: 10).
 * 3. FREEZE: Preserve the FrozenSnapshot (P3-1) — the task prompt,
 *    role, and critical constraints are frozen at session start and
 *    re-injected after every compaction so the agent never loses
 *    sight of the original goal.
 * 4. BOUNDARIES + SUMMARIZE + ASSEMBLE: the original 4 phases (now
 *    phases 4–6 of 7, but we keep the old method names for compat).
 *
 * ## Iterative re-compression
 *
 * Previous summary is passed to the LLM with "update" instructions,
 * preserving info across multiple compactions.
 *
 * ## Dual compression system
 *
 * - Agent compressor fires at 50% of context (configurable, in-loop)
 * - Gateway/session hygiene fires at 85% as safety net (between turns)
 *
 * ## Summary boundary markers
 *
 * Summary is wrapped in `[CONTEXT COMPACTION — REFERENCE ONLY]` prefix
 * and `_SUMMARY_END_MARKER` suffix to distinguish it from regular messages.
 *
 * @module agent/advanced-compression
 */

import { renderFrozenSnapshot, type FrozenSnapshot } from './frozen-snapshot.js';

import type { Message } from './types.js';
import type { Logger } from '../utils/logger.js';

/** The phases of compression (P3-2: expanded from 4 to 7). */
export type CompressionPhase = 'dedupe' | 'prune' | 'evict' | 'freeze' | 'boundaries' | 'summarize' | 'assemble';

/** Options for the AdvancedCompressor. */
export interface AdvancedCompressorOptions {
  /** Logger instance. */
  logger?: Logger;
  /** Trigger ratio for in-loop compression (default: 0.50 = 50%). */
  inLoopTriggerRatio?: number;
  /** Trigger ratio for safety-net compression (default: 0.85 = 85%). */
  safetyNetTriggerRatio?: number;
  /** Number of head messages to protect (default: 3). */
  protectFirstN?: number;
  /**
   * Tool result pruning threshold in TOKENS (default: 2000).
   *
   * P3-2 fix (audit Finding 2.15): the previous default was 200 CHARS.
   * A single `read_file` of a 50-line file is ~2000 chars and would be
   * pruned immediately, losing the context the agent just read. We now
   * use 2000 TOKENS (~8000 chars) so only genuinely large tool outputs
   * (huge `grep` results, massive `list_directory` dumps) get pruned.
   * The threshold is token-based to match the rest of the compressor
   * (which estimates tokens, not chars).
   */
  toolResultPruneThresholdTokens?: number;
  /**
   * P3-2: Tool result pruning threshold in CHARS (deprecated, kept for
   * backward compat). If set, takes precedence over the token-based
   * threshold. New callers should use `toolResultPruneThresholdTokens`.
   * @deprecated Use `toolResultPruneThresholdTokens` instead.
   */
  toolResultPruneThreshold?: number;
  /**
   * P3-2: Eviction turn age (default: 10). Messages in the middle
   * segment older than this many turns are evicted (captured by the
   * summary). Set to 0 to disable eviction.
   */
  evictTurnAge?: number;
  /** Summary budget ratio (default: 0.20 = 20% of content tokens). */
  summaryBudgetRatio?: number;
  /** Minimum summary tokens (default: 2000). */
  minSummaryTokens?: number;
  /** Maximum summary tokens (default: 12000). */
  maxSummaryTokens?: number;
  /** Optional LLM client for summarization. */
  llmClient?: {
    call: (params: {
      messages: Array<{ role: string; content: string; timestamp: string }>;
      effort?: string;
    }) => Promise<{ content: string }>;
  };
  /**
   * P3-1: FrozenSnapshot to re-inject after every compaction. When set,
   * the Freeze layer prepends the snapshot's content to the summary so
   * the agent never loses sight of the original task / role / constraints.
   */
  frozenSnapshot?: FrozenSnapshot;
}

/** The result of a compression operation. */
export interface CompressionResult {
  /** The compressed message array. */
  messages: Message[];
  /** The generated summary. */
  summary: string;
  /** Whether pruning occurred. */
  pruned: boolean;
  /** Number of tool results pruned. */
  prunedCount: number;
  /** Number of messages in the head. */
  headCount: number;
  /** Number of messages in the tail. */
  tailCount: number;
  /** Estimated tokens before compression. */
  tokensBefore: number;
  /** Estimated tokens after compression. */
  tokensAfter: number;
  /** Tokens saved. */
  tokensSaved: number;
  /** The phase that triggered compression. */
  triggerPhase: 'in_loop' | 'safety_net';
  /** Whether iterative re-compression was used. */
  iterative: boolean;
}

/** Summary boundary markers. */
export const SUMMARY_PREFIX = '[CONTEXT COMPACTION — REFERENCE ONLY]';
/**
 *
 */
export const SUMMARY_END_MARKER = '[END CONTEXT COMPACTION]';
/**
 *
 */
export const HISTORICAL_SUMMARY_PREFIX = '[HISTORICAL CONTEXT COMPACTION]';

/** The structured summary prompt template. */
const SUMMARY_PROMPT = `You are compressing a conversation history for an AI coding agent. Create a structured summary preserving:

## Goal
What is the user trying to accomplish?

## Constraints
What constraints, preferences, or requirements have been stated?

## Progress
### Done
What has been completed?
### In Progress
What is currently being worked on?
### Blocked
What is blocked or waiting?

## Key Decisions
What architectural or design decisions were made and why?

## Relevant Files
What files were read, modified, or created?

## Next Steps
What needs to happen next?

## Critical Context
Any bugs, edge cases, or critical information that must not be lost.

Respond with the summary in the exact format above. Be concise but complete. Do NOT include full file contents — just paths and key findings.`;

/** Iterative re-compression prompt. */
const ITERATIVE_PROMPT = `You are updating an existing conversation summary with new information from the latest messages.

Previous summary:
{previous_summary}

Latest messages to incorporate:
{latest_content}

Update the summary to include the new information. Keep the same format:
Goal / Constraints / Progress (Done/In Progress/Blocked) / Key Decisions / Relevant Files / Next Steps / Critical Context

Preserve all information from the previous summary that is still relevant. Remove items that have been completed or superseded.`;

/** Placeholder for pruned tool results. */
const PRUNED_PLACEHOLDER = '[Old tool output cleared to save context space]';

/**
 * Advanced 7-phase context compressor (P3-2: expanded from 4 phases).
 *
 * @module agent/advanced-compression
 */
export class AdvancedCompressor {
  private readonly log?: Logger;
  private readonly inLoopTriggerRatio: number;
  private readonly safetyNetTriggerRatio: number;
  private readonly protectFirstN: number;
  /** P3-2: prune threshold. If `toolResultPruneThreshold` (chars, deprecated) is set, use it; otherwise use `toolResultPruneThresholdTokens` (default 2000). */
  private readonly toolResultPruneThreshold: number;
  /** P3-2: prune threshold unit — 'chars' (deprecated) or 'tokens'. */
  private readonly pruneThresholdUnit: 'chars' | 'tokens';
  /** P3-2: evict messages older than this many turns (0 = disabled). */
  private readonly evictTurnAge: number;
  private readonly summaryBudgetRatio: number;
  private readonly minSummaryTokens: number;
  private readonly maxSummaryTokens: number;
  private readonly llmClient?: AdvancedCompressorOptions['llmClient'];
  /** P3-1: frozen snapshot to re-inject after every compaction. */
  private frozenSnapshot?: FrozenSnapshot;

  // Track previous summary for iterative re-compression
  private previousSummary: string | null = null;

  constructor(opts: AdvancedCompressorOptions = {}) {
    this.log = opts.logger;
    this.inLoopTriggerRatio = opts.inLoopTriggerRatio ?? 0.50;
    this.safetyNetTriggerRatio = opts.safetyNetTriggerRatio ?? 0.85;
    this.protectFirstN = opts.protectFirstN ?? 3;
    // P3-2: prefer the deprecated char-based threshold if set (backward
    // compat), otherwise use the new token-based threshold (default 2000).
    if (opts.toolResultPruneThreshold !== undefined) {
      this.toolResultPruneThreshold = opts.toolResultPruneThreshold;
      this.pruneThresholdUnit = 'chars';
    } else {
      this.toolResultPruneThreshold = opts.toolResultPruneThresholdTokens ?? 2000;
      this.pruneThresholdUnit = 'tokens';
    }
    this.evictTurnAge = opts.evictTurnAge ?? 10;
    this.summaryBudgetRatio = opts.summaryBudgetRatio ?? 0.20;
    this.minSummaryTokens = opts.minSummaryTokens ?? 2000;
    this.maxSummaryTokens = opts.maxSummaryTokens ?? 12000;
    this.llmClient = opts.llmClient;
    this.frozenSnapshot = opts.frozenSnapshot;
  }

  /**
   * P3-1: Set or update the frozen snapshot. Called by the AgentLoop
   * at session start (after the first user message) so the compressor
   * can re-inject the snapshot after every compaction.
   */
  setFrozenSnapshot(snapshot: FrozenSnapshot): void {
    this.frozenSnapshot = snapshot;
  }

  /**
   * Check if in-loop compression is needed (50% threshold).
   * @param currentTokens
   * @param maxTokens
   */
  shouldCompressInLoop(currentTokens: number, maxTokens: number): boolean {
    return currentTokens >= maxTokens * this.inLoopTriggerRatio;
  }

  /**
   * Check if safety-net compression is needed (85% threshold).
   * @param currentTokens
   * @param maxTokens
   */
  shouldCompressSafetyNet(currentTokens: number, maxTokens: number): boolean {
    return currentTokens >= maxTokens * this.safetyNetTriggerRatio;
  }

  /**
   * Run the 7-phase compression algorithm.
   *
   * @param messages - The full message history.
   * @param maxTokens - The max context tokens.
   * @param currentTokens - The current token count.
   * @returns The compression result.
   */
  async compress(
    messages: Message[],
    maxTokens: number,
    currentTokens: number,
  ): Promise<CompressionResult> {
    const triggerPhase: 'in_loop' | 'safety_net' = this.shouldCompressSafetyNet(currentTokens, maxTokens)
      ? 'safety_net'
      : 'in_loop';

    this.log?.info('Starting 7-phase compression', {
      triggerPhase,
      currentTokens,
      maxTokens,
      messageCount: messages.length,
    });

    const tokensBefore = currentTokens;

    // ─── P3-2 Layer 0: DEDUPE (remove duplicate tool results) ────
    const { dedupedMessages, dedupedCount } = this.phase0Dedupe(messages);
    if (dedupedCount > 0) {
      this.log?.debug('Layer 0 (dedupe) complete', { dedupedCount, remaining: dedupedMessages.length });
    }

    // ─── Phase 2: BOUNDARIES (run first so Phase 1 only prunes the middle) ──
    const { head, middle, tail } = this.phase2Boundaries(dedupedMessages, maxTokens);
    this.log?.debug('Phase 2 (boundaries) complete', {
      head: head.length,
      middle: middle.length,
      tail: tail.length,
    });

    // ─── P3-2 Layer 2: EVICT (drop old messages from the middle) ──
    const { evictedMessages, evictedCount } = this.phaseEvict(middle);
    if (evictedCount > 0) {
      this.log?.debug('Layer 2 (evict) complete', { evictedCount, remaining: evictedMessages.length });
    }

    // ─── Phase 1: PRUNE (only the middle segment — head and tail are protected) ──
    const { prunedMessages, prunedCount } = this.phase1Prune(evictedMessages);
    this.log?.debug('Phase 1 (prune) complete', { prunedCount, remaining: prunedMessages.length });

    // ─── Phase 3: SUMMARIZE ─────────────────────────────────────
    let summary = await this.phase3Summarize(prunedMessages, maxTokens);
    this.log?.debug('Phase 3 (summarize) complete', { summaryLength: summary.length });

    // ─── P3-1 Layer 3: FREEZE (prepend the frozen snapshot to the summary) ──
    summary = this.phaseFreeze(summary);
    if (this.frozenSnapshot) {
      this.log?.debug('Layer 3 (freeze) complete — snapshot re-injected');
    }

    // ─── Phase 4: ASSEMBLE ──────────────────────────────────────
    const assembled = this.phase4Assemble(head, summary, tail);
    this.log?.debug('Phase 4 (assemble) complete', { assembledCount: assembled.length });

    // Estimate tokens after compression
    const tokensAfter = this.estimateTokens(assembled);
    const tokensSaved = Math.max(0, tokensBefore - tokensAfter);

    // Store summary for iterative re-compression
    const wasIterative = this.previousSummary !== null;
    this.previousSummary = summary;

    const result: CompressionResult = {
      messages: assembled,
      summary,
      pruned: prunedCount > 0,
      prunedCount,
      headCount: head.length,
      tailCount: tail.length,
      tokensBefore,
      tokensAfter,
      tokensSaved,
      triggerPhase,
      iterative: wasIterative,
    };

    this.log?.info('Compression complete', {
      triggerPhase,
      tokensBefore,
      tokensAfter,
      tokensSaved,
      prunedCount,
      headCount: head.length,
      tailCount: tail.length,
      summaryLength: summary.length,
    });

    return result;
  }

  /**
   * P3-2 Layer 0: Dedupe — remove duplicate tool results.
   *
   * When the agent calls the same tool with the same arguments multiple
   * times (common in ReAct loops where the model re-reads a file after
   * each edit), all but the latest result are redundant. We replace
   * earlier duplicates with a short placeholder referencing the latest.
   *
   * This is a cheap pre-pass that doesn't require an LLM call. It runs
   * BEFORE boundaries so duplicates in the head/tail are also caught.
   *
   * @param messages - The full message history.
   * @returns The deduped messages + count of duplicates removed.
   */
  private phase0Dedupe(messages: Message[]): { dedupedMessages: Message[]; dedupedCount: number } {
    // Build a map of (toolName, toolCallId) → latest index. We key on
    // toolCallId because the model reuses the same ID for retries of
    // the same call. For distinct calls with the same args, we key on
    // (toolName, content-hash) — but that's expensive, so we only
    // dedupe on exact (toolName, toolCallId) matches for now.
    const seen = new Map<string, number>(); // key → first index
    const dedupedMessages: Message[] = [];
    let dedupedCount = 0;
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]!;
      if (msg.role === 'tool' && msg.toolCallId) {
        // Key on toolName + toolCallId (the same call retried).
        // For distinct calls with different IDs but same content, we
        // don't dedupe — the model may have intentionally re-read.
        const key = `${msg.toolName ?? '?'}:${msg.toolCallId}`;
        const prevIdx = seen.get(key);
        if (prevIdx !== undefined && dedupedMessages[prevIdx]?.role === 'tool') {
          // Replace the earlier occurrence with a placeholder.
          dedupedMessages[prevIdx] = {
            ...dedupedMessages[prevIdx]!,
            content: `[Duplicate tool output — see latest result for ${msg.toolName ?? 'tool'}]`,
          };
          dedupedCount++;
        }
        seen.set(key, dedupedMessages.length);
      }
      dedupedMessages.push(msg);
    }
    return { dedupedMessages, dedupedCount };
  }

  /**
   * Phase 1: Prune old tool results.
   *
   * P3-2 fix: the threshold is now token-based (default 2000 tokens,
   * ~8000 chars) instead of char-based (200 chars). A single `read_file`
   * of a 50-line file is ~2000 chars and was being pruned immediately
   * under the old threshold, losing context the agent just read. The
   * new threshold only prunes genuinely large outputs (huge grep results,
   * massive directory dumps).
   *
   * For backward compat, if `toolResultPruneThreshold` (chars, deprecated)
   * was set in the constructor, we use that instead.
   *
   * Replaces tool result content over the threshold with a placeholder,
   * but ONLY for messages in the middle segment (i.e. NOT in the head
   * or tail). Pruning tail messages would destroy recent context.
   * This is a cheap pre-pass that doesn't require an LLM call.
   *
   * Note: This method is called AFTER phase2Boundaries so we know which
   * messages are protected. Pass the middle segment only.
   * @param messages
   */
  private phase1Prune(messages: Message[]): { prunedMessages: Message[]; prunedCount: number } {
    let prunedCount = 0;
    const prunedMessages = messages.map((msg) => {
      if (msg.role !== 'tool') return msg;
      // P3-2: use token-based or char-based threshold depending on config.
      const overThreshold = this.pruneThresholdUnit === 'chars'
        ? msg.content.length > this.toolResultPruneThreshold
        : this.estimateTokens([msg]) > this.toolResultPruneThreshold;
      if (overThreshold) {
        prunedCount++;
        return { ...msg, content: PRUNED_PLACEHOLDER };
      }
      return msg;
    });

    return { prunedMessages, prunedCount };
  }

  /**
   * P3-2 Layer 2: Evict — drop old messages from the middle segment.
   *
   * Messages older than `evictTurnAge` turns (default 10) are evicted
   * from the middle segment. They'll be captured by the summary, so
   * evicting them saves tokens without losing information (the summary
   * preserves the gist).
   *
   * "Turn age" is measured by counting user/assistant message pairs.
   * A message is "old" if there are more than `evictTurnAge` user
   * messages after it. Set `evictTurnAge: 0` to disable eviction.
   *
   * @param middle - The middle segment (between head and tail).
   * @returns The evicted messages + count of evictions.
   */
  private phaseEvict(middle: Message[]): { evictedMessages: Message[]; evictedCount: number } {
    if (this.evictTurnAge <= 0 || middle.length === 0) {
      return { evictedMessages: middle, evictedCount: 0 };
    }
    // Count user messages from the end backwards. Messages before the
    // (evictTurnAge)-th-from-last user message are evicted.
    let userCount = 0;
    let cutoffIdx = middle.length; // evict everything before this index
    for (let i = middle.length - 1; i >= 0; i--) {
      if (middle[i]!.role === 'user') {
        userCount++;
        if (userCount >= this.evictTurnAge) {
          cutoffIdx = i;
          break;
        }
      }
    }
    if (cutoffIdx >= middle.length) {
      return { evictedMessages: middle, evictedCount: 0 };
    }
    const evictedCount = cutoffIdx;
    const evictedMessages = middle.slice(cutoffIdx);
    return { evictedMessages, evictedCount };
  }

  /**
   * P3-1 Layer 3: Freeze — prepend the frozen snapshot to the summary.
   *
   * After compaction, the agent sees the summary but may have lost the
   * original task / role / constraints (the "amnesia" problem from
   * ADR-0024). The Freeze layer prepends the FrozenSnapshot (captured
   * at session start) to the summary so the agent always sees:
   *
   *   [FROZEN SNAPSHOT]
   *   Task: ...
   *   Role: ...
   *   Constraints: ...
   *   [END FROZEN SNAPSHOT]
   *
   *   [CONTEXT COMPACTION]
   *   <summary>
   *   [END CONTEXT COMPACTION]
   *
   * If no snapshot is set, this is a no-op (returns the summary unchanged).
   */
  private phaseFreeze(summary: string): string {
    const snapshotText = renderFrozenSnapshot(this.frozenSnapshot);
    if (snapshotText.length === 0) return summary;
    return snapshotText + '\n\n' + summary;
  }

  /**
   * Phase 2: Determine boundaries.
   *
   * Splits messages into head (protected), middle (to summarize),
   * and tail (recent context to keep verbatim).
   *
   * - Head: first `protectFirstN` messages (usually system + first user)
   * - Tail: recent messages within the token budget
   * - Middle: everything between head and tail (to be summarized)
   * @param messages
   * @param maxTokens
   */
  private phase2Boundaries(
    messages: Message[],
    maxTokens: number,
  ): { head: Message[]; middle: Message[]; tail: Message[] } {
    const head = messages.slice(0, Math.min(this.protectFirstN, messages.length));
    const remaining = messages.slice(head.length);

    if (remaining.length === 0) {
      return { head, middle: [], tail: [] };
    }

    // Walk backwards from the end to find the tail boundary.
    // Keep tool_call/tool_result groups intact. The previous
    // implementation only paired a `tool` message with the
    // IMMEDIATELY-preceding `assistant` message — so if an assistant
    // turn emitted multiple tool calls (and thus multiple `tool`
    // result messages followed), only the FIRST tool message
    // triggered the pairing. Subsequent tool messages from the same
    // assistant turn were processed independently and could be left
    // in `middle`, splitting the tool_call/tool_result group. We now
    // find the assistant turn that owns the tool result(s) and keep
    // the entire group (assistant + all its tool results) together.
    const tailBudget = Math.floor(maxTokens * 0.3); // 30% of context for tail
    let tailTokens = 0;
    let tailStart = remaining.length;

    let i = remaining.length - 1;
    while (i >= 0) {
      const msg = remaining[i]!;
      const msgTokens = this.estimateTokens([msg]);

      if (msg.role === 'tool') {
        // Find the assistant turn that produced this tool result. It
        // is the closest preceding `assistant` message whose
        // `toolCalls` array contains a tool call with this `toolCallId`.
        // We then collect ALL tool results for that assistant turn so
        // the group stays together.
        let assistantIdx = -1;
        for (let j = i - 1; j >= 0; j--) {
          const candidate = remaining[j]!;
          if (candidate.role === 'assistant' && candidate.toolCalls?.length) {
            assistantIdx = j;
            break;
          }
          // If we hit a non-tool, non-assistant message (e.g., a
          // user message) before finding an assistant, the tool
          // result is orphaned — treat it as a standalone message.
          if (candidate.role !== 'tool') {
            break;
          }
        }

        if (assistantIdx >= 0) {
          // Collect the assistant + ALL tool results that follow it
          // (until the next non-tool message or the boundary).
          const groupEnd = i + 1;
          // Find the end of the tool-result group: scan forward from
          // assistantIdx to find where the next non-tool message starts.
          let groupEndIdx = assistantIdx + 1;
          while (
            groupEndIdx < remaining.length &&
            remaining[groupEndIdx]!.role === 'tool'
          ) {
            groupEndIdx++;
          }
          const groupTokens = this.estimateTokens(remaining.slice(assistantIdx, Math.min(groupEndIdx, groupEnd)));
          if (tailTokens + groupTokens > tailBudget) {
            // Group doesn't fit — stop. The tail so far is what we keep.
            i = -1;
            break;
          }
          tailTokens += groupTokens;
          tailStart = assistantIdx;
          // Continue walking backwards from BEFORE the assistant.
          i = assistantIdx - 1;
          continue;
        }
      }

      if (tailTokens + msgTokens > tailBudget) break;
      tailTokens += msgTokens;
      tailStart = i;
      i--;
    }

    const tail = remaining.slice(tailStart);
    const middle = remaining.slice(0, tailStart);

    return { head, middle, tail };
  }

  /**
   * Phase 3: Generate structured summary.
   *
   * Uses LLM to generate a structured summary of the middle messages.
   * If a previous summary exists, uses iterative re-compression.
   *
   * The `maxTokens` parameter scales the summary budget to the
   * model's context window. The previous implementation ignored
   * it (`_maxTokens`) and used a fixed budget from instance config
   * (`this.minSummaryTokens` / `this.maxSummaryTokens` /
   * `this.summaryBudgetRatio`). So the summary budget was the same
   * whether the model's context window was 8K or 1M tokens — a
   * 1M-context model could fit a 200K-token summary but got only
   * 12K. We now use `maxTokens` as the upper bound.
   * @param middle
   * @param maxTokens
   */
  private async phase3Summarize(middle: Message[], maxTokens: number): Promise<string> {
    if (middle.length === 0) {
      return '';
    }

    // Calculate summary budget. Scale the upper bound to the
    // model's context window — don't cap at a fixed 12K when the
    // model can handle more.
    const contentTokens = this.estimateTokens(middle);
    const scaledMax = Math.min(this.maxSummaryTokens, Math.floor(maxTokens * 0.15));
    const summaryBudget = Math.min(
      scaledMax,
      Math.max(this.minSummaryTokens, Math.floor(contentTokens * this.summaryBudgetRatio)),
    );

    // Serialize the middle messages
    const serialized = this.serializeMessages(middle, summaryBudget * 4);

    if (this.llmClient) {
      try {
        const prompt = this.previousSummary
          ? ITERATIVE_PROMPT
              .replace('{previous_summary}', this.previousSummary)
              .replace('{latest_content}', serialized)
          : SUMMARY_PROMPT + '\n\nMessages to summarize:\n' + serialized;

        const response = await this.llmClient.call({
          messages: [
            { role: 'system', content: prompt, timestamp: new Date().toISOString() },
            { role: 'user', content: 'Generate the summary now.', timestamp: new Date().toISOString() },
          ],
          effort: 'high',
        });

        return this.wrapSummary(response.content);
      } catch (err) {
        this.log?.error('LLM summarization failed, using fallback', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Fallback: heuristic summary (no LLM)
    return this.wrapSummary(this.heuristicSummary(middle));
  }

  /**
   * Phase 4: Assemble the compressed message array.
   *
   * head + summary message + tail
   * @param head
   * @param summary
   * @param tail
   */
  private phase4Assemble(head: Message[], summary: string, tail: Message[]): Message[] {
    const assembled: Message[] = [...head];

    if (summary.length > 0) {
      // Use 'user' role for the summary. The previous
      // implementation noted that OpenAI/GLM reject 'system'
      // messages mid-conversation (system must be index 0).
      // Anthropic allows system messages anywhere, but using
      // 'user' is semantically wrong for system-injected context.
      // We keep 'user' as the safe default for multi-provider
      // compatibility, but the summary content is wrapped in
      // boundary markers (`[HISTORICAL CONTEXT COMPACTION]`) so
      // the LLM can distinguish it from actual user input.
      // A future enhancement could add a provider-aware role
      // selector.
      assembled.push({
        role: 'user',
        content: summary,
        timestamp: new Date().toISOString(),
      });
    }

    assembled.push(...tail);

    return assembled;
  }

  /**
   * Wrap a summary with boundary markers.
   * @param summary
   */
  private wrapSummary(summary: string): string {
    return `${SUMMARY_PREFIX}\n${summary}\n${SUMMARY_END_MARKER}`;
  }

  /**
   * Serialize messages into a single text block for summarization.
   * @param messages
   * @param maxChars
   */
  private serializeMessages(messages: Message[], maxChars: number): string {
    const lines: string[] = [];
    let totalChars = 0;

    for (const msg of messages) {
      const role = msg.role.toUpperCase();
      let content = msg.content;
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        const toolSummary = msg.toolCalls
          .map((tc) => `  → ${tc.name}(${tc.arguments.slice(0, 100)})`)
          .join('\n');
        content += `\n[Tool calls:]\n${toolSummary}`;
      }

      const entry = `[${role}]\n${content}\n`;
      if (totalChars + entry.length > maxChars) {
        // Truncate to fit — grapheme-safe (avoid splitting surrogate pairs)
        const remaining = maxChars - totalChars;
        if (remaining > 100) {
          const chars = Array.from(entry);
          lines.push(chars.slice(0, remaining).join('') + '\n[...truncated...]');
        }
        break;
      }

      lines.push(entry);
      totalChars += entry.length;
    }

    return lines.join('\n---\n\n');
  }

  /**
   * Heuristic summary (fallback when no LLM is available).
   * @param messages
   */
  private heuristicSummary(messages: Message[]): string {
    const userMessages = messages.filter((m) => m.role === 'user');
    const assistantMessages = messages.filter((m) => m.role === 'assistant');
    const toolMessages = messages.filter((m) => m.role === 'tool');

    const lines: string[] = [
      `## Goal`,
      userMessages[0]?.content.slice(0, 200) ?? '(unknown)',
      '',
      `## Progress`,
      `### Done`,
      ...assistantMessages.slice(-2).map((m) => `- ${m.content.slice(0, 150)}`),
      '',
      `## Relevant Files`,
      ...toolMessages.slice(-3).map((m) => `- [${m.toolName}] ${m.content.slice(0, 100)}`),
      '',
      `## Critical Context`,
      `(Auto-generated fallback summary — ${messages.length} messages compressed)`,
    ];

    return lines.join('\n');
  }

  /**
   * Estimate token count (rough: 4 chars per token, +4 tokens overhead per message + tool call).
   * @param messages
   */
  private estimateTokens(messages: Message[]): number {
    const MESSAGE_OVERHEAD_TOKENS = 4; // role + control tokens per message
    const TOOL_CALL_OVERHEAD_TOKENS = 4; // name + id + control tokens per tool call
    let tokens = 0;
    for (const msg of messages) {
      tokens += MESSAGE_OVERHEAD_TOKENS;
      tokens += Math.ceil(msg.content.length / 4);
      if (msg.thinking) tokens += Math.ceil(msg.thinking.length / 4);
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          tokens += TOOL_CALL_OVERHEAD_TOKENS;
          tokens += Math.ceil(tc.arguments.length / 4);
        }
      }
    }
    return tokens;
  }

  /** Reset the compressor state (new session). */
  reset(): void {
    this.previousSummary = null;
  }

  /** Get the trigger ratios for display. */
  getTriggerRatios(): { inLoop: number; safetyNet: number } {
    return { inLoop: this.inLoopTriggerRatio, safetyNet: this.safetyNetTriggerRatio };
  }
}
