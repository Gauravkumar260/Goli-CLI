/**
 * Goli Studio — context compaction (the vault's headline "surpassing Claude
 * Code" innovation, pragmatically adapted).
 *
 * The vault specifies a 6-layer pipeline:
 *   1. Drop tool results no longer referenced
 *   2. Truncate long file reads to relevant sections
 *   3. Summarize middle-conversation turns with the LLM
 *   4. Compress repeated file reads (cache + refer)
 *   5. Hard truncation with a session-summary header
 *   6. Semantic dedup using embeddings  (Goli's innovation)
 *
 * For v0.1 we implement the layers that pay off without extra dependencies:
 *   - Token estimation (rough: 4 chars ≈ 1 token)
 *   - When over budget: summarize the oldest N middle messages into ONE compact
 *     system note using the LLM, keep the most recent K messages verbatim.
 *   - Drop large tool-result blocks from the summarized region (the summary
 *     captures their gist).
 *
 * This keeps long, resumable sessions within the provider's context window
 * without losing the thread. Layers 4 + 6 (semantic dedup, embeddings) are
 * deferred to a v0.2 that adds sqlite-vec.
 */
import { complete } from '../providers/router';

import type { ProviderMessage } from '../providers/router';
import type { StoredMessage } from '../storage/session';

/** Rough token estimate: ~4 chars per token. Conservative. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Sum the estimated tokens across a message list. */
export function totalTokens(msgs: { content: string }[]): number {
  return msgs.reduce((sum, m) => sum + estimateTokens(m.content), 0);
}

/**
 *
 */
export interface CompactionConfig {
  /** Soft token budget for the conversation (excluding the system prompt). */
  maxTokens: number;
  /** Number of most-recent messages to always keep verbatim. */
  keepRecent: number;
  /** Minimum messages before compaction kicks in. */
  minMessagesToCompact: number;
}

/**
 *
 */
export const DEFAULT_COMPACTION: CompactionConfig = {
  maxTokens: 24_000, // leaves headroom under typical 32k context for the response
  keepRecent: 8, // keep the last 8 messages verbatim (4 turns)
  minMessagesToCompact: 12, // don't bother compacting tiny conversations
};

/**
 *
 */
export interface CompactionResult {
  messages: ProviderMessage[];
  compacted: boolean;
  summary?: string;
  /** How many messages were folded into the summary. */
  foldedCount: number;
  /** Estimated tokens before → after. */
  tokensBefore: number;
  tokensAfter: number;
}

/**
 * Compact a conversation if it exceeds the token budget.
 *
 * Strategy: split into [head, middle, tail]. The `tail` (keepRecent) is kept
 * verbatim. The `middle` is summarized into a single system note via the LLM.
 * The `head` (the very first user message) is kept verbatim so the original
 * goal is never lost.
 *
 * Pure of side effects EXCEPT it calls the provider to generate the summary.
 * If the provider call fails, it falls back to a deterministic extractive
 * summary (first line of each message) so compaction never blocks the loop.
 */
export async function compactIfNeeded(
  systemPrompt: string,
  history: ProviderMessage[],
  cfg: CompactionConfig = DEFAULT_COMPACTION,
): Promise<CompactionResult> {
  const convTokens = totalTokens(history);
  if (
    convTokens <= cfg.maxTokens ||
    history.length < cfg.minMessagesToCompact
  ) {
    return {
      messages: history,
      compacted: false,
      foldedCount: 0,
      tokensBefore: convTokens,
      tokensAfter: convTokens,
    };
  }

  // Keep the first user message (the original goal) + the last `keepRecent`.
  const firstUserIdx = history.findIndex((m) => m.role === 'user');
  const head = firstUserIdx >= 0 ? [history[firstUserIdx]] : [];
  const tail = history.slice(-cfg.keepRecent);
  const middle = history.slice(
    firstUserIdx >= 0 ? firstUserIdx + 1 : 0,
    history.length - cfg.keepRecent,
  );

  if (middle.length === 0) {
    return {
      messages: history,
      compacted: false,
      foldedCount: 0,
      tokensBefore: convTokens,
      tokensAfter: convTokens,
    };
  }

  // Build the summary.
  let summary: string;
  try {
    summary = await llmSummarize(middle);
  } catch {
    summary = extractiveSummary(middle);
  }

  const summaryMessage: ProviderMessage = {
    role: 'system',
    content:
      `[Earlier conversation summarized to save context. Summary of ${middle.length} messages]:\n` +
      summary,
  };

  const compacted: ProviderMessage[] = [...head, summaryMessage, ...tail];
  return {
    messages: compacted,
    compacted: true,
    summary,
    foldedCount: middle.length,
    tokensBefore: convTokens,
    tokensAfter: totalTokens(compacted),
  };
}

/**
 * Ask the LLM to produce a tight summary of a message run. The summary keeps
 * decisions, file paths, and open questions; drops verbose tool output.
 */
async function llmSummarize(msgs: ProviderMessage[]): Promise<string> {
  const transcript = msgs
    .map((m) => `### ${m.role}\n${truncate(m.content, 1500)}`)
    .join('\n\n');
  const summarizerPrompt: ProviderMessage[] = [
    {
      role: 'system',
      content:
        'You are a context-compaction assistant. Summarize the conversation below into a compact note that preserves: the user\'s goals, decisions made, file paths touched, errors hit, and open questions. Drop verbose file contents and tool output. Max 250 words. Use bullets.',
    },
    { role: 'user', content: transcript },
  ];
  const result = await complete({ messages: summarizerPrompt, maxTokens: 600 });
  return result.trim();
}

/** Deterministic fallback: first meaningful line of each message. */
function extractiveSummary(msgs: ProviderMessage[]): string {
  const lines = msgs.map((m) => {
    const firstLine = m.content.split('\n').find((l) => l.trim().length > 0) ?? '';
    return `- [${m.role}] ${truncate(firstLine, 120)}`;
  });
  return `Compacted ${msgs.length} messages (extractive fallback):\n${lines.join('\n')}`;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

/**
 * Convert stored messages (from Prisma) to provider messages, dropping the
 * `system` role rows (the system prompt is rebuilt fresh each run) and mapping
 * `tool` role → `user` (tool results are wrapped as user messages in this
 * prompt-based ReAct implementation).
 */
export function storedToProviderMessages(
  stored: StoredMessage[],
): ProviderMessage[] {
  return stored
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: (m.role === 'tool' ? 'user' : m.role) as 'user' | 'assistant',
      content: m.content,
    }));
}
