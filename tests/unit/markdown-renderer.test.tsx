/**
 * Unit tests for T-040 — Basic Markdown rendering in agent messages.
 *
 * Verifies the four acceptance criteria from tasks.json:
 *  1. New module packages/cli/src/tui/lib/markdown.tsx with renderMarkdown.
 *  2. Supports: **bold**, *italic*, `inline code`, ```code blocks```,
 *     - bullet lists, 1. numbered lists, # headings.
 *  3. Code blocks get a distinct background color (border color).
 *  4. AgentMessage uses renderMarkdown for content.
 *
 * Comparison reference: gemini-cli renders tool output as markdown via
 * `marked` + custom renderer.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';

import { renderMarkdown } from '../../packages/cli/src/tui/lib/markdown.js';
import { AgentMessage } from '../../packages/cli/src/tui/components/messages/AgentMessage.js';
import type { Message } from '../../packages/cli/src/tui/state/types.js';

describe('T-040: renderMarkdown — headings (AC #2)', () => {
  it('renders # H1 heading', () => {
    const { lastFrame } = render(<>{renderMarkdown('# Hello World')}</>);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Hello World');
  });

  it('renders ## H2 subheading', () => {
    const { lastFrame } = render(<>{renderMarkdown('## Subsection')}</>);
    expect(lastFrame() ?? '').toContain('Subsection');
  });

  it('renders ### H3 subheading', () => {
    const { lastFrame } = render(<>{renderMarkdown('### Deep section')}</>);
    expect(lastFrame() ?? '').toContain('Deep section');
  });

  it('renders heading text without the leading #', () => {
    const { lastFrame } = render(<>{renderMarkdown('# Title')}</>);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Title');
    // The leading "# " should not appear as plain text in the output.
    // (It's consumed by the parser, not rendered as a literal.)
    expect(frame).not.toMatch(/^#\s/);
  });
});

describe('T-040: renderMarkdown — inline formatting (AC #2)', () => {
  it('renders **bold** text', () => {
    const { lastFrame } = render(<>{renderMarkdown('This is **bold** text')}</>);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('bold');
    // The ** markers should not appear in the output.
    expect(frame).not.toContain('**');
  });

  it('renders *italic* text', () => {
    const { lastFrame } = render(<>{renderMarkdown('This is *italic* text')}</>);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('italic');
    expect(frame).not.toMatch(/\*italic\*/);
  });

  it('renders `inline code` text', () => {
    const { lastFrame } = render(<>{renderMarkdown('Use `npm test` to run')}</>);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('npm test');
    // The backticks should not appear in the output.
    expect(frame).not.toContain('`npm test`');
  });

  it('renders mixed inline formatting in a single line', () => {
    const { lastFrame } = render(
      <>{renderMarkdown('Mix **bold** and *italic* and `code` end')}</>,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('bold');
    expect(frame).toContain('italic');
    expect(frame).toContain('code');
    expect(frame).toContain('end');
  });
});

describe('T-040: renderMarkdown — code blocks (AC #2, #3)', () => {
  it('renders a fenced code block', () => {
    const md = '```ts\nconst x = 1;\nconst y = 2;\n```';
    const { lastFrame } = render(<>{renderMarkdown(md)}</>);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('const x = 1;');
    expect(frame).toContain('const y = 2;');
  });

  it('shows the language label when provided', () => {
    const md = '```typescript\nconst x = 1;\n```';
    const { lastFrame } = render(<>{renderMarkdown(md)}</>);
    expect(lastFrame() ?? '').toContain('typescript');
  });

  it('renders code block without language when not specified', () => {
    const md = '```\nplain code\n```';
    const { lastFrame } = render(<>{renderMarkdown(md)}</>);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('plain code');
  });

  it('renders multi-line code blocks preserving all lines', () => {
    const md = '```\nline 1\nline 2\nline 3\n```';
    const { lastFrame } = render(<>{renderMarkdown(md)}</>);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('line 1');
    expect(frame).toContain('line 2');
    expect(frame).toContain('line 3');
  });
});

describe('T-040: renderMarkdown — bullet lists (AC #2)', () => {
  it('renders - bullet list', () => {
    const md = '- first\n- second\n- third';
    const { lastFrame } = render(<>{renderMarkdown(md)}</>);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('first');
    expect(frame).toContain('second');
    expect(frame).toContain('third');
  });

  it('renders * bullet list', () => {
    const md = '* alpha\n* beta';
    const { lastFrame } = render(<>{renderMarkdown(md)}</>);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('alpha');
    expect(frame).toContain('beta');
  });

  it('renders a bullet marker (•) for each item', () => {
    const md = '- one\n- two';
    const { lastFrame } = render(<>{renderMarkdown(md)}</>);
    const frame = lastFrame() ?? '';
    // The • character (U+2022) should appear at least twice.
    const bulletCount = (frame.match(/•/g) || []).length;
    expect(bulletCount).toBeGreaterThanOrEqual(2);
  });

  it('renders inline formatting inside bullet items', () => {
    const md = '- use **bold** here\n- and `code` there';
    const { lastFrame } = render(<>{renderMarkdown(md)}</>);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('bold');
    expect(frame).toContain('code');
    expect(frame).not.toContain('**');
    expect(frame).not.toContain('`code`');
  });
});

describe('T-040: renderMarkdown — ordered lists (AC #2)', () => {
  it('renders 1. 2. 3. numbered list', () => {
    const md = '1. first\n2. second\n3. third';
    const { lastFrame } = render(<>{renderMarkdown(md)}</>);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('first');
    expect(frame).toContain('second');
    expect(frame).toContain('third');
  });

  it('shows sequential numbers (1., 2., 3.) regardless of source numbering', () => {
    const md = '1. one\n1. two\n1. three';
    const { lastFrame } = render(<>{renderMarkdown(md)}</>);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('1.');
    expect(frame).toContain('2.');
    expect(frame).toContain('3.');
  });
});

describe('T-040: renderMarkdown — paragraphs and blanks', () => {
  it('renders a plain paragraph', () => {
    const { lastFrame } = render(<>{renderMarkdown('Just a paragraph.')}</>);
    expect(lastFrame() ?? '').toContain('Just a paragraph.');
  });

  it('renders multiple paragraphs separated by blank lines', () => {
    const md = 'First paragraph.\n\nSecond paragraph.';
    const { lastFrame } = render(<>{renderMarkdown(md)}</>);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('First paragraph.');
    expect(frame).toContain('Second paragraph.');
  });

  it('handles empty input', () => {
    const { lastFrame } = render(<>{renderMarkdown('')}</>);
    // Should render without throwing; output may be empty.
    expect(lastFrame()).toBeDefined();
  });
});

describe('T-040: renderMarkdown — mixed document', () => {
  it('renders a full markdown document with all constructs', () => {
    const md = [
      '# Title',
      '',
      'This is a paragraph with **bold** and `code`.',
      '',
      '## Subsection',
      '',
      '- bullet one',
      '- bullet two',
      '',
      '1. first',
      '2. second',
      '',
      '```ts',
      'const x: number = 42;',
      '```',
      '',
      'Final paragraph.',
    ].join('\n');

    const { lastFrame } = render(<>{renderMarkdown(md)}</>);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Title');
    expect(frame).toContain('bold');
    expect(frame).toContain('code');
    expect(frame).toContain('Subsection');
    expect(frame).toContain('bullet one');
    expect(frame).toContain('bullet two');
    expect(frame).toContain('first');
    expect(frame).toContain('second');
    expect(frame).toContain('const x: number = 42;');
    expect(frame).toContain('Final paragraph.');
  });
});

describe('T-040: AgentMessage uses renderMarkdown (AC #4)', () => {
  it('renders markdown in completed (non-streaming) agent messages', () => {
    const message: Message = {
      id: 'a1',
      type: 'agent',
      content: '# Heading\n\n**bold** text and `code`',
      timestamp: Date.now(),
      streaming: false,
      toolCalls: [],
    };
    const { lastFrame } = render(<AgentMessage message={message} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Heading');
    expect(frame).toContain('bold');
    expect(frame).toContain('code');
    // Markdown markers should be consumed, not rendered literally.
    expect(frame).not.toContain('**bold**');
    expect(frame).not.toContain('`code`');
  });

  it('renders plain text in streaming agent messages (no markdown parsing)', () => {
    const message: Message = {
      id: 'a2',
      type: 'agent',
      content: '# Heading\n\n**bold** in progress',
      timestamp: Date.now(),
      streaming: true,
      toolCalls: [],
    };
    const { lastFrame } = render(<AgentMessage message={message} />);
    const frame = lastFrame() ?? '';
    // During streaming, the raw markdown markers should appear (no parsing).
    // This prevents flicker as partial markdown constructs accumulate.
    expect(frame).toContain('# Heading');
    expect(frame).toContain('**bold**');
  });

  it('renders markdown after streaming completes (memoized on streaming flag)', () => {
    // This test verifies that the memo dependency on `message.streaming`
    // works: when streaming flips to false, the content is re-rendered
    // via renderMarkdown.
    const streamingMsg: Message = {
      id: 'a3',
      type: 'agent',
      content: '**partial',
      timestamp: Date.now(),
      streaming: true,
      toolCalls: [],
    };
    const { lastFrame, rerender } = render(<AgentMessage message={streamingMsg} />);
    expect(lastFrame() ?? '').toContain('**partial');

    const completedMsg: Message = {
      ...streamingMsg,
      content: '**completed**',
      streaming: false,
    };
    rerender(<AgentMessage message={completedMsg} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('completed');
    expect(frame).not.toContain('**completed**');
  });
});
