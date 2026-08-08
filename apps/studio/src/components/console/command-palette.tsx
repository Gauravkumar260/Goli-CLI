'use client';

/**
 * Goli Studio — command palette (⌘P / ⌘K).
 *
 * A cmdk-powered quick-action menu. Opens with ⌘P (or ⌘K, which also fires
 * new-session for backward compat with the existing shortcut). Fuzzy-filtered
 * list of actions: new session, export, toggle file browser, open settings,
 * cycle permission mode, toggle theme, focus composer.
 */
import {
  Plus, Download, PanelRight, Settings as SettingsIcon, ShieldQuestion,
  Sun, MessageSquare, Keyboard, CornerDownLeft,
} from 'lucide-react';
import * as React from 'react';

import type { PermissionMode } from '@/lib/types';

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';


/**
 *
 */
export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNewSession: () => void;
  onExport: () => void;
  onToggleFileBrowser: () => void;
  onOpenSettings: () => void;
  onCyclePermissionMode: () => void;
  onToggleTheme: () => void;
  onFocusComposer: () => void;
  permissionMode: PermissionMode;
  fileBrowserOpen: boolean;
}

/**
 *
 */
export function CommandPalette({
  open,
  onOpenChange,
  onNewSession,
  onExport,
  onToggleFileBrowser,
  onOpenSettings,
  onCyclePermissionMode,
  onToggleTheme,
  onFocusComposer,
  permissionMode,
  fileBrowserOpen,
}: CommandPaletteProps) {
  const run = (fn: () => void) => () => {
    onOpenChange(false);
    fn();
  };

  const nextPerm: Record<PermissionMode, PermissionMode> = {
    ask: 'yolo',
    yolo: 'plan',
    plan: 'ask',
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 shadow-lg sm:max-w-[520px]">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <Command className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:size-4 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-2 [&_[cmdk-item]_svg]:size-4">
          <CommandInput placeholder="Type a command or search…" />
          <CommandList className="max-h-[360px]">
            <CommandEmpty>No results found.</CommandEmpty>

            <CommandGroup heading="Session">
              <CommandItem
                value="new session"
                onSelect={run(onNewSession)}
                keywords={['create', 'start']}
              >
                <Plus aria-hidden />
                <div className="flex-1">
                  <div>New session</div>
                  <div className="text-[10px] text-muted-foreground">Start a fresh conversation</div>
                </div>
                <KbdHint hint="⌘K" />
              </CommandItem>
              <CommandItem
                value="export transcript"
                onSelect={run(onExport)}
                keywords={['download', 'markdown', 'save']}
              >
                <Download aria-hidden />
                <div className="flex-1">
                  <div>Export transcript</div>
                  <div className="text-[10px] text-muted-foreground">Download as Markdown</div>
                </div>
              </CommandItem>
            </CommandGroup>

            <CommandSeparator />
            <CommandGroup heading="View">
              <CommandItem
                value="toggle file browser"
                onSelect={run(onToggleFileBrowser)}
                keywords={['files', 'panel', 'explorer', 'tree']}
              >
                <PanelRight aria-hidden />
                <div className="flex-1">
                  <div>{fileBrowserOpen ? 'Hide' : 'Show'} file browser</div>
                  <div className="text-[10px] text-muted-foreground">Workspace file tree panel</div>
                </div>
              </CommandItem>
              <CommandItem
                value="open settings"
                onSelect={run(onOpenSettings)}
                keywords={['preferences', 'config']}
              >
                <SettingsIcon aria-hidden />
                <div className="flex-1">
                  <div>Open settings</div>
                  <div className="text-[10px] text-muted-foreground">Permission mode, theme, demo</div>
                </div>
              </CommandItem>
              <CommandItem
                value="focus composer"
                onSelect={run(onFocusComposer)}
                keywords={['message', 'input', 'prompt', 'type']}
              >
                <MessageSquare aria-hidden />
                <div className="flex-1">
                  <div>Focus composer</div>
                  <div className="text-[10px] text-muted-foreground">Jump to the message box</div>
                </div>
                <KbdHint hint="⌘/" />
              </CommandItem>
            </CommandGroup>

            <CommandSeparator />
            <CommandGroup heading="Mode">
              <CommandItem
                value="permission mode"
                onSelect={run(onCyclePermissionMode)}
                keywords={['ask', 'yolo', 'plan', 'safety']}
              >
                <ShieldQuestion aria-hidden />
                <div className="flex-1">
                  <div>Cycle permission mode</div>
                  <div className="text-[10px] text-muted-foreground">
                    {permissionMode} → {nextPerm[permissionMode]}
                  </div>
                </div>
              </CommandItem>
              <CommandItem
                value="toggle theme"
                onSelect={run(onToggleTheme)}
                keywords={['dark', 'light', 'color', 'appearance']}
              >
                <Sun aria-hidden />
                <div className="flex-1">
                  <div>Toggle theme</div>
                  <div className="text-[10px] text-muted-foreground">Light / dark / system</div>
                </div>
              </CommandItem>
            </CommandGroup>
          </CommandList>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-border px-3 py-2 text-[10px] text-muted-foreground">
            <Keyboard className="size-3" aria-hidden />
            <span><Kbd>⌘K</Kbd> new session</span>
            <span><Kbd>⌘/</Kbd> focus</span>
            <span><Kbd>Esc</Kbd> cancel</span>
            <span><Kbd>⌘P</Kbd> palette</span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function KbdHint({ hint }: { hint: string }) {
  return (
    <span className="ml-auto shrink-0">
      <Kbd>{hint}</Kbd>
    </span>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="pointer-events-none inline-flex h-4 min-w-4 select-none items-center gap-0.5 rounded border border-border bg-muted px-1 font-mono text-[9px] font-medium text-muted-foreground">
      {children}
    </kbd>
  );
}

// Suppress unused import.
void CornerDownLeft;
