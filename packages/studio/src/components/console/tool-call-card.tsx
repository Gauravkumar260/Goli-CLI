'use client';

import { motion } from 'framer-motion';
import {
  ChevronRight,
  Loader2,
  Check,
  AlertTriangle,
} from 'lucide-react';
import * as React from 'react';

import type { TranscriptItem } from '@/lib/types';

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

interface ToolCallCardProps {
  item: TranscriptItem;
}

/**
 *
 */
export function ToolCallCard({ item }: ToolCallCardProps) {
  const [open, setOpen] = React.useState(false);
  const state = item.toolState ?? 'done';
  const input = item.toolInput ?? {};
  const inputJson = React.useMemo(() => JSON.stringify(input, null, 2), [input]);
  const result = item.toolResult;
  const resultContent = result?.content ?? '';

  // Auto-expand when there's an error, so the user sees what went wrong.
  React.useEffect(() => {
    if (state === 'error') setOpen(true);
  }, [state]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.16 }}
      className="ml-10"
    >
      <Collapsible
        open={open}
        onOpenChange={setOpen}
        className={cn(
          'overflow-hidden rounded-lg border bg-card/50 text-xs',
          state === 'error'
            ? 'border-destructive/40'
            : state === 'running'
              ? 'border-primary/40'
              : 'border-border',
        )}
      >
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className={cn(
              'flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-accent/50',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
          >
            <ChevronRight
              className={cn(
                'size-3.5 shrink-0 text-muted-foreground transition',
                open && 'rotate-90',
              )}
              aria-hidden
            />
            <span
              className={cn(
                'inline-flex size-5 shrink-0 items-center justify-center rounded',
                state === 'error'
                  ? 'bg-destructive/10 text-destructive'
                  : state === 'running'
                    ? 'bg-primary/10 text-primary'
                    : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
              )}
            >
              {state === 'running' ? (
                <Loader2 className="size-3 animate-spin" aria-hidden />
              ) : state === 'error' ? (
                <AlertTriangle className="size-3" aria-hidden />
              ) : (
                <Check className="size-3" aria-hidden />
              )}
            </span>
            <span className="font-mono text-[11px] font-medium text-foreground">
              {item.toolName ?? 'tool'}
            </span>
            <ToolArgsSummary name={item.toolName} input={input} />
            <span className="ml-auto text-[10px] text-muted-foreground">
              {state === 'running'
                ? 'running…'
                : state === 'error'
                  ? 'failed'
                  : 'done'}
            </span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t border-border bg-muted/30 px-3 py-2">
            <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Input
            </div>
            <pre className="goli-scroll overflow-x-auto rounded border border-border bg-background/80 p-2 text-[11px] leading-relaxed">
              <code>{inputJson}</code>
            </pre>

            {result && (
              <>
                <div className="mb-2 mt-3 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Result
                </div>
                <pre
                  className={cn(
                    'goli-scroll overflow-x-auto rounded border bg-background/80 p-2 text-[11px] leading-relaxed',
                    result.isError
                      ? 'border-destructive/40 text-destructive'
                      : 'border-border',
                  )}
                >
                  <code>{resultContent}</code>
                </pre>
              </>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </motion.div>
  );
}

function ToolArgsSummary({
  name,
  input,
}: {
  name?: string;
  input: Record<string, unknown>;
}) {
  let summary: string = '';
  if (name === 'read_file' || name === 'write_file' || name === 'edit_file') {
    summary = String(input.path ?? '');
  } else if (name === 'list_files') {
    summary = String(input.dir ?? '.');
  } else if (name === 'run_command') {
    summary = String(input.command ?? '');
  } else if (name === 'web_search') {
    summary = String(input.query ?? '');
  } else {
    // Generic: show first key=value pair.
    const k = Object.keys(input)[0];
    if (k) summary = `${k}=${String(input[k]).slice(0, 40)}`;
  }
  if (!summary) return null;
  return (
    <span className="min-w-0 truncate text-[11px] text-muted-foreground">
      <span className="text-muted-foreground/60">·</span> <span className="font-mono">{summary}</span>
    </span>
  );
}
