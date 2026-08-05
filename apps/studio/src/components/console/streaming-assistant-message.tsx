'use client';

import { motion } from 'framer-motion';
import { Sparkles, RefreshCw } from 'lucide-react';
import * as React from 'react';


import { Markdown } from './markdown';

import type { TranscriptItem } from '@/lib/types';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface StreamingAssistantMessageProps {
  item: TranscriptItem;
  onRegenerate?: () => void;
}

/**
 *
 */
export function StreamingAssistantMessage({
  item,
  onRegenerate,
}: StreamingAssistantMessageProps) {
  const isStreaming = !!item.streaming;
  const text = item.text ?? '';
  const showCaret = isStreaming && text.length > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.16 }}
      className="group flex w-full gap-3"
    >
      <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-primary/30 bg-primary/10 text-primary">
        <Sparkles className="size-3.5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-xs font-semibold text-foreground">Goli</span>
          {isStreaming && (
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <span className="goli-pulse size-1.5 rounded-full bg-primary" aria-hidden />
              generating…
            </span>
          )}
        </div>
        {text.length === 0 && isStreaming ? (
          <div className="flex items-center gap-1.5 py-1">
            <span className="goli-pulse size-1.5 rounded-full bg-muted-foreground" aria-hidden />
            <span className="goli-pulse size-1.5 rounded-full bg-muted-foreground" style={{ animationDelay: '0.2s' }} aria-hidden />
            <span className="goli-pulse size-1.5 rounded-full bg-muted-foreground" style={{ animationDelay: '0.4s' }} aria-hidden />
            <span className="sr-only">Goli is thinking…</span>
          </div>
        ) : (
          <div className={cn('relative rounded-2xl rounded-tl-sm border border-border bg-card px-4 py-3 shadow-xs')}>
            <Markdown>{text}</Markdown>
            {showCaret && <span className="goli-caret text-primary" aria-hidden />}
          </div>
        )}

        {!isStreaming && onRegenerate && (
          <div className="mt-1.5 flex items-center gap-2 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
              onClick={onRegenerate}
            >
              <RefreshCw className="size-3" aria-hidden />
              Regenerate
            </Button>
          </div>
        )}
      </div>
    </motion.div>
  );
}
