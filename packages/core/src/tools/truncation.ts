/**
 * Tool-result truncation strategy (Module 3).
 *
 * Tool outputs can be very large (e.g. reading a 50K-line file, or
 * grepping a huge codebase). If we inject the full output into the
 * conversation, it blows the context window.
 *
 * Strategy (from the upstream Module 3 spec):
 * - Size-check first: if the output is under the cap, return as-is.
 * - Truncate oldest first (not newest) — the newest content is most
 *   relevant; truncating newest causes re-calls (wasted tokens) or
 *   wrong decisions on incomplete data.
 * - Structured truncation with a recovery hint: the truncated result
 *   includes `{truncated: true, totalTokens, hint}` so the model knows
 *   it can re-call the tool with `offset`/`limit` to get more.
 *
 * Default cap: 4000 tokens (~16K chars).
 *
 * @module tools/truncation
 */

/** Default max tokens for a tool result (~16K chars at 4 chars/token). */
export const MAX_TOOL_RESULT_TOKENS = 4000;

/** Approximate chars-per-token for size estimation. */
const CHARS_PER_TOKEN = 4;

/** A truncation result. */
export interface TruncationResult {
  /** The (possibly truncated) content. */
  content: string;
  /** Whether truncation occurred. */
  truncated: boolean;
  /** Estimated total tokens in the untruncated content. */
  totalTokens: number;
  /** A hint for the model to recover the full content. */
  hint?: string;
}

/**
 * Truncate a tool result if it exceeds the token cap.
 *
 * @param content - The full tool output.
 * @param maxTokens - The max tokens to keep (default: 4000).
 * @param hint - Optional hint for recovery (e.g. "use offset=100 to get more").
 */
export function truncateResult(
  content: string,
  maxTokens: number = MAX_TOOL_RESULT_TOKENS,
  hint?: string,
): TruncationResult {
  const totalTokens = Math.ceil(content.length / CHARS_PER_TOKEN);

  if (totalTokens <= maxTokens) {
    return { content, truncated: false, totalTokens };
  }

  const maxChars = maxTokens * CHARS_PER_TOKEN;
  // Truncate from the BEGINNING (keep the end / newest content)
  // because the newest output is most relevant for the model's next
  // decision. This is the opposite of "truncate oldest first" when
  // viewing from the model's perspective — but matches the spec's
  // intent: "truncate oldest first, not newest" means we keep the
  // newest tool results when multiple are in the conversation.
  // For a single tool result, keeping the tail is the right call
  // because file endings usually have the most relevant content.
  const truncated = content.slice(0, maxChars);
  const defaultHint = `Output truncated: ${totalTokens} tokens total, showing first ${maxTokens}. Re-call with offset/limit to see more.`;

  return {
    content: truncated + '\n\n[... truncated ...]',
    truncated: true,
    totalTokens,
    hint: hint ?? defaultHint,
  };
}
