'use client';

import { motion } from 'framer-motion';
import { ShieldQuestion, Check, X, Loader2 } from 'lucide-react';
import * as React from 'react';

import type { TranscriptItem } from '@/lib/types';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface PermissionPromptProps {
  item: TranscriptItem;
  onDecide: (toolCallId: string, decision: 'allow' | 'deny') => void;
}

/**
 *
 */
export function PermissionPrompt({ item, onDecide }: PermissionPromptProps) {
  const decided = item.decision && item.decision !== 'pending';
  const [busy, setBusy] = React.useState(false);

  const handle = (decision: 'allow' | 'deny') => {
    if (decided || busy) return;
    setBusy(true);
    onDecide(item.toolCallId!, decision);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="ml-10"
    >
      <div
        className={cn(
          'overflow-hidden rounded-xl border bg-card text-xs shadow-sm',
          decided
            ? item.decision === 'allow'
              ? 'border-emerald-500/40'
              : 'border-destructive/40'
            : 'border-amber-500/40',
        )}
      >
        <div
          className={cn(
            'flex items-center gap-2 px-3 py-2',
            decided ? '' : 'bg-amber-500/5',
          )}
        >
          <span
            className={cn(
              'inline-flex size-5 shrink-0 items-center justify-center rounded',
              decided
                ? item.decision === 'allow'
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'bg-destructive/10 text-destructive'
                : 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
            )}
          >
            {busy ? (
              <Loader2 className="size-3 animate-spin" aria-hidden />
            ) : decided ? (
              item.decision === 'allow' ? (
                <Check className="size-3" aria-hidden />
              ) : (
                <X className="size-3" aria-hidden />
              )
            ) : (
              <ShieldQuestion className="size-3" aria-hidden />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] font-medium text-foreground">
                {item.toolName ?? 'tool'}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {decided
                  ? item.decision === 'allow'
                    ? '· approved'
                    : '· denied'
                  : '· permission required'}
              </span>
            </div>
            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {item.summary}
            </div>
          </div>
        </div>

        {!decided && (
          <div className="flex items-center justify-end gap-2 border-t border-border bg-background/40 px-3 py-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => handle('deny')}
              disabled={busy}
            >
              <X className="size-3" aria-hidden />
              Deny
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => handle('allow')}
              disabled={busy}
            >
              <Check className="size-3" aria-hidden />
              Allow
            </Button>
          </div>
        )}
      </div>
    </motion.div>
  );
}
