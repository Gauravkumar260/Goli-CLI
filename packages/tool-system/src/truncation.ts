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

/**
 * Estimate the number of "tokens" in a string.
 *
 * The previous implementation used a flat `chars / 4` ratio, which
 * badly underestimates token counts for CJK text (1 char ≈ 1 token)
 * and emoji (1 char ≈ 2-3 tokens). A 4000-char Chinese file was
 * estimated at 1000 tokens (under the 4000 cap), so it was NOT
 * truncated — but the real token count was ~4000, blowing the
 * context window.
 *
 * This estimator counts:
 *  - ASCII letters/digits/punctuation: 4 chars/token (English text).
 *  - CJK characters (BMP + Extension A): 1 char/token (per the
 *    cl100k_base tokenizer's behavior).
 *  - Emoji + astral-plane chars: 1 char ≈ 2 tokens.
 *
 * The estimate is conservative (slightly over-counts for mixed
 * content) so the cap trips earlier rather than later. Precise
 * counting would require a tokenizer dependency.
 *
 * @param s - The string to estimate.
 * @returns The estimated token count.
 */
export function estimateTokens(s: string): number {
  let tokens = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    // ASCII (0x00-0x7F): 4 chars/token.
    if (code < 0x80) {
      tokens += 0.25;
      continue;
    }
    // BMP CJK ranges (Chinese/Japanese/Korean): 1 char/token.
    //  - CJK Unified Ideographs:        0x4E00-0x9FFF
    //  - CJK Extension A:               0x3400-0x4DBF
    //  - CJK Compatibility Ideographs:  0xF900-0xFAFF
    //  - Hiragana / Katakana:           0x3040-0x30FF
    //  - Hangul Syllables:              0xAC00-0xD7AF
    if (
      (code >= 0x3400 && code <= 0x4DBF) ||
      (code >= 0x4E00 && code <= 0x9FFF) ||
      (code >= 0xF900 && code <= 0xFAFF) ||
      (code >= 0x3040 && code <= 0x30FF) ||
      (code >= 0xAC00 && code <= 0xD7AF)
    ) {
      tokens += 1;
      continue;
    }
    // Surrogate pair (emoji, astral-plane chars): count as 2 tokens
    // and skip the low surrogate.
    if (code >= 0xD800 && code <= 0xDBFF && i + 1 < s.length) {
      tokens += 2;
      i++; // skip low surrogate
      continue;
    }
    // Other BMP characters (Latin Extended, Cyrillic, etc.): ~2 chars/token.
    tokens += 0.5;
  }
  return Math.ceil(tokens);
}

/** Default max tokens for a tool result (~16K chars at 4 chars/token). */
export const MAX_TOOL_RESULT_TOKENS = 4000;

// Industry rule of thumb for English/Latin text. Overestimates tokens for
// CJK and emoji-heavy content (which need ~2-3 chars/token); underestimates
// for highly repetitive code. Acceptable for a size CAP — precise token
// counting would require a tokenizer dependency.
/**
 * Approximate chars-per-token for size estimation (English/Latin text).
 *
 * @deprecated Use {@link estimateTokens} for accurate CJK/emoji
 *   accounting. This constant is kept for backwards-compatibility
 *   with callers that compute their own char-based estimates.
 */
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
  // Use the CJK-aware estimator instead of the flat chars/4 ratio.
  // The previous implementation called `Math.ceil(content.length / 4)`,
  // which badly underestimated CJK/emoji-heavy content.
  const totalTokens = estimateTokens(content);

  if (totalTokens <= maxTokens) {
    return { content, truncated: false, totalTokens };
  }

  // We can't trivially convert `maxTokens` back to a char count for
  // CJK content (the ratio varies per character). We use a
  // conservative char budget: maxTokens * 4 (worst case = all ASCII).
  // For CJK-heavy content this means we MAY keep fewer chars than
  // strictly necessary — but the cap is a safety bound, not a precision
  // budget, so under-keeping is safe.
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  const truncated = content.slice(0, maxChars);
  const defaultHint = `Output truncated: ${totalTokens} tokens total, showing first ${maxTokens}. Re-call with offset/limit to see more.`;

  return {
    content: truncated + TRUNCATION_MARKER,
    truncated: true,
    totalTokens,
    hint: hint ?? defaultHint,
  };
}
