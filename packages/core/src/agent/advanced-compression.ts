/**
 * Advanced context compression — 4-phase algorithm (Hermes pattern).
 *
 * Replaces the simple compaction with a structured 4-phase algorithm:
 *
 * 1. PRUNE: Remove old tool results (>200 chars → placeholder, no LLM call)
 * 2. BOUNDARIES: Determine head/tail split (protect_first_n + token-budget walk,
 *    keep tool_call/tool_result pairs intact)
 * 3. SUMMARIZE: Generate structured summary via LLM (Goal/Constraints/Progress/
 *    Decisions/Files/Next Steps/Critical Context)
 * 4. ASSEMBLE: head + summary message + tail
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

import type { Message } from './types.js';
import type { Logger } from '../utils/logger.js';

/** The 4 phases of compression. */
export type CompressionPhase = 'prune' | 'boundaries' | 'summarize' | 'assemble';

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
  /** Tool result pruning threshold in chars (default: 200). */
  toolResultPruneThreshold?: number;
  /** Summary budget ratio (default: 0.20 = 20% of content tokens). */
  summaryBudgetRatio?: number;
  /** Minimum summary tokens (default: 2000). */
  minSummaryTokens?: number;
  /** Maximum summary tokens (default: 12000). */
  maxSummaryTokens?: number;
  /** Optional GLM client for summarization. */
  glmClient?: {
    call: (params: {
      messages: Array<{ role: string; content: string; timestamp: string }>;
      effort?: string;
    }) => Promise<{ content: string }>;
  };
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
 * Advanced 4-phase context compressor.
 *
 * @module agent/advanced-compression
 */
export class AdvancedCompressor {
  private readonly log?: Logger;
  private readonly inLoopTriggerRatio: number;
  private readonly safetyNetTriggerRatio: number;
  private readonly protectFirstN: number;
  private readonly toolResultPruneThreshold: number;
  private readonly summaryBudgetRatio: number;
  private readonly minSummaryTokens: number;
  private readonly maxSummaryTokens: number;
  private readonly glmClient?: AdvancedCompressorOptions['glmClient'];

  // Track previous summary for iterative re-compression
  private previousSummary: string | null = null;

  constructor(opts: AdvancedCompressorOptions = {}) {
    this.log = opts.logger;
    this.inLoopTriggerRatio = opts.inLoopTriggerRatio ?? 0.50;
    this.safetyNetTriggerRatio = opts.safetyNetTriggerRatio ?? 0.85;
    this.protectFirstN = opts.protectFirstN ?? 3;
    this.toolResultPruneThreshold = opts.toolResultPruneThreshold ?? 200;
    this.summaryBudgetRatio = opts.summaryBudgetRatio ?? 0.20;
    this.minSummaryTokens = opts.minSummaryTokens ?? 2000;
    this.maxSummaryTokens = opts.maxSummaryTokens ?? 12000;
    this.glmClient = opts.glmClient;
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
   * Run the 4-phase compression algorithm.
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

    this.log?.info('Starting 4-phase compression', {
      triggerPhase,
      currentTokens,
      maxTokens,
      messageCount: messages.length,
    });

    const tokensBefore = currentTokens;

    // ─── Phase 2: BOUNDARIES (run first so Phase 1 only prunes the middle) ──
    const { head, middle, tail } = this.phase2Boundaries(messages, maxTokens);
    this.log?.debug('Phase 2 (boundaries) complete', {
      head: head.length,
      middle: middle.length,
      tail: tail.length,
    });

    // ─── Phase 1: PRUNE (only the middle segment — head and tail are protected) ──
    const { prunedMessages, prunedCount } = this.phase1Prune(middle);
    this.log?.debug('Phase 1 (prune) complete', { prunedCount, remaining: prunedMessages.length });

    // ─── Phase 3: SUMMARIZE ─────────────────────────────────────
    const summary = await this.phase3Summarize(prunedMessages, maxTokens);
    this.log?.debug('Phase 3 (summarize) complete', { summaryLength: summary.length });

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
   * Phase 1: Prune old tool results.
   *
   * Replaces tool result content > threshold chars with a placeholder,
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
      if (msg.role === 'tool' && msg.content.length > this.toolResultPruneThreshold) {
        prunedCount++;
        return { ...msg, content: PRUNED_PLACEHOLDER };
      }
      return msg;
    });

    return { prunedMessages, prunedCount };
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

    // Walk backwards from the end to find the tail boundary
    // Keep tool_call/tool_result pairs intact
    const tailBudget = Math.floor(maxTokens * 0.3); // 30% of context for tail
    let tailTokens = 0;
    let tailStart = remaining.length;

    for (let i = remaining.length - 1; i >= 0; i--) {
      const msg = remaining[i]!;
      const msgTokens = this.estimateTokens([msg]);

      // Don't split a tool_result from its tool_call
      if (msg.role === 'tool' && i > 0 && remaining[i - 1]?.role === 'assistant' && remaining[i - 1]?.toolCalls?.length) {
        // Include the assistant message with tool_calls
        const assistantTokens = this.estimateTokens([remaining[i - 1]!]);
        if (tailTokens + msgTokens + assistantTokens > tailBudget) break;
        tailTokens += msgTokens + assistantTokens;
        tailStart = i - 1;
        i--; // Skip the assistant message (already counted)
      } else {
        if (tailTokens + msgTokens > tailBudget) break;
        tailTokens += msgTokens;
        tailStart = i;
      }
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
   * @param middle
   * @param _maxTokens
   */
  private async phase3Summarize(middle: Message[], _maxTokens: number): Promise<string> {
    if (middle.length === 0) {
      return '';
    }

    // Calculate summary budget
    const contentTokens = this.estimateTokens(middle);
    const summaryBudget = Math.min(
      this.maxSummaryTokens,
      Math.max(this.minSummaryTokens, Math.floor(contentTokens * this.summaryBudgetRatio)),
    );

    // Serialize the middle messages
    const serialized = this.serializeMessages(middle, summaryBudget * 4);

    if (this.glmClient) {
      try {
        const prompt = this.previousSummary
          ? ITERATIVE_PROMPT
              .replace('{previous_summary}', this.previousSummary)
              .replace('{latest_content}', serialized)
          : SUMMARY_PROMPT + '\n\nMessages to summarize:\n' + serialized;

        const response = await this.glmClient.call({
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
      // Always use 'user' role for the summary. Using 'system' mid-conversation
      // is rejected by the OpenAI/GLM API (system must be index 0), and using
      // 'assistant' would create consecutive assistant messages.
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
