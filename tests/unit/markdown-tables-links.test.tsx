/**
 * Unit tests for T-048 — Markdown tables + links + blockquotes + nested lists.
 *
 * Verifies the four acceptance criteria from tasks.json:
 *  1. renderMarkdown supports GFM tables (| col1 | col2 |).
 *  2. renderMarkdown supports [text](url) links.
 *  3. renderMarkdown supports > blockquotes.
 *  4. renderMarkdown supports nested lists (2-space indent).
 *  5. Tests verify each new construct.
 *
 * Comparison reference: gemini-cli uses marked which supports full GFM.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';

import { renderMarkdown } from '../../apps/cli/src/tui/lib/markdown.js';

describe('T-048: Markdown tables (AC #1)', () => {
  it('renders a simple 2-column table', () => {
    const md = [
      '| Name | Age |',
      '|------|-----|',
      '| Alice | 30 |',
      '| Bob | 25 |',
    ].join('\n');
    const { lastFrame } = render(<>{renderMarkdown(md)}</>);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Name');
    expect(frame).toContain('Age');
    expect(frame).toContain('Alice');
    expect(frame).toContain('Bob');
    expect(frame).toContain('30');
    expect(frame).toContain('25');
  });

  it('renders the separator line as dashes', () => {
    const md = '| A | B |\n|---|---|\n| 1 | 2 |';
    const { lastFrame } = render(<>{renderMarkdown(md)}</>);
    expect(lastFrame() ?? '').toContain('─');
  });

  it('handles tables without leading/trailing pipes', () => {
    const md = [
      'Name | Age',
      '-----|-----',
      'Alice | 30',
    ].join('\n');
    const { lastFrame } = render(<>{renderMarkdown(md)}</>);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Name');
    expect(frame).toContain('Alice');
  });

  it('handles 3-column tables', () => {
    const md = [
      '| A | B | C |',
      '|---|---|---|',
      '| 1 | 2 | 3 |',
      '| 4 | 5 | 6 |',
    ].join('\n');
    const { lastFrame } = render(<>{renderMarkdown(md)}</>);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('A');
    expect(frame).toContain('B');
    expect(frame).toContain('C');
    expect(frame).toContain('1');
    expect(frame).toContain('6');
  });

  it('does NOT treat a single pipe line as a table (needs separator)', () => {
    const md = '| not a table |';
    const { lastFrame } = render(<>{renderMarkdown(md)}</>);
    // Should render as a paragraph, not a table.
    expect(lastFrame() ?? '').toContain('not a table');
  });
});

describe('T-048: Markdown links (AC #2)', () => {
  it('renders [text](url) as text + (url)', () => {
    const md = 'See [docs](https://example.com) for info.';
    const { lastFrame } = render(<>{renderMarkdown(md)}</>);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('docs');
    expect(frame).toContain('https://example.com');
  });

  it('renders multiple links in one line', () => {
    const md = 'See [a](url-a) and [b](url-b).';
    const { lastFrame } = render(<>{renderMarkdown(md)}</>);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('a');
    expect(frame).toContain('url-a');
    expect(frame).toContain('b');
    expect(frame).toContain('url-b');
  });

  it('does not render raw [text](url) syntax', () => {
    const md = '[text](url)';
    const { lastFrame } = render(<>{renderMarkdown(md)}</>);
    const frame = lastFrame() ?? '';
    // The raw [text](url) should not appear; it should be parsed.
    expect(frame).not.toContain('[text](url)');
    expect(frame).toContain('text');
    expect(frame).toContain('url');
  });

  it('renders link inside a bullet item', () => {
    const md = '- see [docs](url)';
    const { lastFrame } = render(<>{renderMarkdown(md)}</>);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('docs');
    expect(frame).toContain('url');
  });
});

describe('T-048: Markdown blockquotes (AC #3)', () => {
  it('renders a single-line blockquote with │ prefix', () => {
    const md = '> This is a quote.';
    const { lastFrame } = render(<>{renderMarkdown(md)}</>);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('│');
    expect(frame).toContain('This is a quote.');
  });

  it('renders a multi-line blockquote', () => {
    const md = '> Line 1\n> Line 2\n> Line 3';
    const { lastFrame } = render(<>{renderMarkdown(md)}</>);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Line 1');
    expect(frame).toContain('Line 2');
    expect(frame).toContain('Line 3');
  });

  it('renders blockquote without the > marker', () => {
    const md = '> quoted text';
    const { lastFrame } = render(<>{renderMarkdown(md)}</>);
    const frame = lastFrame() ?? '';
    // The > should be consumed, not rendered literally.
    expect(frame).not.toMatch(/^>\s/);
  });

  it('renders inline formatting inside blockquotes', () => {
    const md = '> **bold** quote';
    const { lastFrame } = render(<>{renderMarkdown(md)}</>);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('bold');
    expect(frame).not.toContain('**');
  });
});

describe('T-048: Nested lists (AC #4)', () => {
  it('renders nested bullet lists with different markers', () => {
    const md = [
      '- top level',
      '  - nested',
      '- back to top',
    ].join('\n');
    const { lastFrame } = render(<>{renderMarkdown(md)}</>);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('top level');
    expect(frame).toContain('nested');
    expect(frame).toContain('back to top');
    // Top level uses •; nested uses ◦.
    expect(frame).toContain('•');
    expect(frame).toContain('◦');
  });

  it('renders deeply nested lists (3 levels)', () => {
    const md = [
      '- level 1',
      '  - level 2',
      '    - level 3',
    ].join('\n');
    const { lastFrame } = render(<>{renderMarkdown(md)}</>);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('level 1');
    expect(frame).toContain('level 2');
    expect(frame).toContain('level 3');
  });

  it('renders nested ordered lists with independent counters', () => {
    const md = [
      '1. first',
      '  1. nested-a',
      '  2. nested-b',
      '2. second',
    ].join('\n');
    const { lastFrame } = render(<>{renderMarkdown(md)}</>);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('first');
    expect(frame).toContain('nested-a');
    expect(frame).toContain('nested-b');
    expect(frame).toContain('second');
  });
});

describe('T-048: Mixed document with all new constructs', () => {
  it('renders a document with table + blockquote + link + nested list', () => {
    const md = [
      '# Documentation',
      '',
      'See [the docs](https://example.com) for more.',
      '',
      '> Important: read this carefully.',
      '> Second line of quote.',
      '',
      '## Comparison',
      '',
      '| Feature | Goli | Gemini |',
      '|---------|------|--------|',
      '| Themes  | 21   | 20     |',
      '| Vim     | yes  | yes    |',
      '',
      '- top',
      '  - nested item',
    ].join('\n');
    const { lastFrame } = render(<>{renderMarkdown(md)}</>);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Documentation');
    expect(frame).toContain('the docs');
    expect(frame).toContain('https://example.com');
    expect(frame).toContain('Important: read this carefully.');
    expect(frame).toContain('Comparison');
    expect(frame).toContain('Feature');
    expect(frame).toContain('Themes');
    expect(frame).toContain('21');
    expect(frame).toContain('Vim');
    expect(frame).toContain('top');
    expect(frame).toContain('nested item');
  });
});

describe('T-048: Backward compatibility — existing constructs still work', () => {
  it('headings still render', () => {
    const { lastFrame } = render(<>{renderMarkdown('# Title')}</>);
    expect(lastFrame() ?? '').toContain('Title');
  });

  it('code blocks still render', () => {
    const md = '```\ncode\n```';
    const { lastFrame } = render(<>{renderMarkdown(md)}</>);
    expect(lastFrame() ?? '').toContain('code');
  });

  it('inline bold still renders', () => {
    const { lastFrame } = render(<>{renderMarkdown('**bold**')}</>);
    expect(lastFrame() ?? '').toContain('bold');
  });

  it('flat bullet lists still render with •', () => {
    const md = '- a\n- b\n- c';
    const { lastFrame } = render(<>{renderMarkdown(md)}</>);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('a');
    expect(frame).toContain('b');
    expect(frame).toContain('c');
    expect(frame).toContain('•');
  });
});
