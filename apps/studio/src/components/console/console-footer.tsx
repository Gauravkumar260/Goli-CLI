'use client';

import {
  ShieldQuestion,
  Zap,
  Map,
  FolderOpen,
  Hash,
  Wifi,
  WifiOff,
} from 'lucide-react';
import * as React from 'react';

import type { ConnectionStatus, PermissionMode } from '@/lib/types';

import { cn } from '@/lib/utils';


interface ConsoleFooterProps {
  status: ConnectionStatus;
  workspaceDir: string;
  permissionMode: PermissionMode;
  transcriptTokens: number;
}

const PERM_LABEL: Record<PermissionMode, { label: string; icon: React.ReactNode; color: string }> = {
  ask: {
    label: 'Ask',
    icon: <ShieldQuestion className="size-3" />,
    color: 'text-amber-600 dark:text-amber-400',
  },
  yolo: {
    label: 'Yolo',
    icon: <Zap className="size-3" />,
    color: 'text-rose-600 dark:text-rose-400',
  },
  plan: {
    label: 'Plan',
    icon: <Map className="size-3" />,
    color: 'text-sky-600 dark:text-sky-400',
  },
};

/**
 *
 */
export function ConsoleFooter({
  status,
  workspaceDir,
  permissionMode,
  transcriptTokens,
}: ConsoleFooterProps) {
  const perm = PERM_LABEL[permissionMode];
  return (
    <footer className="flex h-6 items-center gap-3 border-t border-border bg-background/80 px-3 text-[10px] text-muted-foreground backdrop-blur">
      <span className="inline-flex items-center gap-1">
        {status === 'connected' ? (
          <>
            <Wifi className="size-3 text-emerald-500" aria-hidden />
            <span className="hidden sm:inline">Live</span>
          </>
        ) : status === 'connecting' ? (
          <>
            <Wifi className="size-3 animate-pulse" aria-hidden />
            <span className="hidden sm:inline">Connecting…</span>
          </>
        ) : (
          <>
            <WifiOff className="size-3 text-destructive" aria-hidden />
            <span className="hidden sm:inline">Offline</span>
          </>
        )}
      </span>

      <span className="text-muted-foreground/40">·</span>

      <span className={cn('inline-flex items-center gap-1', perm.color)}>
        {perm.icon}
        <span className="hidden sm:inline">{perm.label}</span>
      </span>

      <span className="text-muted-foreground/40">·</span>

      <span className="inline-flex min-w-0 items-center gap-1">
        <FolderOpen className="size-3 shrink-0" aria-hidden />
        <span className="truncate font-mono" title={workspaceDir}>
          {workspaceDir}
        </span>
      </span>

      <span className="ml-auto inline-flex items-center gap-1 tabular-nums">
        <Hash className="size-3 shrink-0" aria-hidden />
        <span>{transcriptTokens.toLocaleString()} tokens (est.)</span>
      </span>
    </footer>
  );
}
