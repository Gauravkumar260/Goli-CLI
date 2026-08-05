'use client';

import {
  Settings as SettingsIcon,
  ShieldQuestion,
  Zap,
  Map,
  Sun,
  Moon,
  FlaskConical,
  Trash2,
  FolderOpen,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import * as React from 'react';
import { toast } from 'sonner';

import type { PermissionMode } from '@/lib/types';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';


interface SettingsDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger?: React.ReactNode;
  permissionMode: PermissionMode;
  onPermissionModeChange: (m: PermissionMode) => void;
  mockMode: boolean;
  onMockModeChange: (v: boolean) => void;
  workspaceDir: string;
  onClear: () => void;
}

const PERM_OPTIONS: Array<{
  value: PermissionMode;
  label: string;
  icon: React.ReactNode;
  description: string;
}> = [
  {
    value: 'ask',
    label: 'Ask',
    icon: <ShieldQuestion className="size-4" />,
    description: 'Prompt before every mutating tool call.',
  },
  {
    value: 'yolo',
    label: 'Yolo',
    icon: <Zap className="size-4" />,
    description: 'Auto-approve every tool call. Use with caution.',
  },
  {
    value: 'plan',
    label: 'Plan',
    icon: <Map className="size-4" />,
    description: 'Plan-only mode — never run mutating tools.',
  },
];

/**
 *
 */
export function SettingsDrawer({
  open,
  onOpenChange,
  trigger,
  permissionMode,
  onPermissionModeChange,
  mockMode,
  onMockModeChange,
  workspaceDir,
  onClear,
}: SettingsDrawerProps) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {trigger}
      <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border px-5 py-4">
          <SheetTitle className="flex items-center gap-2 text-base">
            <SettingsIcon className="size-4" aria-hidden />
            Settings
          </SheetTitle>
          <SheetDescription className="text-xs">
            Configure how Goli runs in this console.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-6 px-5 py-5">
          {/* Permission mode */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Permission mode
            </h3>
            <div className="flex flex-col gap-1.5">
              {PERM_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onPermissionModeChange(opt.value)}
                  className={cn(
                    'flex items-start gap-3 rounded-lg border p-3 text-left transition',
                    permissionMode === opt.value
                      ? 'border-primary/40 bg-accent'
                      : 'border-border bg-card hover:bg-accent/50',
                  )}
                >
                  <span
                    className={cn(
                      'mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded',
                      permissionMode === opt.value
                        ? 'bg-primary/10 text-primary'
                        : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {opt.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{opt.label}</span>
                      {permissionMode === opt.value && (
                        <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary">
                          Active
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                      {opt.description}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>

          <Separator />

          {/* Appearance */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Appearance
            </h3>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3">
              <div className="flex items-center gap-2">
                {mounted && theme === 'dark' ? (
                  <Moon className="size-4 text-muted-foreground" />
                ) : (
                  <Sun className="size-4 text-muted-foreground" />
                )}
                <div>
                  <div className="text-sm font-medium">Dark mode</div>
                  <div className="text-[11px] text-muted-foreground">
                    {mounted && theme === 'dark' ? 'On' : 'Off'}
                  </div>
                </div>
              </div>
              <Switch
                checked={mounted && theme === 'dark'}
                onCheckedChange={(v) => setTheme(v ? 'dark' : 'light')}
                aria-label="Toggle dark mode"
              />
            </div>
          </section>

          <Separator />

          {/* Demo mode */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Demo mode
            </h3>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3">
              <div className="flex items-center gap-2">
                <FlaskConical className="size-4 text-amber-500" />
                <div>
                  <div className="text-sm font-medium">Run local simulator</div>
                  <div className="text-[11px] text-muted-foreground">
                    Use when the runtime is offline. Prompts run a mock agent.
                  </div>
                </div>
              </div>
              <Switch
                checked={mockMode}
                onCheckedChange={(v) => {
                  onMockModeChange(v);
                  if (v) {
                    toast.info('Demo mode is on. Prompts run a local simulator.');
                  } else {
                    toast.info('Demo mode is off. Reconnecting to the live runtime…');
                  }
                }}
                aria-label="Toggle demo mode"
              />
            </div>
          </section>

          <Separator />

          {/* Workspace */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Workspace
            </h3>
            <div className="rounded-lg border border-border bg-card p-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <FolderOpen className="size-4 text-muted-foreground" />
                Sandbox root
              </div>
              <div
                className="mt-2 truncate rounded border border-border bg-muted px-2 py-1.5 font-mono text-[11px] text-foreground"
                title={workspaceDir}
              >
                {workspaceDir}
              </div>
              <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
                All file tool calls are confined to this directory. Paths
                outside are rejected.
              </p>
            </div>
          </section>

          <Separator />

          {/* Danger zone */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-destructive">
              Danger zone
            </h3>
            <div className="rounded-lg border border-destructive/30 bg-destructive/[0.03] p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Trash2 className="size-4 text-destructive" />
                  <div>
                    <div className="text-sm font-medium">Clear transcript</div>
                    <div className="text-[11px] text-muted-foreground">
                      Removes the current conversation from view (server copy
                      is preserved).
                    </div>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    onClear();
                    onOpenChange(false);
                    toast.success('Transcript cleared.');
                  }}
                >
                  Clear
                </Button>
              </div>
            </div>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
