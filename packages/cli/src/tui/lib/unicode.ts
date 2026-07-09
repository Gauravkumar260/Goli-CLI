/**
 * lib/unicode.ts — Unicode code-point utilities for PromptInput (T-090).
 *
 * Reference: gemini-cli's `text-buffer.ts` uses code-point-based cursor
 * positioning (`toCodePoints`, `cpLen`, `cpSlice`) to handle emoji,
 * combining marks, and CJK correctly. JavaScript's `string.length` and
 * `string.slice()` operate on UTF-16 code units, which breaks for:
 *
 *   - Emoji: "😀".length === 2 (surrogate pair), but displays as 1 column
 *   - CJK: Most CJK chars are 1 code point but 1 display column
 *   - Combining marks: "é" can be 1 code point (U+00E9) or 2 (e + U+0301)
 *
 * This module provides code-point-based alternatives so the cursor moves
 * correctly through text containing these characters.
 *
 * @module lib/unicode
 */

/**
 * Convert a string to an array of Unicode code points (as numbers).
 *
 * "abc" → [0x61, 0x62, 0x63]
 * "😀"  → [0x1F600]  (not [0xD83D, 0xDE00] like [...str] would give)
 * "é"   → [0xE9] or [0x65, 0x301] depending on normalization
 */
export function toCodePoints(str: string): number[] {
  const result: number[] = [];
  for (const cp of str) {
    result.push(cp.codePointAt(0) ?? 0);
  }
  return result;
}

/**
 * Get the number of Unicode code points in a string.
 * "abc".length === 3, cpLen("abc") === 3
 * "😀".length === 2, cpLen("😀") === 1
 */
export function cpLen(str: string): number {
  let count = 0;
  for (const _ of str) count++;
  return count;
}

/**
 * Slice a string by code-point index (not UTF-16 code unit index).
 *
 * cpSlice("a😀b", 0, 2) → "a😀"  (2 code points)
 * "a😀b".slice(0, 2)    → "a\uD83D" (broken surrogate pair!)
 */
export function cpSlice(str: string, start: number, end?: number): string {
  const chars = [...str];
  if (end === undefined) {
    return chars.slice(start).join('');
  }
  return chars.slice(start, end).join('');
}

/**
 * Get the code point at a given code-point index.
 */
export function cpAt(str: string, index: number): string | undefined {
  const chars = [...str];
  return chars[index];
}

/**
 * Estimate the display width of a string in terminal columns.
 *
 * This is a heuristic:
 *   - Most code points = 1 column
 *   - CJK ideographs, full-width forms, emoji = 2 columns
 *   - Combining marks = 0 columns (they modify the preceding char)
 *
 * For a full implementation, use the `string-width` npm package or
 * Unicode East Asian Width tables. This heuristic covers the common cases.
 */
export function displayWidth(str: string): number {
  let width = 0;
  const codePoints = toCodePoints(str);
  for (let i = 0; i < codePoints.length; i++) {
    const cp = codePoints[i]!;
    // Combining marks (U+0300–U+036F, U+1AB0–U+1AFF, etc.) = 0 width
    if (isCombiningMark(cp)) continue;
    // East Asian Wide / Fullwidth ranges (simplified)
    if (isWideChar(cp)) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

/**
 * Check if a code point is a combining mark (zero display width).
 */
export function isCombiningMark(cp: number): boolean {
  return (
    (cp >= 0x0300 && cp <= 0x036F) ||  // Combining Diacritical Marks
    (cp >= 0x1AB0 && cp <= 0x1AFF) ||  // Combining Diacritical Marks Extended
    (cp >= 0x1DC0 && cp <= 0x1DFF) ||  // Combining Diacritical Marks Supplement
    (cp >= 0x20D0 && cp <= 0x20FF) ||  // Combining Diacritical Marks for Symbols
    (cp >= 0xFE20 && cp <= 0xFE2F)     // Combining Half Marks
  );
}

/**
 * Check if a code point is a "wide" character (2 display columns).
 * Covers CJK ideographs, full-width forms, and most emoji.
 */
export function isWideChar(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115F) ||  // Hangul Jamo
    (cp >= 0x2E80 && cp <= 0x303E) ||  // CJK Radicals, Kangxi
    (cp >= 0x3040 && cp <= 0x33BF) ||  // Hiragana, Katakana, CJK symbols
    (cp >= 0x3400 && cp <= 0x4DBF) ||  // CJK Unified Ideographs Extension A
    (cp >= 0x4E00 && cp <= 0x9FFF) ||  // CJK Unified Ideographs
    (cp >= 0xA000 && cp <= 0xA4CF) ||  // Yi Syllables
    (cp >= 0xAC00 && cp <= 0xD7A3) ||  // Hangul Syllables
    (cp >= 0xF900 && cp <= 0xFAFF) ||  // CJK Compatibility Ideographs
    (cp >= 0xFE30 && cp <= 0xFE4F) ||  // CJK Compatibility Forms
    (cp >= 0xFF00 && cp <= 0xFF60) ||  // Fullwidth Forms
    (cp >= 0xFFE0 && cp <= 0xFFE6) ||  // Fullwidth Signs
    (cp >= 0x1F300 && cp <= 0x1F9FF) || // Emoji (Misc Symbols & Pictographs, etc.)
    (cp >= 0x1FA00 && cp <= 0x1FAFF)    // Emoji Extension A
  );
}

/**
 * Move a code-point cursor left by one code point.
 * Handles surrogate pairs correctly (skips the trail surrogate).
 */
export function cpMoveLeft(str: string, cursorPos: number): number {
  if (cursorPos <= 0) return 0;
  // Use code-point iteration to step back one.
  const chars = [...str.slice(0, cursorPos)];
  return cursorPos - (chars[chars.length - 1]?.length ?? 1);
}

/**
 * Move a code-point cursor right by one code point.
 */
export function cpMoveRight(str: string, cursorPos: number): number {
  const chars = [...str];
  if (cursorPos >= chars.join('').length) return str.length;
  // Find the next code point boundary after cursorPos.
  const before = str.slice(0, cursorPos);
  const remaining = str.slice(cursorPos);
  const nextChar = [...remaining][0] ?? '';
  return cursorPos + nextChar.length;
}
