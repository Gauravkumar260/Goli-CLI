'use client';

import { Loader2, Wifi, WifiOff } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

interface ConnectionBadgeProps {
  status: 'connecting' | 'connected' | 'disconnected';
  className?: string;
}

/**
 *
 */
export function ConnectionBadge({
  status,
  className,
}: ConnectionBadgeProps) {
  if (status === 'connected') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400',
          className,
        )}
        title="Connected to the agent runtime"
      >
        <Wifi className="size-3" aria-hidden />
        Live
      </span>
    );
  }
  if (status === 'connecting') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground',
          className,
        )}
        title="Connecting to the agent runtime"
      >
        <Loader2 className="size-3 animate-spin" aria-hidden />
        Connecting
      </span>
    );
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive',
        className,
      )}
      title="Disconnected — backend unreachable"
    >
      <WifiOff className="size-3" aria-hidden />
      Offline
    </span>
  );
}
