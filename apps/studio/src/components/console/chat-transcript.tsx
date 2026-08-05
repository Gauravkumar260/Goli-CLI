'use client';

import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowDown,
  AlertTriangle,
  Info,
  User as UserIcon,
  Loader2,
} from 'lucide-react';
import * as React from 'react';

import { EmptyState } from './empty-state';
import { PermissionPrompt } from './permission-prompt';
import { StreamingAssistantMessage } from './streaming-assistant-message';
import { ToolCallCard } from './tool-call-card';

import type { TranscriptItem } from '@/lib/types';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ChatTranscriptProps {
  items: TranscriptItem[];
  onPickExample: (prompt: string) => void;
  onPermissionDecide: (toolCallId: string, decision: 'allow' | 'deny') => void;
  onRegenerate?: () => void;
  isLoadingHistory?: boolean;
  className?: string;
}

/**
 *
 */
export function ChatTranscript({
  items,
  onPickExample,
  onPermissionDecide,
  onRegenerate,
  isLoadingHistory = false,
  className,
}: ChatTranscriptProps) {
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const bottomRef = React.useRef<HTMLDivElement | null>(null);
  const [atBottom, setAtBottom] = React.useState(true);

  const onScroll = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    setAtBottom(distance < 80);
  }, []);

  React.useEffect(() => {
    onScroll();
  }, [items, onScroll]);

  React.useEffect(() => {
    if (atBottom) {
      bottomRef.current?.scrollIntoView({ block: 'end' });
    }
  }, [items, atBottom]);

  const jumpToLatest = React.useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    setAtBottom(true);
  }, []);

  return (
    <div className={cn('relative min-h-0 flex-1', className)}>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="goli-scroll h-full w-full overflow-y-auto"
      >
        <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
          {isLoadingHistory ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" aria-hidden />
              <p className="text-xs">Loading session history…</p>
            </div>
          ) : items.length === 0 ? (
            <div className="flex min-h-[60vh] items-center justify-center">
              <EmptyState onPick={onPickExample} />
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              {items.map((it, idx) => {
                const isLastAssistant =
                  it.kind === 'assistant' && !it.streaming && idx === items.length - 1;
                return (
                  <TranscriptRow
                    key={it.id}
                    item={it}
                    onPermissionDecide={onPermissionDecide}
                    onRegenerate={
                      isLastAssistant && onRegenerate ? onRegenerate : undefined
                    }
                  />
                );
              })}
              <div ref={bottomRef} className="h-1 w-full" aria-hidden />
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {!atBottom && items.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.15 }}
            className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-3"
          >
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={jumpToLatest}
              className="pointer-events-auto h-8 gap-1.5 rounded-full border-border bg-background/95 px-3 text-xs shadow-md backdrop-blur"
              aria-label="Jump to latest message"
            >
              <ArrowDown className="size-3.5" aria-hidden />
              Jump to latest
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function TranscriptRow({
  item,
  onPermissionDecide,
  onRegenerate,
}: {
  item: TranscriptItem;
  onPermissionDecide: (toolCallId: string, decision: 'allow' | 'deny') => void;
  onRegenerate?: () => void;
}) {
  switch (item.kind) {
    case 'user':
      return <UserMessage item={item} />;
    case 'assistant':
      return <StreamingAssistantMessage item={item} onRegenerate={onRegenerate} />;
    case 'tool':
      return <ToolCallCard item={item} />;
    case 'permission':
      return <PermissionPrompt item={item} onDecide={onPermissionDecide} />;
    case 'error':
      return (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/[0.06] px-3 py-2 text-xs text-destructive"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <div className="flex-1">
            <div className="font-semibold">Agent error</div>
            <div className="mt-0.5 text-destructive/90">{item.text}</div>
          </div>
        </div>
      );
    case 'system':
      return (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <div className="flex-1">{item.text}</div>
        </div>
      );
    default:
      return null;
  }
}

function UserMessage({ item }: { item: TranscriptItem }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.16 }}
      className="flex w-full justify-end gap-3"
    >
      <div className="min-w-0 max-w-[85%] rounded-2xl rounded-tr-sm border border-border bg-card px-3.5 py-2.5 shadow-xs">
        <p className="whitespace-pre-wrap break-words text-sm text-foreground">
          {item.text}
        </p>
      </div>
      <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
        <UserIcon className="size-3.5" aria-hidden />
      </span>
    </motion.div>
  );
}
