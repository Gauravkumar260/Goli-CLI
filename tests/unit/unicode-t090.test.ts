/**
 * Tests for T-090: Unicode code-point utilities.
 *
 * Covers:
 *   - toCodePoints() converts strings to code point arrays
 *   - toCodePoints() handles emoji (surrogate pairs → 1 code point)
 *   - toCodePoints() handles CJK characters
 *   - cpLen() returns code point count (not UTF-16 code unit count)
 *   - cpLen() returns 1 for emoji
 *   - cpSlice() slices by code point index
 *   - cpSlice() handles emoji correctly (no broken surrogates)
 *   - cpAt() returns the code point at an index
 *   - displayWidth() returns 1 for ASCII
 *   - displayWidth() returns 2 for CJK
 *   - displayWidth() returns 2 for emoji
 *   - displayWidth() returns 0 for combining marks
 *   - isCombiningMark() detects combining diacritics
 *   - isWideChar() detects CJK
 *   - isWideChar() detects emoji
 *   - cpMoveLeft() moves cursor left by one code point
 *   - cpMoveRight() moves cursor right by one code point
 */

import { describe, it, expect } from 'vitest';

import {
  toCodePoints,
  cpLen,
  cpSlice,
  cpAt,
  displayWidth,
  isCombiningMark,
  isWideChar,
  cpMoveLeft,
  cpMoveRight,
} from '../../packages/cli/src/tui/lib/unicode.js';

// ─── toCodePoints() ─────────────────────────────────────────────────

describe('T-090: toCodePoints()', () => {
  it('converts ASCII strings to code point arrays', () => {
    expect(toCodePoints('abc')).toEqual([0x61, 0x62, 0x63]);
  });

  it('converts emoji to single code points (not surrogate pairs)', () => {
    // 😀 = U+1F600 (1 code point, but 2 UTF-16 code units)
    expect(toCodePoints('😀')).toEqual([0x1F600]);
  });

  it('handles mixed ASCII + emoji', () => {
    expect(toCodePoints('a😀b')).toEqual([0x61, 0x1F600, 0x62]);
  });

  it('handles CJK characters', () => {
    // 你好 = U+4F60, U+597D
    expect(toCodePoints('你好')).toEqual([0x4F60, 0x597D]);
  });

  it('returns empty array for empty string', () => {
    expect(toCodePoints('')).toEqual([]);
  });
});


// ─── cpLen() ────────────────────────────────────────────────────────

describe('T-090: cpLen()', () => {
  it('returns 3 for "abc"', () => {
    expect(cpLen('abc')).toBe(3);
  });

  it('returns 1 for a single emoji', () => {
    // "😀".length === 2 (UTF-16), but cpLen === 1 (1 code point)
    expect('😀'.length).toBe(2); // confirm the problem
    expect(cpLen('😀')).toBe(1);  // confirm the fix
  });

  it('returns 3 for "a😀b" (3 code points)', () => {
    expect(cpLen('a😀b')).toBe(3);
  });

  it('returns 0 for empty string', () => {
    expect(cpLen('')).toBe(0);
  });

  it('returns 2 for CJK "你好"', () => {
    expect(cpLen('你好')).toBe(2);
  });
});


// ─── cpSlice() ──────────────────────────────────────────────────────

describe('T-090: cpSlice()', () => {
  it('slices ASCII by code point index', () => {
    expect(cpSlice('abcde', 1, 4)).toBe('bcd');
  });

  it('slices through emoji without breaking surrogates', () => {
    // "a😀b" sliced [0, 2] should give "a😀" (2 code points)
    expect(cpSlice('a😀b', 0, 2)).toBe('a😀');
  });

  it('slices from start to end when end is omitted', () => {
    expect(cpSlice('a😀b', 1)).toBe('😀b');
  });

  it('handles slice at emoji boundary', () => {
    expect(cpSlice('😀😀', 1)).toBe('😀');
  });
});


// ─── cpAt() ─────────────────────────────────────────────────────────

describe('T-090: cpAt()', () => {
  it('returns the character at a code-point index', () => {
    expect(cpAt('abc', 0)).toBe('a');
    expect(cpAt('abc', 1)).toBe('b');
  });

  it('returns emoji at code-point index', () => {
    expect(cpAt('a😀b', 1)).toBe('😀');
  });

  it('returns undefined for out-of-bounds index', () => {
    expect(cpAt('abc', 5)).toBeUndefined();
  });
});


// ─── displayWidth() ─────────────────────────────────────────────────

describe('T-090: displayWidth()', () => {
  it('returns 3 for "abc" (1 column each)', () => {
    expect(displayWidth('abc')).toBe(3);
  });

  it('returns 2 for a single emoji (wide character)', () => {
    expect(displayWidth('😀')).toBe(2);
  });

  it('returns 4 for "你好" (2 wide chars × 2 columns)', () => {
    expect(displayWidth('你好')).toBe(4);
  });

  it('returns 0 for empty string', () => {
    expect(displayWidth('')).toBe(0);
  });

  it('returns 4 for "a😀b" (1 + 2 + 1)', () => {
    expect(displayWidth('a😀b')).toBe(4);
  });

  it('returns 0 for a combining mark alone', () => {
    // U+0301 = combining acute accent
    expect(displayWidth('\u0301')).toBe(0);
  });

  it('combining mark does not add width to preceding char', () => {
    // "e" + combining acute = "é" (1 display column, 2 code points)
    expect(displayWidth('e\u0301')).toBe(1);
  });
});


// ─── isCombiningMark() ──────────────────────────────────────────────

describe('T-090: isCombiningMark()', () => {
  it('returns true for U+0301 (combining acute)', () => {
    expect(isCombiningMark(0x0301)).toBe(true);
  });

  it('returns true for U+0300 (combining grave)', () => {
    expect(isCombiningMark(0x0300)).toBe(true);
  });

  it('returns false for regular ASCII', () => {
    expect(isCombiningMark(0x61)).toBe(false); // 'a'
  });

  it('returns false for emoji', () => {
    expect(isCombiningMark(0x1F600)).toBe(false);
  });
});


// ─── isWideChar() ───────────────────────────────────────────────────

describe('T-090: isWideChar()', () => {
  it('returns true for CJK ideograph', () => {
    expect(isWideChar(0x4F60)).toBe(true); // 你
  });

  it('returns true for emoji', () => {
    expect(isWideChar(0x1F600)).toBe(true); // 😀
  });

  it('returns true for fullwidth form', () => {
    expect(isWideChar(0xFF21)).toBe(true); // Ａ (fullwidth A)
  });

  it('returns false for ASCII', () => {
    expect(isWideChar(0x61)).toBe(false); // a
  });

  it('returns false for combining mark', () => {
    expect(isWideChar(0x0301)).toBe(false);
  });
});


// ─── cpMoveLeft() / cpMoveRight() ───────────────────────────────────

describe('T-090: cpMoveLeft() / cpMoveRight()', () => {
  it('cpMoveLeft moves left by one code point', () => {
    // "abc" at position 2 → position 1
    expect(cpMoveLeft('abc', 2)).toBe(1);
  });

  it('cpMoveLeft handles emoji (skips surrogate pair)', () => {
    // "a😀b" — cursor after emoji (position 3 in UTF-16) → position 1
    expect(cpMoveLeft('a😀b', 3)).toBe(1);
  });

  it('cpMoveLeft stops at 0', () => {
    expect(cpMoveLeft('abc', 0)).toBe(0);
  });

  it('cpMoveRight moves right by one code point', () => {
    expect(cpMoveRight('abc', 0)).toBe(1);
  });

  it('cpMoveRight handles emoji (advances by 2 UTF-16 units)', () => {
    // "a😀b" — cursor at 1 → should skip to 3 (past the emoji)
    expect(cpMoveRight('a😀b', 1)).toBe(3);
  });

  it('cpMoveRight stops at end of string', () => {
    expect(cpMoveRight('abc', 3)).toBe(3);
  });
});
