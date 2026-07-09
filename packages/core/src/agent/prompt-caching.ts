/**
 * Prompt caching strategy — system_and_3 (Hermes pattern).
 *
 * Places 4 cache_control breakpoints:
 * 1. System prompt (stable + context tiers)
 * 2. Last 3 non-system messages
 *
 * All at same TTL (5m default). This gives ~75% input token cost
 * reduction on multi-turn conversations.
 *
 * ## Why system_and_3?
 *
 * - System prompt is large (2-5K tokens) and never changes → cache it
 * - The last 3 messages are the active context → cache them
 * - Older messages are either already cached from a previous turn or
 *   will be evicted naturally
 *
 * @module agent/prompt-caching
 */

import type { Message } from './types.js';

/** A cache control breakpoint. */
export interface CacheBreakpoint {
  /** The message index in the messages array. */
  messageIndex: number;
  /** The cache type. */
  type: 'ephemeral';
  /** The TTL in seconds (default: 300 = 5 min). */
  ttlSeconds?: number;
}

/** Options for the caching strategy. */
export interface CachingStrategyOptions {
  /** TTL in seconds (default: 300 = 5 min). */
  ttlSeconds?: number;
  /** Number of recent messages to cache (default: 3). */
  recentMessageCount?: number;
}

/**
 * Apply the `system_and_3` caching strategy to a messages array.
 *
 * Returns an array of cache_control breakpoints to attach to messages.
 *
 * @param messages - The messages array.
 * @param opts - Strategy options.
 * @returns Array of cache breakpoints.
 */
export function applySystemAnd3Strategy(
  messages: Message[],
  opts: CachingStrategyOptions = {},
): CacheBreakpoint[] {
  const ttlSeconds = opts.ttlSeconds ?? 300;
  const recentCount = opts.recentMessageCount ?? 3;
  const breakpoints: CacheBreakpoint[] = [];

  if (messages.length === 0) return breakpoints;

  // 1. Cache the system prompt (index 0)
  breakpoints.push({
    messageIndex: 0,
    type: 'ephemeral',
    ttlSeconds,
  });

  // 2. Cache the last N non-system messages
  const nonSystemMessages: Array<{ index: number }> = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]!.role !== 'system') {
      nonSystemMessages.push({ index: i });
    }
  }

  const recentMessages = nonSystemMessages.slice(-recentCount);
  for (const msg of recentMessages) {
    breakpoints.push({
      messageIndex: msg.index,
      type: 'ephemeral',
      ttlSeconds,
    });
  }

  return breakpoints;
}

/**
 * Estimate the token savings from caching.
 *
 * @param messages - The messages array.
 * @param breakpoints - The cache breakpoints.
 * @returns Estimated tokens saved.
 */
export function estimateTokenSavings(
  messages: Message[],
  breakpoints: CacheBreakpoint[],
): number {
  let savedChars = 0;
  for (const bp of breakpoints) {
    const msg = messages[bp.messageIndex];
    if (msg) {
      savedChars += msg.content.length;
      if (msg.thinking) savedChars += msg.thinking.length;
    }
  }
  // Rough: 4 chars per token
  return Math.ceil(savedChars / 4);
}

/**
 * Check if a message should have cache_control attached.
 *
 * @param messageIndex - The message index.
 * @param breakpoints - The cache breakpoints.
 * @returns True if the message should be cached.
 */
export function shouldCache(
  messageIndex: number,
  breakpoints: CacheBreakpoint[],
): boolean {
  return breakpoints.some((bp) => bp.messageIndex === messageIndex);
}
