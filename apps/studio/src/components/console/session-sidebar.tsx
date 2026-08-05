'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  Search,
  MessageSquare,
  Trash2,
  Download,
  Pencil,
  Check,
  X,
  Sparkles,
} from 'lucide-react';
import * as React from 'react';

import type { SessionSummary, PermissionMode } from '@/lib/types';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface SessionSidebarProps {
  activeSessionId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onClear: () => void;
  onExport: (id: string) => void;
  isRunning: boolean;
}

interface SessionsResponse {
  sessions: SessionSummary[];
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const delta = now - d.getTime();
  const mins = Math.floor(delta / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const PERM_DOT: Record<PermissionMode, string> = {
  ask: 'bg-amber-500',
  yolo: 'bg-rose-500',
  plan: 'bg-sky-500',
};

/**
 *
 */
export function SessionSidebar({
  activeSessionId,
  onSelect,
  onNew,
  onClear,
  onExport,
  isRunning,
}: SessionSidebarProps) {
  const queryClient = useQueryClient();
  const [search, setSearch] = React.useState('');
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  const [renameValue, setRenameValue] = React.useState('');

  const { data, isLoading, error } = useQuery<SessionsResponse>({
    queryKey: ['sessions'],
    queryFn: async () => {
      const r = await fetch('/api/sessions', { headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error('Failed to load sessions');
      return r.json() as Promise<SessionsResponse>;
    },
    retry: 0,
    staleTime: 30_000,
  });

  const sessions = React.useMemo(() => {
    const all = data?.sessions ?? [];
    if (!search.trim()) return all;
    const q = search.toLowerCase();
    return all.filter(
      (s) =>
        s.title.toLowerCase().includes(q) || s.id.toLowerCase().includes(q),
    );
  }, [data, search]);

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const r = await fetch(`/api/sessions/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (r.ok) {
        await queryClient.invalidateQueries({ queryKey: ['sessions'] });
        if (id === activeSessionId) onNew();
      }
    } catch {
      /* ignore */
    }
  };

  const handleRenameStart = (s: SessionSummary, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingId(s.id);
    setRenameValue(s.title);
  };

  const handleRenameCommit = async (id: string) => {
    const title = renameValue.trim();
    setRenamingId(null);
    if (!title) return;
    try {
      await fetch(`/api/sessions/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      await queryClient.invalidateQueries({ queryKey: ['sessions'] });
    } catch {
      /* ignore */
    }
  };

  return (
    <aside className="flex h-full w-full flex-col bg-sidebar text-sidebar-foreground">
      {/* Brand row */}
      <div className="flex items-center gap-2 px-3 py-3">
        <span className="flex size-7 items-center justify-center rounded-md bg-gradient-to-br from-primary/80 to-primary text-primary-foreground shadow-sm">
          <Sparkles className="size-3.5" aria-hidden />
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold leading-tight">Goli Studio</div>
          <div className="truncate text-[10px] text-muted-foreground">Agentic coding console</div>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="ml-auto h-7 w-7 p-0"
          onClick={onNew}
          aria-label="New session"
          title="New session (⌘K)"
        >
          <Plus className="size-3.5" />
        </Button>
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search sessions…"
            className="h-8 rounded-lg bg-background pl-7 pr-2 text-xs"
            aria-label="Search sessions"
          />
        </div>
      </div>

      {/* Sessions list */}
      <div className="goli-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {isLoading ? (
          <div className="px-2 py-3 text-[11px] text-muted-foreground">Loading…</div>
        ) : error ? (
          <div className="px-2 py-3 text-[11px] text-muted-foreground">
            Couldn't load sessions.
          </div>
        ) : sessions.length === 0 ? (
          <div className="px-2 py-6 text-center text-[11px] text-muted-foreground">
            {search ? 'No matches.' : 'No sessions yet.'}
          </div>
        ) : (
          <ul className="flex flex-col gap-0.5">
            <AnimatePresence initial={false}>
              {sessions.map((s) => {
                const isActive = s.id === activeSessionId;
                const isRenaming = renamingId === s.id;
                return (
                  <motion.li
                    key={s.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.15 }}
                  >
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => !isRenaming && onSelect(s.id)}
                      onKeyDown={(e) => {
                        if (!isRenaming && (e.key === 'Enter' || e.key === ' ')) {
                          e.preventDefault();
                          onSelect(s.id);
                        }
                      }}
                      className={cn(
                        'group relative flex cursor-pointer flex-col gap-0.5 rounded-lg border border-transparent px-2.5 py-2 text-left transition',
                        isActive
                          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                          : 'hover:bg-sidebar-accent/60',
                      )}
                    >
                      <div className="flex items-center gap-1.5">
                        <MessageSquare
                          className={cn(
                            'size-3.5 shrink-0',
                            isActive ? 'text-primary' : 'text-muted-foreground',
                          )}
                          aria-hidden
                        />
                        {isRenaming ? (
                          <Input
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleRenameCommit(s.id);
                              } else if (e.key === 'Escape') {
                                setRenamingId(null);
                              }
                            }}
                            autoFocus
                            className="h-5 flex-1 rounded px-1 text-xs"
                          />
                        ) : (
                          <span className="min-w-0 flex-1 truncate text-xs font-medium">
                            {s.title || 'Untitled session'}
                          </span>
                        )}
                        <span
                          className={cn(
                            'size-1.5 shrink-0 rounded-full',
                            PERM_DOT[s.permissionMode as PermissionMode] ?? 'bg-muted-foreground',
                          )}
                          title={`Permission mode: ${s.permissionMode}`}
                          aria-hidden
                        />
                      </div>

                      {!isRenaming && (
                        <div className="flex items-center justify-between pl-5 text-[10px] text-muted-foreground">
                          <span className="truncate">{formatRelative(s.updatedAt)}</span>
                          <div className="flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                            <button
                              type="button"
                              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                              onClick={(e) => handleRenameStart(s, e)}
                              aria-label="Rename session"
                              title="Rename"
                            >
                              <Pencil className="size-3" />
                            </button>
                            <button
                              type="button"
                              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                              onClick={(e) => {
                                e.stopPropagation();
                                onExport(s.id);
                              }}
                              aria-label="Export transcript"
                              title="Export as Markdown"
                            >
                              <Download className="size-3" />
                            </button>
                            <button
                              type="button"
                              className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                              onClick={(e) => handleDelete(s.id, e)}
                              aria-label="Delete session"
                              title="Delete"
                            >
                              <Trash2 className="size-3" />
                            </button>
                          </div>
                        </div>
                      )}

                      {isRenaming && (
                        <div className="flex items-center justify-end gap-0.5 pl-5">
                          <button
                            type="button"
                            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRenameCommit(s.id);
                            }}
                            aria-label="Save name"
                          >
                            <Check className="size-3" />
                          </button>
                          <button
                            type="button"
                            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                            onClick={(e) => {
                              e.stopPropagation();
                              setRenamingId(null);
                            }}
                            aria-label="Cancel rename"
                          >
                            <X className="size-3" />
                          </button>
                        </div>
                      )}

                      {s.lastSnippet && !isRenaming && (
                        <div className="truncate pl-5 text-[10px] text-muted-foreground/80">
                          {s.lastSnippet}
                        </div>
                      )}
                    </div>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        )}
      </div>

      {/* Footer actions */}
      <div className="border-t border-sidebar-border px-2 py-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-xs text-muted-foreground"
          onClick={onClear}
          disabled={isRunning}
        >
          <Trash2 className="size-3.5" aria-hidden />
          Clear current transcript
        </Button>
      </div>
    </aside>
  );
}
