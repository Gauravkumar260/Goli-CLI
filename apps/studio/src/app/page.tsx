'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTheme } from 'next-themes';
import * as React from 'react';
import { toast } from 'sonner';

import type { PermissionMode } from '@/lib/types';

import { ChatTranscript } from '@/components/console/chat-transcript';
import { CommandPalette } from '@/components/console/command-palette';
import { Composer } from '@/components/console/composer';
import { ConsoleFooter } from '@/components/console/console-footer';
import { ConsoleHeader } from '@/components/console/console-header';
import { FileBrowserPanel } from '@/components/console/file-browser-panel';
import { SessionSidebar } from '@/components/console/session-sidebar';
import { SettingsDrawer } from '@/components/console/settings-drawer';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { useAgentStream } from '@/hooks/use-agent-stream';
import { newSessionId } from '@/lib/id';
import { cn } from '@/lib/utils';

const DEFAULT_WORKSPACE_DIR = '/home/z/my-project/workspace';

/**
 *
 */
export default function Home() {
  const [sessionId, setSessionId] = React.useState<string>(() => newSessionId());
  const [permissionMode, setPermissionMode] =
    React.useState<PermissionMode>('ask');
  const [composer, setComposer] = React.useState('');
  const [mobileSidebarOpen, setMobileSidebarOpen] = React.useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [fileBrowserOpen, setFileBrowserOpen] = React.useState(false);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const { theme, setTheme } = useTheme();

  // Best-effort fetch of the workspace dir; degrades to the default if the
  // API route isn't reachable.
  const { data: workspaceData } = useQuery<{ workspaceDir?: string }>({
    queryKey: ['workspace'],
    queryFn: async () => {
      const r = await fetch('/api/workspace', {
        headers: { Accept: 'application/json' },
      });
      if (!r.ok) throw new Error('no workspace endpoint');
      return (await r.json()) as { workspaceDir?: string };
    },
    retry: 0,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const workspaceDir = workspaceData?.workspaceDir ?? DEFAULT_WORKSPACE_DIR;

  const agent = useAgentStream({
    sessionId,
    workspaceDir,
    permissionMode,
    systemPreamble: '',
  });

  // Surface agent errors as toasts.
  React.useEffect(() => {
    const last = agent.transcript[agent.transcript.length - 1];
    if (last && last.kind === 'error') {
      toast.error(last.text ?? 'Agent error');
    }
  }, [agent.transcript]);

  // Composer can send when connected and not currently running.
  const canSend = agent.status === 'connected' && !agent.isRunning;

  const handleSend = () => {
    const trimmed = composer.trim();
    if (!trimmed) return;
    if (!canSend) return;
    agent.send(trimmed);
    setComposer('');
  };

  const handlePickExample = (prompt: string) => {
    setComposer(prompt);
  };

  const handleExport = (id: string) => {
    const url = `/api/sessions/${encodeURIComponent(id)}/export`;
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast.success('Exporting transcript as Markdown…');
  };

  // Regenerate: find the last user prompt and re-send it.
  const handleRegenerate = () => {
    if (agent.isRunning) return;
    for (let i = agent.transcript.length - 1; i >= 0; i--) {
      const it = agent.transcript[i];
      if (it.kind === 'user' && it.text && it.text.trim().length > 0) {
        agent.clear();
        agent.send(it.text.trim());
        return;
      }
    }
    toast.error('No user prompt found to regenerate from.');
  };

  const handleNewSession = () => {
    setSessionId(newSessionId());
    agent.clear();
    setComposer('');
    setMobileSidebarOpen(false);
  };

  const handleSelectSession = (id: string) => {
    if (id === sessionId) {
      setMobileSidebarOpen(false);
      return;
    }
    setSessionId(id);
    setComposer('');
    setMobileSidebarOpen(false);
    agent.loadHistory(id);
  };

  // Refresh the sidebar sessions list whenever a run completes.
  const queryClient = useQueryClient();
  const prevRunningRef = React.useRef(false);
  React.useEffect(() => {
    if (prevRunningRef.current && !agent.isRunning) {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    }
    prevRunningRef.current = agent.isRunning;
  }, [agent.isRunning, queryClient]);

  // Keyboard shortcuts (global).
  //   ⌘/Ctrl + K  → new session
  //   ⌘/Ctrl + P  → command palette
  //   ⌘/Ctrl + /  → focus the composer
  //   Esc         → cancel a running agent (when not typing in a field)
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        handleNewSession();
        return;
      }
      if (mod && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (mod && e.key === '/') {
        e.preventDefault();
        const ta = document.querySelector<HTMLTextAreaElement>(
          '[data-composer-input]',
        );
        ta?.focus();
        return;
      }
      if (e.key === 'Escape' && agent.isRunning) {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName?.toLowerCase();
        if (tag !== 'input' && tag !== 'textarea') {
          e.preventDefault();
          agent.cancel();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [agent.isRunning, agent.cancel]);

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground">
      <div className="flex min-h-0 flex-1">
        {/* Desktop sidebar (collapsible) */}
        <div
          className={cn(
            'hidden shrink-0 transition-[width] duration-200 ease-in-out md:block',
            sidebarCollapsed ? 'w-0' : 'w-64',
          )}
          aria-hidden={sidebarCollapsed}
        >
          <div
            className={cn(
              'h-full',
              sidebarCollapsed && 'pointer-events-none opacity-0',
            )}
          >
            <SessionSidebar
              activeSessionId={sessionId}
              onSelect={handleSelectSession}
              onNew={handleNewSession}
              onClear={agent.clear}
              onExport={handleExport}
              isRunning={agent.isRunning}
            />
          </div>
        </div>

        {/* Mobile sidebar (Sheet) */}
        <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
          <SheetContent side="left" className="w-72 p-0 sm:max-w-xs">
            <SheetTitle className="sr-only">Sessions</SheetTitle>
            <SessionSidebar
              activeSessionId={sessionId}
              onSelect={handleSelectSession}
              onNew={handleNewSession}
              onClear={agent.clear}
              onExport={handleExport}
              isRunning={agent.isRunning}
            />
          </SheetContent>
        </Sheet>

        {/* Main column + file browser panel */}
        <div className="relative flex min-w-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <ConsoleHeader
              status={agent.status}
              onOpenSidebar={() => setMobileSidebarOpen(true)}
              onNewSession={handleNewSession}
              onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
              sidebarCollapsed={sidebarCollapsed}
              onOpenSettings={() => setSettingsOpen(true)}
              onToggleFileBrowser={() => setFileBrowserOpen((v) => !v)}
              fileBrowserOpen={fileBrowserOpen}
              onOpenPalette={() => setPaletteOpen(true)}
            />

            <main
              className="flex min-h-0 flex-1 flex-col"
              aria-label="Agent transcript"
            >
              <ChatTranscript
                items={agent.transcript}
                onPickExample={handlePickExample}
                onPermissionDecide={agent.respondToPermission}
                onRegenerate={!agent.isRunning ? handleRegenerate : undefined}
                isLoadingHistory={agent.isLoadingHistory}
              />

              {agent.status !== 'connected' ? (
                <div className="border-t border-border bg-muted/30 px-4 py-2.5 text-center sm:px-6">
                  <p className="text-xs text-muted-foreground">
                    {agent.status === 'connecting'
                      ? 'Connecting to the agent runtime…'
                      : 'Not connected. Wait for the runtime to come back online.'}
                  </p>
                </div>
              ) : null}

              <Composer
                value={composer}
                onChange={setComposer}
                onSend={handleSend}
                onCancel={agent.cancel}
                isRunning={agent.isRunning}
                canSend={canSend}
                permissionMode={permissionMode}
                onPermissionModeChange={setPermissionMode}
                workspaceDir={workspaceDir}
              />
            </main>
          </div>

          {/* File browser panel (desktop only) */}
          <FileBrowserPanel
            open={fileBrowserOpen}
            onOpenChange={setFileBrowserOpen}
            onInsertPath={(p) => {
              setComposer((prev) => {
                const trimmed = prev.trim();
                if (!trimmed) return `@${p}`;
                return prev.endsWith(' ') ? prev + `@${p}` : prev + ` @${p}`;
              });
              const ta = document.querySelector<HTMLTextAreaElement>(
                '[data-composer-input]',
              );
              ta?.focus();
            }}
          />
        </div>
      </div>

      <ConsoleFooter
        status={agent.status}
        workspaceDir={workspaceDir}
        permissionMode={permissionMode}
        transcriptTokens={React.useMemo(
          () =>
            agent.transcript.reduce(
              (sum, it) =>
                sum +
                Math.ceil(
                  ((it.text ?? '') + (it.toolResult?.content ?? '')).length / 4,
                ),
              0,
            ),
          [agent.transcript],
        )}
      />

      <SettingsDrawer
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        trigger={<></>}
        permissionMode={permissionMode}
        onPermissionModeChange={setPermissionMode}
        workspaceDir={workspaceDir}
        onClear={agent.clear}
      />

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onNewSession={handleNewSession}
        onExport={() => handleExport(sessionId)}
        onToggleFileBrowser={() => setFileBrowserOpen((v) => !v)}
        onOpenSettings={() => setSettingsOpen(true)}
        onCyclePermissionMode={() => {
          setPermissionMode((m) =>
            m === 'ask' ? 'yolo' : m === 'yolo' ? 'plan' : 'ask',
          );
        }}
        onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        onFocusComposer={() => {
          const ta = document.querySelector<HTMLTextAreaElement>(
            '[data-composer-input]',
          );
          ta?.focus();
        }}
        permissionMode={permissionMode}
        fileBrowserOpen={fileBrowserOpen}
      />
    </div>
  );
}
