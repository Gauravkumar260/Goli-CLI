'use client';

import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowUp,
  Square,
  Paperclip,
  AtSign,
  Sparkles,
  ShieldQuestion,
  Zap,
  Map,
  ChevronDown,
  Loader2,
} from 'lucide-react';
import * as React from 'react';

import type { PermissionMode } from '@/lib/types';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

interface ComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onCancel?: () => void;
  isRunning: boolean;
  canSend: boolean;
  permissionMode: PermissionMode;
  onPermissionModeChange: (m: PermissionMode) => void;
  workspaceDir: string;
}

const MAX_TEXTAREA_HEIGHT = 240; // px

const PERMISSION_MODES: Array<{
  value: PermissionMode;
  label: string;
  icon: React.ReactNode;
  description: string;
}> = [
  {
    value: 'ask',
    label: 'Ask',
    icon: <ShieldQuestion className="size-3.5" />,
    description: 'Prompt before every mutating tool call.',
  },
  {
    value: 'yolo',
    label: 'Yolo',
    icon: <Zap className="size-3.5" />,
    description: 'Auto-approve every tool call (use with caution).',
  },
  {
    value: 'plan',
    label: 'Plan',
    icon: <Map className="size-3.5" />,
    description: 'Plan only — never run mutating tools.',
  },
];

/**
 *
 */
export function Composer({
  value,
  onChange,
  onSend,
  onCancel,
  isRunning,
  canSend,
  permissionMode,
  onPermissionModeChange,
  workspaceDir,
}: ComposerProps) {
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  // Auto-grow the textarea up to MAX_TEXTAREA_HEIGHT.
  React.useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends, Shift+Enter inserts newline (classic chat UX).
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (canSend) onSend();
    }
  };

  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const names = Array.from(files).map((f) => f.name);
    // Insert file references into the composer.
    onChange(
      `${value ? value + ' ' : ''}${names.map((n) => `@${n}`).join(' ')}`,
    );
    // Reset the input so the same file can be re-picked later.
    e.target.value = '';
    textareaRef.current?.focus();
  };

  const insertAtCursor = (snippet: string) => {
    const ta = textareaRef.current;
    if (!ta) {
      onChange(`${value}${snippet}`);
      return;
    }
    const start = ta.selectionStart ?? value.length;
    const end = ta.selectionEnd ?? value.length;
    const next = value.slice(0, start) + snippet + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + snippet.length;
      ta.setSelectionRange(pos, pos);
    });
  };

  const currentMode = PERMISSION_MODES.find((m) => m.value === permissionMode)!;
  const charCount = value.length;
  const charLimit = 16_000;
  const overLimit = charCount > charLimit;

  return (
    <div className="border-t border-border bg-background/95 backdrop-blur">
      <div className="mx-auto w-full max-w-3xl px-4 py-3 sm:px-6">
        <div
          className={cn(
            'group rounded-2xl border bg-card shadow-sm transition',
            'focus-within:border-primary/50 focus-within:shadow-md',
            overLimit
              ? 'border-destructive/50'
              : 'border-border hover:border-border/80',
          )}
        >
          {/* Textarea row */}
          <div className="flex items-end gap-2 px-3 pt-2.5">
            <textarea
              ref={textareaRef}
              data-composer-input
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              placeholder={`Message Goli…  (⌘/ to focus, ⏎ to send, ⇧⏎ for newline)\nWorkspace: ${truncate(workspaceDir, 50)}`}
              disabled={isRunning && !canSend}
              className={cn(
                'goli-scroll max-h-[240px] min-h-[44px] flex-1 resize-none bg-transparent py-2 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/70 focus:outline-none disabled:opacity-50',
              )}
              aria-label="Message composer"
            />
          </div>

          {/* Toolbar row */}
          <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-1">
            <div className="flex items-center gap-1">
              {/* Permission mode selector */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 gap-1.5 px-2 text-xs"
                    aria-label={`Permission mode: ${currentMode.label}`}
                  >
                    {currentMode.icon}
                    <span className="hidden sm:inline">{currentMode.label}</span>
                    <ChevronDown className="size-3 opacity-60" aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64">
                  <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Permission mode
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {PERMISSION_MODES.map((m) => (
                    <DropdownMenuItem
                      key={m.value}
                      onClick={() => onPermissionModeChange(m.value)}
                      className="flex items-start gap-2 py-2"
                    >
                      <span
                        className={cn(
                          'mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded',
                          m.value === permissionMode
                            ? 'bg-primary/10 text-primary'
                            : 'bg-muted text-muted-foreground',
                        )}
                      >
                        {m.icon}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="font-medium">{m.label}</span>
                          {m.value === permissionMode && (
                            <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary">
                              Active
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                          {m.description}
                        </div>
                      </div>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Attach file */}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleFilePick}
                aria-hidden
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0"
                onClick={() => fileInputRef.current?.click()}
                aria-label="Attach a file (inserts @filename)"
                title="Attach a file"
              >
                <Paperclip className="size-3.5" />
              </Button>

              {/* Insert @mention */}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="hidden h-8 w-8 p-0 sm:inline-flex"
                onClick={() => insertAtCursor('@')}
                aria-label="Insert file mention"
                title="Insert @file mention"
              >
                <AtSign className="size-3.5" />
              </Button>
            </div>

            <div className="flex items-center gap-2">
              {/* Char counter (warns when over limit) */}
              <AnimatePresence>
                {charCount > 0 && (
                  <motion.span
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 4 }}
                    className={cn(
                      'text-[10px] tabular-nums',
                      overLimit ? 'text-destructive' : 'text-muted-foreground',
                    )}
                  >
                    {charCount.toLocaleString()}
                    {overLimit && ` / ${charLimit.toLocaleString()}`}
                  </motion.span>
                )}
              </AnimatePresence>

              {/* Send / Stop */}
              {isRunning ? (
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  className="h-8 gap-1.5 px-2.5 text-xs"
                  onClick={onCancel}
                  aria-label="Stop the running agent"
                >
                  <Square className="size-3 fill-current" aria-hidden />
                  Stop
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  className="h-8 gap-1.5 px-2.5 text-xs"
                  onClick={onSend}
                  disabled={!canSend || !value.trim() || overLimit}
                  aria-label="Send prompt"
                >
                  <ArrowUp className="size-3.5" aria-hidden />
                  Send
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Helper hint */}
        <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Sparkles className="size-3" aria-hidden />
            <span className="hidden sm:inline">Goli uses the workspace sandbox for tool calls.</span>
            <span className="sm:hidden">Sandboxed.</span>
          </span>
          <span className="hidden sm:inline">
            <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[9px]">⏎</kbd> send ·{' '}
            <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[9px]">⇧⏎</kbd> newline
          </span>
        </div>
      </div>
    </div>
  );
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

// Unused import suppression — keep Loader2 available for future loading states.
void Loader2;
