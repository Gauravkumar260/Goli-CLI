'use client';

import { Check, Copy } from 'lucide-react';
import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

import { cn } from '@/lib/utils';

interface MarkdownProps {
  children: string;
  className?: string;
}

/**
 * Markdown renderer for assistant messages with fenced code blocks +
 * syntax highlighting + copy-to-clipboard button on each code block.
 */
export function Markdown({ children, className }: MarkdownProps) {
  return (
    <div className={cn('prose-goli text-foreground/95', className)}>
      <ReactMarkdown
        components={{
          code(props) {
            const { className: cls, children: codeChildren, node: _node, ...rest } = props;
            const match = /language-(\w+)/.exec(cls || '');
            const isBlock = !!match || String(codeChildren).includes('\n');
            if (!isBlock) {
              return (
                <code className={cls} {...rest}>
                  {codeChildren}
                </code>
              );
            }
            const lang = match?.[1] ?? 'text';
            const code = String(codeChildren).replace(/\n$/, '');
            return <CodeBlock language={lang} value={code} />;
          },
          a(props) {
            return (
              <a
                {...props}
                target="_blank"
                rel="noreferrer noopener"
              >
                {props.children}
              </a>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

function CodeBlock({ language, value }: { language: string; value: string }) {
  const [copied, setCopied] = React.useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="group relative my-2 overflow-hidden rounded-lg border border-border bg-[#282c34]">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5">
        <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">
          {language}
        </span>
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-zinc-400 transition hover:bg-white/10 hover:text-zinc-100"
          aria-label="Copy code"
        >
          {copied ? (
            <>
              <Check className="size-3" aria-hidden /> Copied
            </>
          ) : (
            <>
              <Copy className="size-3" aria-hidden /> Copy
            </>
          )}
        </button>
      </div>
      <SyntaxHighlighter
        language={language}
        style={oneDark}
        customStyle={{
          margin: 0,
          background: 'transparent',
          fontSize: '0.8rem',
          padding: '0.75rem 0.9rem',
        }}
        codeTagProps={{
          style: { fontFamily: 'var(--font-geist-mono), ui-monospace, monospace' },
        }}
        wrapLongLines={false}
      >
        {value}
      </SyntaxHighlighter>
    </div>
  );
}
