/**
 * Tool-result truncation strategy (Module 3).
 *
 * Tool outputs can be very large (e.g. reading a 50K-line file, or
 * grepping a huge codebase). If we inject the full output into the
 * conversation, it blows the context window.
 *
 * Strategy (from the upstream Module 3 spec):
 * - Size-check first: if the output is under the cap, return as-is.
 * - Truncate from the tail (keep the head/first) — the beginning of
 *   tool output (file headers, command preamble) is typically the
 *   most structured and actionable part. Truncating the tail loses
 *   less-relevant trailing detail. Note: this contradicts the
 *   original spec's "keep newest" intent — see the BEHAVIOR-CHANGE
 *   proposal in the human-review ticket for the alternative.
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

// Industry rule of thumb for English/Latin text. Overestimates tokens for
// CJK and emoji-heavy content (which need ~2-3 chars/token); underestimates
// for highly repetitive code. Acceptable for a size CAP — precise token
// counting would require a tokenizer dependency.
/** Approximate chars-per-token for size estimation. */
const CHARS_PER_TOKEN = 4;

/** Marker appended to truncated content so the model knows data was lost. */
const TRUNCATION_MARKER = '\n\n[... truncated ...]';

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
  // Keep the HEAD (first maxChars) of the content. The hint message
  // below ("showing first") is consistent with this. The original
  // spec intended to keep the TAIL (newest), but the implementation
  // has always kept the head; the test suite (truncation.test.ts)
  // does not verify which portion is retained, so head-keeping is
  // the de facto contract. See human-review ticket for the
  // behavior-changing proposal to switch to tail-keeping.
  const truncated = content.slice(0, maxChars);
  const defaultHint = `Output truncated: ${totalTokens} tokens total, showing first ${maxTokens}. Re-call with offset/limit to see more.`;

  return {
    content: truncated + TRUNCATION_MARKER,
    truncated: true,
    totalTokens,
    hint: hint ?? defaultHint,
  };
}
