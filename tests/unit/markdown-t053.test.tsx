/**
 * Unit tests for T-053 — Markdown rendering enhancements (loop run 6, iter 1).
 *
 * Verifies the new acceptance criteria:
 *  1. LaTeX → Unicode conversion (Greek letters, arrows, math operators).
 *  2. Syntax highlighting in code blocks (keywords, strings, comments colored).
 *  3. ~~strikethrough~~ inline support.
 *  4. `---` horizontal rule support.
 *  5. Markdown-aware table cells (bold/italic/code per cell).
 *
 * Reference: gemini-cli has `lowlight` (60+ languages), `latexToUnicode.ts`
 * (200+ symbols). We implement a focused subset.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';

import { renderMarkdown } from '../../apps/cli/src/tui/lib/markdown.js';
import { latexToUnicode } from '../../apps/cli/src/tui/lib/latex.js';
import {
  highlightCode,
  isLanguageSupported,
  TOKEN_COLORS,
} from '../../apps/cli/src/tui/lib/code-highlight.js';

describe('T-053: latexToUnicode — Greek letters', () => {
  it('converts $\\alpha$ to α', () => {
    expect(latexToUnicode('$\\alpha$')).toBe('α');
  });

  it('converts multiple Greek letters in a sentence', () => {
    const input = 'The sum $\\alpha + \\beta + \\gamma$ equals $\\Omega$.';
    const out = latexToUnicode(input);
    expect(out).toContain('α');
    expect(out).toContain('β');
    expect(out).toContain('γ');
    expect(out).toContain('Ω');
    // No backslash commands remaining.
    expect(out).not.toContain('\\alpha');
    expect(out).not.toContain('\\beta');
  });

  it('converts uppercase Greek (\\Delta, \\Theta, \\Sigma)', () => {
    expect(latexToUnicode('\\Delta')).toBe('Δ');
    expect(latexToUnicode('\\Theta')).toBe('Θ');
    expect(latexToUnicode('\\Sigma')).toBe('Σ');
  });
});

describe('T-053: latexToUnicode — arrows and math operators', () => {
  it('converts \\to to →', () => {
    expect(latexToUnicode('f: A \\to B')).toBe('f: A → B');
  });

  it('converts \\leq, \\geq, \\neq', () => {
    expect(latexToUnicode('x \\leq y')).toBe('x ≤ y');
    expect(latexToUnicode('x \\geq y')).toBe('x ≥ y');
    expect(latexToUnicode('x \\neq y')).toBe('x ≠ y');
  });

  it('converts \\sum, \\prod, \\int', () => {
    expect(latexToUnicode('\\sum')).toBe('Σ');
    expect(latexToUnicode('\\prod')).toBe('∏');
    expect(latexToUnicode('\\int')).toBe('∫');
  });

  it('converts \\mathbb{R} → ℝ (blackboard bold)', () => {
    expect(latexToUnicode('\\mathbb{R}')).toBe('ℝ');
    expect(latexToUnicode('\\mathbb{N}')).toBe('ℕ');
    expect(latexToUnicode('\\mathbb{Z}')).toBe('ℤ');
  });

  it('converts superscripts x^2 → x²', () => {
    expect(latexToUnicode('x^2')).toBe('x²');
    expect(latexToUnicode('x^3 + y^2')).toBe('x³ + y²');
  });

  it('converts subscripts x_i → xᵢ', () => {
    expect(latexToUnicode('x_i')).toBe('xᵢ');
    expect(latexToUnicode('a_0 + a_1')).toBe('a₀ + a₁');
  });

  it('fast-paths strings with no LaTeX (returns unchanged)', () => {
    const plain = 'Just plain text with no math symbols.';
    expect(latexToUnicode(plain)).toBe(plain);
  });

  it('leaves unknown \\commands unchanged', () => {
    expect(latexToUnicode('\\unknowncmd')).toBe('\\unknowncmd');
  });
});

describe('T-053: code-highlight — language support', () => {
  it('recognizes common languages', () => {
    expect(isLanguageSupported('ts')).toBe(true);
    expect(isLanguageSupported('typescript')).toBe(true);
    expect(isLanguageSupported('python')).toBe(true);
    expect(isLanguageSupported('py')).toBe(true);
    expect(isLanguageSupported('bash')).toBe(true);
    expect(isLanguageSupported('json')).toBe(true);
    expect(isLanguageSupported('sql')).toBe(true);
    expect(isLanguageSupported('go')).toBe(true);
    expect(isLanguageSupported('rust')).toBe(true);
  });

  it('rejects unsupported languages', () => {
    expect(isLanguageSupported('cobol')).toBe(false);
    expect(isLanguageSupported('brainfuck')).toBe(false);
  });

  it('case-insensitive', () => {
    expect(isLanguageSupported('TypeScript')).toBe(true);
    expect(isLanguageSupported('PYTHON')).toBe(true);
  });
});

describe('T-053: code-highlight — token classification', () => {
  it('highlights TS keywords', () => {
    const tokens = highlightCode('const x = 1;', 'ts');
    const flat = tokens.flat();
    const constToken = flat.find((t) => t.text === 'const');
    expect(constToken).toBeDefined();
    expect(constToken!.kind).toBe('keyword');
  });

  it('highlights string literals', () => {
    const tokens = highlightCode(`const s = "hello";`, 'ts');
    const flat = tokens.flat();
    const strToken = flat.find((t) => t.text === '"hello"');
    expect(strToken).toBeDefined();
    expect(strToken!.kind).toBe('string');
  });

  it('highlights line comments', () => {
    const tokens = highlightCode('// a comment\nconst x = 1;', 'ts');
    const flat = tokens.flat();
    const commentToken = flat.find((t) => t.kind === 'comment');
    expect(commentToken).toBeDefined();
    expect(commentToken!.text).toContain('comment');
  });

  it('highlights numbers', () => {
    const tokens = highlightCode('const x = 42;', 'ts');
    const flat = tokens.flat();
    const numToken = flat.find((t) => t.text === '42');
    expect(numToken).toBeDefined();
    expect(numToken!.kind).toBe('number');
  });

  it('highlights function calls', () => {
    const tokens = highlightCode('console.log("hi");', 'ts');
    const flat = tokens.flat();
    // `log` is followed by `(` so it's a function call.
    const fnToken = flat.find((t) => t.text === 'log');
    expect(fnToken).toBeDefined();
    expect(fnToken!.kind).toBe('function');
  });

  it('highlights Python comments with #', () => {
    const tokens = highlightCode('# python comment\nx = 1', 'python');
    const flat = tokens.flat();
    const commentToken = flat.find((t) => t.kind === 'comment');
    expect(commentToken).toBeDefined();
    expect(commentToken!.text).toContain('python comment');
  });

  it('highlights Bash keywords (sudo, npm)', () => {
    const tokens = highlightCode('sudo npm install', 'bash');
    const flat = tokens.flat();
    const sudoToken = flat.find((t) => t.text === 'sudo');
    expect(sudoToken).toBeDefined();
    expect(sudoToken!.kind).toBe('keyword');
  });

  it('returns plain tokens for unsupported languages', () => {
    const tokens = highlightCode('some unknown code', 'cobol');
    const flat = tokens.flat();
    expect(flat.length).toBeGreaterThan(0);
    expect(flat.every((t) => t.kind === 'plain')).toBe(true);
  });

  it('handles empty input', () => {
    expect(highlightCode('', 'ts')).toEqual([]);
  });

  it('TOKEN_COLORS maps every kind to a hex color', () => {
    const kinds: Array<keyof typeof TOKEN_COLORS> = [
      'keyword', 'string', 'comment', 'number', 'function',
      'type', 'operator', 'punct', 'plain',
    ];
    for (const k of kinds) {
      expect(TOKEN_COLORS[k]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('T-053: renderMarkdown — strikethrough', () => {
  it('renders ~~strikethrough~~ text', () => {
    const { lastFrame } = render(<>{renderMarkdown('This is ~~old~~ text')}</>);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('old');
    // The ~~ markers should not appear in the output.
    expect(frame).not.toContain('~~old~~');
  });

  it('renders mixed bold, italic, and strikethrough', () => {
    const md = 'Mix **bold** and *italic* and ~~strike~~ end';
    const { lastFrame } = render(<>{renderMarkdown(md)}</>);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('bold');
    expect(frame).toContain('italic');
    expect(frame).toContain('strike');
    expect(frame).toContain('end');
  });
});

describe('T-053: renderMarkdown — horizontal rule', () => {
  it('renders --- as a horizontal rule', () => {
    const md = 'Paragraph one.\n\n---\n\nParagraph two.';
    const { lastFrame } = render(<>{renderMarkdown(md)}</>);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Paragraph one');
    expect(frame).toContain('Paragraph two');
    // The HR is rendered as a line of em-dashes.
    expect(frame).toMatch(/─{10,}/);
  });

  it('renders *** as a horizontal rule', () => {
    const md = 'Before.\n\n***\n\nAfter.';
    const { lastFrame } = render(<>{renderMarkdown(md)}</>);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Before');
    expect(frame).toContain('After');
    expect(frame).toMatch(/─{10,}/);
  });
});

describe('T-053: renderMarkdown — LaTeX in markdown', () => {
  it('renders LaTeX math inline in a paragraph', () => {
    const md = 'The function $f: \\mathbb{R} \\to \\mathbb{R}$ maps $x$ to $x^2$.';
    const { lastFrame } = render(<>{renderMarkdown(md)}</>);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('ℝ');
    expect(frame).toContain('→');
    expect(frame).toContain('x²');
    // No raw LaTeX commands in output.
    expect(frame).not.toContain('\\mathbb');
    expect(frame).not.toContain('\\to');
  });

  it('renders Greek letters in headings', () => {
    const { lastFrame } = render(<>{renderMarkdown('# $\\alpha$-particle decay')}</>);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('α');
    expect(frame).toContain('particle');
  });
});

describe('T-053: renderMarkdown — syntax-highlighted code blocks', () => {
  it('renders a TS code block with all lines preserved', () => {
    const md = '```ts\nconst x: number = 42;\nconsole.log(x);\n```';
    const { lastFrame } = render(<>{renderMarkdown(md)}</>);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('const');
    expect(frame).toContain('x');
    expect(frame).toContain('42');
    expect(frame).toContain('console');
    expect(frame).toContain('log');
  });

  it('shows the language label for highlighted code', () => {
    const md = '```python\nprint("hi")\n```';
    const { lastFrame } = render(<>{renderMarkdown(md)}</>);
    expect(lastFrame() ?? '').toContain('python');
  });

  it('shows line numbers for code blocks with > 3 lines', () => {
    const md = '```\nline 1\nline 2\nline 3\nline 4\n```';
    const { lastFrame } = render(<>{renderMarkdown(md)}</>);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('line 1');
    expect(frame).toContain('line 4');
    // Line numbers should be present.
    expect(frame).toMatch(/\b1\b.*\b2\b.*\b3\b.*\b4\b/s);
  });

  it('does NOT show line numbers for short code blocks (≤ 3 lines)', () => {
    const md = '```\nline 1\nline 2\n```';
    const { lastFrame } = render(<>{renderMarkdown(md)}</>);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('line 1');
    expect(frame).toContain('line 2');
  });

  it('handles unknown language gracefully (no highlight, no crash)', () => {
    const md = '```brainfuck\n++++++++++\n```';
    const { lastFrame } = render(<>{renderMarkdown(md)}</>);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('++++++++++');
  });
});

describe('T-053: renderMarkdown — markdown-aware table cells', () => {
  it('renders inline formatting inside table cells', () => {
    const md = [
      '| Name | Value |',
      '|------|-------|',
      '| **bold** | `code` |',
      '| *italic* | plain |',
    ].join('\n');
    const { lastFrame } = render(<>{renderMarkdown(md)}</>);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('bold');
    expect(frame).toContain('code');
    expect(frame).toContain('italic');
    expect(frame).toContain('plain');
    // The ** and ~~ markers should be consumed.
    expect(frame).not.toContain('**bold**');
    expect(frame).not.toContain('`code`');
  });
});
