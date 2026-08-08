'use client';

import {
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  PanelRight,
  Command as CommandIcon,
  Sun,
  Moon,
  Sparkles,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import * as React from 'react';

import { ConnectionBadge } from './connection-badge';

import type { ConnectionStatus } from '@/lib/types';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface ConsoleHeaderProps {
  status: ConnectionStatus;
  onOpenSidebar: () => void;
  onNewSession: () => void;
  onToggleSidebar: () => void;
  sidebarCollapsed: boolean;
  onOpenSettings: () => void;
  onToggleFileBrowser: () => void;
  fileBrowserOpen: boolean;
  onOpenPalette: () => void;
}

/**
 *
 */
export function ConsoleHeader({
  status,
  onOpenSidebar,
  onNewSession,
  onToggleSidebar,
  sidebarCollapsed,
  onOpenSettings,
  onToggleFileBrowser,
  fileBrowserOpen,
  onOpenPalette,
}: ConsoleHeaderProps) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  return (
    <header className="sticky top-0 z-20 flex h-12 items-center gap-1 border-b border-border bg-background/80 px-2 backdrop-blur sm:px-3">
      {/* Mobile: open sidebar */}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0 md:hidden"
        onClick={onOpenSidebar}
        aria-label="Open sessions sidebar"
      >
        <Menu className="size-4" />
      </Button>

      {/* Desktop: collapse sidebar */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="hidden h-8 w-8 p-0 md:inline-flex"
            onClick={onToggleSidebar}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen className="size-4" />
            ) : (
              <PanelLeftClose className="size-4" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        </TooltipContent>
      </Tooltip>

      {/* New session */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={onNewSession}
            aria-label="New session"
          >
            <Plus className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">New session (⌘K)</TooltipContent>
      </Tooltip>

      {/* Command palette trigger */}
      <button
        type="button"
        onClick={onOpenPalette}
        className="ml-1 inline-flex h-8 items-center gap-2 rounded-md border border-border bg-muted/40 px-2 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
        aria-label="Open command palette"
      >
        <CommandIcon className="size-3.5" aria-hidden />
        <span className="hidden sm:inline">Command palette</span>
        <kbd className="hidden rounded border border-border bg-background px-1 py-0.5 font-mono text-[9px] sm:inline">⌘P</kbd>
      </button>

      <div className="ml-auto flex items-center gap-1">
        {/* Connection status */}
        <ConnectionBadge status={status} className="hidden sm:inline-flex" />

        {/* Theme toggle */}
        {mounted && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                aria-label="Toggle theme"
              >
                {theme === 'dark' ? (
                  <Sun className="size-4" />
                ) : (
                  <Moon className="size-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Toggle theme</TooltipContent>
          </Tooltip>
        )}

        {/* File browser toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={onToggleFileBrowser}
              aria-pressed={fileBrowserOpen}
              aria-label="Toggle file browser"
            >
              <PanelRight className={fileBrowserOpen ? 'size-4 text-primary' : 'size-4'} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Toggle file browser</TooltipContent>
        </Tooltip>

        {/* Settings */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={onOpenSettings}
              aria-label="Open settings"
            >
              <Settings className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Settings</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}

// Suppress unused import warning.
void Sparkles;
