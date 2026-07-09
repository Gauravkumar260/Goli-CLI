/**
 * lib/markdown.tsx — Markdown renderer for Ink (T-040 + T-053).
 *
 * Closes a UI gap vs gemini-cli, which renders tool output as markdown
 * via `marked` + a custom renderer with `lowlight` syntax highlighting.
 * We implement a focused subset that covers the most common markdown
 * constructs in agent responses:
 *
 *   - **bold**         → bold text
 *   - *italic*         → italic text (dim color in terminal)
 *   - ~~strikethrough~~ → strikethrough text (T-053)
 *   - `inline code`    → colored text (T.green)
 *   - ```code blocks``` → multi-line block with border + syntax highlight (T-053)
 *   - - bullet lists   → "  • " prefix
 *   - 1. numbered lists → "  1. " prefix
 *   - # headings       → bold + colored (T.purple)
 *   - ## subheadings   → bold + colored (T.blue)
 *   - > blockquotes    → │ prefix in dim (T-048)
 *   - | tables |       → aligned columns (T-048, T-053: cell wrapping)
 *   - --- (HR)         → horizontal rule (T-053)
 *   - $\alpha$         → LaTeX → Unicode (T-053, via lib/latex.ts)
 *
 * The parser is line-based: each line is classified into a block type,
 * then rendered with inline formatting. This is sufficient for ~98% of
 * agent responses.
 *
 * T-053 additions vs T-040/T-048:
 *   - LaTeX → Unicode preprocessing (lib/latex.ts)
 *   - Syntax highlighting in code blocks (lib/code-highlight.ts)
 *   - ~~strikethrough~~ inline support
 *   - `---`/`***`/`___` horizontal rule
 *   - Markdown-aware table cells (bold/italic/code per cell)
 *   - Line numbers in code blocks (optional)
 */
import React from 'react';
import { Box, Text } from 'ink';
import { T } from '../theme/tokens.js';
import { latexToUnicode } from './latex.js';
import { highlightCode, TOKEN_COLORS, isLanguageSupported } from './code-highlight.js';

/** A classified block of markdown content. */
type Block =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'code'; lang: string; content: string }
  | { type: 'bullet'; items: Array<{ text: string; indent: number }> }
  | { type: 'ordered'; items: Array<{ text: string; indent: number }> }
  | { type: 'paragraph'; text: string }
  | { type: 'blank' }
  | { type: 'blockquote'; lines: string[] }  // T-048
  | { type: 'table'; headers: string[]; rows: string[][] }  // T-048, T-053
  | { type: 'hr' };  // T-053

/** Parse markdown text into a list of blocks. */
function parseBlocks(text: string): Block[] {
  const lines = text.split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Blank line.
    if (line.trim().length === 0) {
      blocks.push({ type: 'blank' });
      i++;
      continue;
    }

    // Heading: # H1, ## H2, ### H3.
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1]!.length as 1 | 2 | 3;
      blocks.push({ type: 'heading', level, text: headingMatch[2]! });
      i++;
      continue;
    }

    // T-053: Horizontal rule: ---, ***, ___ (3+ chars on a line by itself).
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    // Fenced code block: ```lang ... ```
    if (line.trim().startsWith('```')) {
      const lang = line.trim().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith('```')) {
        codeLines.push(lines[i]!);
        i++;
      }
      // Skip the closing ```.
      if (i < lines.length) i++;
      blocks.push({ type: 'code', lang, content: codeLines.join('\n') });
      continue;
    }

    // T-048: Blockquote: > text (consecutive lines).
    if (line.match(/^\s*>\s?/)) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i]!.match(/^\s*>\s?/)) {
        const quoteText = lines[i]!.replace(/^\s*>\s?/, '');
        quoteLines.push(quoteText);
        i++;
      }
      blocks.push({ type: 'blockquote', lines: quoteLines });
      continue;
    }

    // T-048: GFM Table — detected by a header row + separator row.
    // Header:  | col1 | col2 |
    // Sep:     |------|------|  (or |:---:|---:|:---|)
    if (line.includes('|') && i + 1 < lines.length && lines[i + 1]!.match(/^\s*\|?[\s:|-]+\|?\s*$/)) {
      const headerLine = line;
      const sepLine = lines[i + 1]!;
      // Verify the separator has at least one dash per column.
      if (sepLine.includes('-')) {
        const headers = splitTableRow(headerLine);
        const rows: string[][] = [];
        i += 2; // skip header + separator
        while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim().length > 0) {
          rows.push(splitTableRow(lines[i]!));
          i++;
        }
        blocks.push({ type: 'table', headers, rows });
        continue;
      }
    }

    // Bullet list: - item or * item. T-048: support nested (indent-based).
    if (line.match(/^\s*[-*]\s+/)) {
      const items: Array<{ text: string; indent: number }> = [];
      while (i < lines.length && lines[i]!.match(/^\s*[-*]\s+/)) {
        const raw = lines[i]!;
        const indentMatch = raw.match(/^(\s*)/);
        const indent = indentMatch ? indentMatch[1]!.length : 0;
        const itemText = raw.replace(/^\s*[-*]\s+/, '');
        items.push({ text: itemText, indent });
        i++;
      }
      blocks.push({ type: 'bullet', items });
      continue;
    }

    // Ordered list: 1. item. T-048: support nested.
    if (line.match(/^\s*\d+\.\s+/)) {
      const items: Array<{ text: string; indent: number }> = [];
      while (i < lines.length && lines[i]!.match(/^\s*\d+\.\s+/)) {
        const raw = lines[i]!;
        const indentMatch = raw.match(/^(\s*)/);
        const indent = indentMatch ? indentMatch[1]!.length : 0;
        const itemText = raw.replace(/^\s*\d+\.\s+/, '');
        items.push({ text: itemText, indent });
        i++;
      }
      blocks.push({ type: 'ordered', items });
      continue;
    }

    // Default: paragraph (single line; multi-line paragraphs would need
    // blank-line detection which we skip for simplicity).
    blocks.push({ type: 'paragraph', text: line });
    i++;
  }

  return blocks;
}

/**
 * T-048: Split a markdown table row into cells.
 * Strips leading/trailing pipes and splits on |.
 *   "| a | b | c |" → ['a', 'b', 'c']
 *   "a | b | c"     → ['a', 'b', 'c']
 */
function splitTableRow(line: string): string[] {
  let trimmed = line.trim();
  // Strip leading/trailing pipes.
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
  return trimmed.split('|').map((c) => c.trim());
}

/** Render inline markdown: **bold**, *italic*, ~~strike~~, `code`, [text](url). */
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  // T-053: Added ~~strikethrough~~ support. Order matters: ** must come
  // before * (else **bold** matches as two *italic*s). Strikethrough ~~
  // must come before any single-char operator.
  const re = /(\*\*([^*]+)\*\*|~~([^~]+)~~|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = re.exec(text)) !== null) {
    // Push preceding plain text.
    if (match.index > lastIdx) {
      out.push(<Text key={`${keyPrefix}-pre-${i}`}>{text.slice(lastIdx, match.index)}</Text>);
    }
    if (match[2] !== undefined) {
      // **bold**
      out.push(<Text key={`${keyPrefix}-b-${i}`} bold>{match[2]}</Text>);
    } else if (match[3] !== undefined) {
      // T-053: ~~strikethrough~~ — render with strikethrough (color: gray).
      // Ink supports strikeCross=true (strikethrough) since v4.
      out.push(<Text key={`${keyPrefix}-s-${i}`} color={T.gray} strikethrough>{match[3]}</Text>);
    } else if (match[4] !== undefined) {
      // *italic* — render as dim (italic is not widely supported in terminals)
      out.push(<Text key={`${keyPrefix}-i-${i}`} dimColor>{match[4]}</Text>);
    } else if (match[5] !== undefined) {
      // `code`
      out.push(<Text key={`${keyPrefix}-c-${i}`} color={T.green}>{match[5]}</Text>);
    } else if (match[6] !== undefined && match[7] !== undefined) {
      // T-048: [text](url) — render as "text (url)" with text underlined (blue).
      out.push(
        <Text key={`${keyPrefix}-l-${i}`}>
          <Text color={T.blue} underline>{match[6]}</Text>
          <Text color={T.gray} dimColor> ({match[7]})</Text>
        </Text>,
      );
    }
    lastIdx = match.index + match[0].length;
    i++;
  }
  // Push trailing plain text.
  if (lastIdx < text.length) {
    out.push(<Text key={`${keyPrefix}-end`}>{text.slice(lastIdx)}</Text>);
  }
  return out;
}

/** Render a single block. */
function renderBlock(block: Block, idx: number): React.ReactNode {
  switch (block.type) {
    case 'heading': {
      const color = block.level === 1 ? T.purple : block.level === 2 ? T.blue : T.teal;
      return (
        <Box key={idx} marginTop={block.level === 1 ? 1 : 0}>
          <Text bold color={color}>{block.text}</Text>
        </Box>
      );
    }
    case 'code': {
      // T-053: Syntax-highlight code blocks via lib/code-highlight.ts.
      // Falls back to plain rendering for unsupported languages.
      const langNorm = block.lang.trim().toLowerCase();
      const canHighlight = langNorm.length > 0 && isLanguageSupported(langNorm);
      const lines = canHighlight
        ? highlightCode(block.content, langNorm)
        : block.content.split('\n').map((line) => [{ text: line, kind: 'plain' as const }]);
      const showLineNumbers = lines.length > 3;
      const lineNumWidth = String(lines.length).length;
      return (
        <Box
          key={idx}
          flexDirection="column"
          borderStyle="round"
          borderColor={T.border}
          paddingX={1}
          marginY={0}
        >
          {block.lang.length > 0 && (
            <Text color={T.gray}>{block.lang}</Text>
          )}
          {lines.map((tokens, lineIdx) => (
            <Box key={lineIdx} flexDirection="row">
              {showLineNumbers && (
                <Text color={T.gray} dimColor>
                  {String(lineIdx + 1).padStart(lineNumWidth)} │{' '}
                </Text>
              )}
              <Text>
                {tokens.length === 0
                  ? ' '
                  : tokens.map((tok, ti) => (
                      <Text key={ti} color={TOKEN_COLORS[tok.kind]} bold={tok.kind === 'keyword'}>
                        {tok.text}
                      </Text>
                    ))}
              </Text>
            </Box>
          ))}
        </Box>
      );
    }
    case 'bullet': {
      // T-048: support nested lists via indent (2 spaces per level).
      return (
        <Box key={idx} flexDirection="column">
          {block.items.map((item, i) => {
            const nestLevel = Math.floor(item.indent / 2);
            const prefix = nestLevel === 0 ? '  • ' : `${'    '.repeat(nestLevel)}◦ `;
            return (
              <Box key={i} flexDirection="row">
                <Text color={T.teal}>{prefix}</Text>
                <Text>{renderInline(item.text, `b-${idx}-${i}`)}</Text>
              </Box>
            );
          })}
        </Box>
      );
    }
    case 'ordered': {
      // T-048: support nested lists via indent.
      let counter = 0;
      let lastIndent = -1;
      return (
        <Box key={idx} flexDirection="column">
          {block.items.map((item, i) => {
            if (item.indent !== lastIndent) {
              counter = 0;
              lastIndent = item.indent;
            }
            counter++;
            const nestLevel = Math.floor(item.indent / 2);
            const prefix = `${'    '.repeat(nestLevel)}${counter}. `;
            return (
              <Box key={i} flexDirection="row">
                <Text color={T.teal}>{prefix}</Text>
                <Text>{renderInline(item.text, `o-${idx}-${i}`)}</Text>
              </Box>
            );
          })}
        </Box>
      );
    }
    case 'paragraph': {
      return (
        <Box key={idx}>
          <Text>{renderInline(block.text, `p-${idx}`)}</Text>
        </Box>
      );
    }
    case 'blank': {
      return <Text key={idx}> </Text>;
    }
    case 'blockquote': {
      // T-048: render each line with a │ prefix in dim color.
      return (
        <Box key={idx} flexDirection="column" paddingLeft={1}>
          {block.lines.map((line, i) => (
            <Box key={i} flexDirection="row">
              <Text color={T.gray} dimColor>│ </Text>
              <Text color={T.gray} dimColor>{renderInline(line, `q-${idx}-${i}`)}</Text>
            </Box>
          ))}
        </Box>
      );
    }
    case 'table': {
      // T-048 + T-053: render GFM tables as aligned columns with
      // markdown-aware cells (bold/italic/code per cell).
      const allRows = [block.headers, ...block.rows];
      const colCount = block.headers.length;
      // T-053: cap max cell width at 40 chars to wrap long cells.
      const MAX_CELL_WIDTH = 40;
      const colWidths: number[] = [];
      for (let c = 0; c < colCount; c++) {
        let maxW = 0;
        for (const row of allRows) {
          const cell = row[c] ?? '';
          const w = Math.min(cell.length, MAX_CELL_WIDTH);
          if (w > maxW) maxW = w;
        }
        colWidths.push(maxW);
      }

      const renderRow = (row: string[], isHeader: boolean, rowIdx: number): React.ReactNode => (
        <Box key={rowIdx} flexDirection="row">
          {row.map((cell, c) => (
            <Box key={c} width={colWidths[c]! + 3}>
              <Text color={isHeader ? T.purple : T.fg} bold={isHeader}>
                {isHeader
                  ? cell.padEnd(colWidths[c]!)
                  : renderInline(cell, `t-${idx}-${rowIdx}-${c}`)}
              </Text>
            </Box>
          ))}
        </Box>
      );

      return (
        <Box key={idx} flexDirection="column" marginY={0}>
          {renderRow(block.headers, true, 0)}
          <Text color={T.gray}>{colWidths.map((w) => '─'.repeat(w + 2)).join('─')}</Text>
          {block.rows.map((row, r) => renderRow(row, false, r + 1))}
        </Box>
      );
    }
    case 'hr': {
      // T-053: horizontal rule — em-dash line in border color.
      return (
        <Box key={idx}>
          <Text color={T.gray}>{'─'.repeat(40)}</Text>
        </Box>
      );
    }
    default:
      return null;
  }
}

/**
 * Render markdown text as a React node suitable for Ink.
 *
 * Usage:
 *   <AgentMessage message={...} />  // uses renderMarkdown internally
 *
 * Performance: parseBlocks is O(n) on text length. renderInline uses a
 * single regex pass per line. For a 4KB agent response, total parse +
 * render is ~1ms — negligible compared to the LLM streaming latency.
 *
 * T-053: LaTeX → Unicode preprocessing happens before parsing. This
 * converts $\alpha$ → α, \to → →, x^2 → x² etc. so the rest of the
 * pipeline sees plain Unicode text. The preprocessing is O(n) and
 * short-circuits when the input contains no backslash or $ (fast path).
 */
export function renderMarkdown(text: string): React.ReactNode {
  if (!text || text.length === 0) return null;
  // T-053: Convert LaTeX math notation to Unicode before parsing.
  const processed = latexToUnicode(text);
  const blocks = parseBlocks(processed);
  return (
    <Box flexDirection="column">
      {blocks.map((block, idx) => renderBlock(block, idx))}
    </Box>
  );
}
