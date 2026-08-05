'use client';

/**
 * useAgentStream — drives the chat transcript by consuming the SSE stream
 * from POST /api/chat, dispatching permission decisions to
 * POST /api/chat/decision, and gracefully falling back to a local mock
 * simulator when the backend is unreachable.
 *
 * Public API mirrors the old socket.io hook so the UI stays unchanged:
 *   status: ConnectionStatus
 *   mockMode: boolean
 *   setMockMode(v): void
 *   transcript: TranscriptItem[]
 *   isRunning: boolean
 *   activeRunId: string | null
 *   isLoadingHistory: boolean
 *   send(prompt): void
 *   respondToPermission(toolCallId, decision): void
 *   cancel(): void
 *   clear(): void
 *   loadHistory(sessionId): void
 */
import * as React from 'react';
import { toast } from 'sonner';

import type {
  ChatStreamEvent,
  ConnectionStatus,
  PermissionMode,
  TranscriptItem,
} from '@/lib/types';

/**
 *
 */
export interface UseAgentStreamOptions {
  sessionId: string;
  workspaceDir: string;
  permissionMode: PermissionMode;
  systemPreamble?: string;
}

/**
 *
 */
export interface UseAgentStream {
  status: ConnectionStatus;
  mockMode: boolean;
  setMockMode: (v: boolean) => void;
  transcript: TranscriptItem[];
  isRunning: boolean;
  activeRunId: string | null;
  isLoadingHistory: boolean;
  send: (prompt: string) => void;
  respondToPermission: (toolCallId: string, decision: 'allow' | 'deny') => void;
  cancel: () => void;
  clear: () => void;
  loadHistory: (sessionId: string) => void;
}

const uid = (() => {
  let n = 0;
  return () => `id-${Date.now().toString(36)}-${(n++).toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
})();

/**
 *
 */
export function useAgentStream(opts: UseAgentStreamOptions): UseAgentStream {
  const { sessionId, workspaceDir, permissionMode, systemPreamble } = opts;

  const [transcript, setTranscript] = React.useState<TranscriptItem[]>([]);
  const [isRunning, setIsRunning] = React.useState(false);
  const [activeRunId, setActiveRunId] = React.useState<string | null>(null);
  const [mockMode, setMockMode] = React.useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = React.useState(false);
  const [status, setStatus] = React.useState<ConnectionStatus>('connecting');

  // Mutable refs to avoid stale closures.
  const abortRef = React.useRef<AbortController | null>(null);
  const sessionIdRef = React.useRef(sessionId);
  sessionIdRef.current = sessionId;
  const modeRef = React.useRef(permissionMode);
  modeRef.current = permissionMode;
  const preambleRef = React.useRef(systemPreamble);
  preambleRef.current = systemPreamble;
  const workspaceRef = React.useRef(workspaceDir);
  workspaceRef.current = workspaceDir;
  const mockTimersRef = React.useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  // ---------------- lifecycle: connectivity probe ----------------
  React.useEffect(() => {
    let cancelled = false;
    async function probe() {
      try {
        const r = await fetch('/api/workspace', {
          headers: { Accept: 'application/json' },
        });
        if (cancelled) return;
        if (r.ok) {
          setStatus('connected');
        } else {
          setStatus('disconnected');
        }
      } catch {
        if (!cancelled) setStatus('disconnected');
      }
    }
    probe();
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-enable mock mode if disconnected after a brief delay.
  React.useEffect(() => {
    if (status === 'disconnected' && !mockMode) {
      const t = setTimeout(() => {
        setMockMode(true);
        toast.info('Demo mode is on — backend unreachable. Showing a simulated agent.');
      }, 1200);
      return () => clearTimeout(t);
    }
  }, [status, mockMode]);

  // ---------------- transcript helpers ----------------
  const patch = React.useCallback(
    (fn: (cur: TranscriptItem[]) => TranscriptItem[]) => {
      setTranscript((cur) => fn(cur));
    },
    [],
  );

  const appendItem = React.useCallback(
    (item: TranscriptItem) => {
      patch((cur) => [...cur, item]);
    },
    [patch],
  );

  const updateByToolCallId = React.useCallback(
    (toolCallId: string, fn: (it: TranscriptItem) => TranscriptItem) => {
      patch((cur) =>
        cur.map((it) => (it.toolCallId === toolCallId ? fn(it) : it)),
      );
    },
    [patch],
  );

  const appendToLastAssistant = React.useCallback(
    (text: string) => {
      patch((cur) => {
        // Find the last assistant streaming message and append tokens.
        for (let i = cur.length - 1; i >= 0; i--) {
          const it = cur[i];
          if (it.kind === 'assistant' && it.streaming) {
            const next = [...cur];
            next[i] = { ...it, text: (it.text ?? '') + text };
            return next;
          }
        }
        // Otherwise, create a new streaming assistant message.
        return [
          ...cur,
          {
            id: uid(),
            kind: 'assistant',
            text,
            streaming: true,
            at: Date.now(),
          },
        ];
      });
    },
    [patch],
  );

  // ---------------- load session history ----------------
  const loadHistory = React.useCallback(async (sid: string) => {
    if (!sid) return;
    setIsLoadingHistory(true);
    setTranscript([]);
    try {
      const r = await fetch(`/api/sessions/${encodeURIComponent(sid)}`, {
        headers: { Accept: 'application/json' },
      });
      if (!r.ok) {
        setIsLoadingHistory(false);
        return;
      }
      const data = await r.json();
      const items: TranscriptItem[] = (data.messages ?? []).map(
        (m: {
          id: string;
          role: string;
          content: string;
          toolName?: string | null;
          toolCallId?: string | null;
          isError?: boolean;
          createdAt: string;
        }) => ({
          id: m.id,
          kind:
            m.role === 'user'
              ? 'user'
              : m.role === 'assistant'
                ? 'assistant'
                : m.role === 'tool'
                  ? 'tool'
                  : 'system',
          text: m.content,
          toolName: m.toolName ?? undefined,
          toolCallId: m.toolCallId ?? undefined,
          toolState: m.role === 'tool' ? (m.isError ? 'error' : 'done') : undefined,
          toolResult: m.role === 'tool'
            ? { ok: !m.isError, content: m.content, isError: !!m.isError }
            : undefined,
          at: new Date(m.createdAt).getTime(),
        }),
      );
      setTranscript(items);
    } catch {
      // Silently ignore; the empty transcript will display the empty state.
    } finally {
      setIsLoadingHistory(false);
    }
  }, []);

  // Load history whenever the sessionId changes (skip the very first
  // ephemeral id we generated, since it won't exist server-side yet).
  const firstLoadRef = React.useRef(true);
  React.useEffect(() => {
    if (firstLoadRef.current) {
      firstLoadRef.current = false;
      return;
    }
    loadHistory(sessionId);
  }, [sessionId, loadHistory]);

  // ---------------- send (real backend) ----------------
  const sendReal = React.useCallback(
    async (prompt: string) => {
      const sid = sessionIdRef.current;
      const ws = workspaceRef.current;
      const mode = modeRef.current;
      const preamble = preambleRef.current;

      const abort = new AbortController();
      abortRef.current = abort;

      appendItem({
        id: uid(),
        kind: 'user',
        text: prompt,
        at: Date.now(),
      });
      // Streaming assistant placeholder will be created on first token.
      setIsRunning(true);
      setActiveRunId(null);

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            sessionId: sid,
            prompt,
            permissionMode: mode,
            systemPreamble: preamble,
            workspaceDir: ws,
          }),
          signal: abort.signal,
        });

        if (!res.ok || !res.body) {
          const txt = await res.text().catch(() => '');
          throw new Error(`Chat request failed (${res.status}): ${txt.slice(0, 200)}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';

        // Helper: flush complete `data: …` lines from the buffer.
        const flush = (onEvent: (e: ChatStreamEvent) => void) => {
          let idx: number;
          while ((idx = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            for (const line of block.split('\n')) {
              if (line.startsWith('data: ')) {
                const json = line.slice(6).trim();
                if (!json) continue;
                try {
                  onEvent(JSON.parse(json) as ChatStreamEvent);
                } catch {
                  /* ignore malformed lines */
                }
              }
            }
          }
        };

        while (true) {
          if (abort.signal.aborted) break;
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          flush((e) => applyEvent(e));
        }
        // Final flush (in case the last block didn't end with \n\n).
        flush((e) => applyEvent(e));
      } catch (err) {
        if (abort.signal.aborted) {
          // User-cancelled — no error toast, just stop streaming.
        } else {
          const message = err instanceof Error ? err.message : String(err);
          appendItem({
            id: uid(),
            kind: 'error',
            text: message,
            at: Date.now(),
          });
          toast.error(message);
        }
      } finally {
        // Mark any streaming assistant as done.
        patch((cur) =>
          cur.map((it) =>
            it.kind === 'assistant' && it.streaming ? { ...it, streaming: false } : it,
          ),
        );
        setIsRunning(false);
        setActiveRunId(null);
        abortRef.current = null;
      }
    },
    [appendItem, patch],
  );

  // ---------------- apply SSE event to transcript ----------------
  const applyEvent = React.useCallback(
    (e: ChatStreamEvent) => {
      switch (e.type) {
        case 'start':
          setActiveRunId(e.runId);
          // Create an empty streaming assistant message.
          appendItem({
            id: uid(),
            kind: 'assistant',
            text: '',
            streaming: true,
            runId: e.runId,
            at: Date.now(),
          });
          break;
        case 'token':
          appendToLastAssistant(e.text);
          break;
        case 'tool_start':
          appendItem({
            id: uid(),
            kind: 'tool',
            toolCallId: e.toolCallId,
            toolName: e.name,
            toolInput: e.input,
            toolState: 'running',
            runId: e.runId,
            at: Date.now(),
          });
          break;
        case 'tool_end':
          updateByToolCallId(e.toolCallId, (it) => ({
            ...it,
            toolResult: e.result,
            toolState: e.result.isError ? 'error' : 'done',
          }));
          break;
        case 'permission_request':
          appendItem({
            id: uid(),
            kind: 'permission',
            toolCallId: e.toolCallId,
            toolName: e.name,
            toolInput: e.input,
            summary: e.summary,
            decision: 'pending',
            runId: e.runId,
            at: Date.now(),
          });
          break;
        case 'final':
          // Replace any streaming assistant text with the final consolidated text.
          patch((cur) => {
            for (let i = cur.length - 1; i >= 0; i--) {
              const it = cur[i];
              if (it.kind === 'assistant' && it.runId === e.runId) {
                const next = [...cur];
                next[i] = { ...it, text: e.text, streaming: false };
                return next;
              }
            }
            // Fallback: append a final assistant message.
            return [
              ...cur,
              {
                id: uid(),
                kind: 'assistant',
                text: e.text,
                streaming: false,
                runId: e.runId,
                at: Date.now(),
              },
            ];
          });
          break;
        case 'error':
          appendItem({
            id: uid(),
            kind: 'error',
            text: e.message,
            runId: e.runId,
            at: Date.now(),
          });
          break;
        case 'end':
          // Mark all streaming items for this run as not streaming anymore.
          patch((cur) =>
            cur.map((it) =>
              it.runId === e.runId && it.streaming ? { ...it, streaming: false } : it,
            ),
          );
          break;
      }
    },
    [appendItem, appendToLastAssistant, patch, updateByToolCallId],
  );

  // ---------------- send (mock mode) ----------------
  const sendMock = React.useCallback(
    (prompt: string) => {
      const mode = modeRef.current;
      const runId = `mock-${Date.now().toString(36)}`;
      appendItem({
        id: uid(),
        kind: 'user',
        text: prompt,
        at: Date.now(),
      });
      setIsRunning(true);
      setActiveRunId(runId);

      // Helper to schedule a timeout we can cancel.
      const schedule = (delay: number, fn: () => void) => {
        const t = setTimeout(fn, delay);
        mockTimersRef.current.add(t);
        return t;
      };

      // 1. Stream a fake assistant answer.
      const tokens = mockAnswerFor(prompt);
      tokens.forEach((tok, i) => {
        schedule(180 + i * 35, () => {
          appendToLastAssistant(tok);
        });
      });

      const totalTokenTime = 180 + tokens.length * 35 + 100;

      // 2. If the prompt looks like a write, simulate a write_file tool + permission.
      if (/\b(create|write|edit|update|fix|refactor)\b/i.test(prompt) && mode !== 'plan') {
        const toolCallId = `tcall-${Date.now().toString(36)}`;
        const targetRel = prompt.match(/([\w./-]+\.[a-zA-Z]{1,8})\b/)?.[1] ?? 'notes/new-file.md';

        schedule(totalTokenTime + 200, () => {
          appendItem({
            id: uid(),
            kind: 'tool',
            toolCallId,
            toolName: 'write_file',
            toolInput: { path: targetRel, content: '…' },
            toolState: 'running',
            runId,
            at: Date.now(),
          });
        });

        if (mode === 'ask') {
          // Permission request — wait for the user.
          schedule(totalTokenTime + 500, () => {
            appendItem({
              id: uid(),
              kind: 'permission',
              toolCallId,
              toolName: 'write_file',
              toolInput: { path: targetRel },
              summary: `Write ${targetRel}`,
              decision: 'pending',
              runId,
              at: Date.now(),
            });
          });
        } else {
          // Yolo mode — auto-allow.
          schedule(totalTokenTime + 900, () => {
            updateByToolCallId(toolCallId, (it) => ({
              ...it,
              toolResult: {
                ok: true,
                content: `Wrote 142 chars to ${targetRel}.`,
              },
              toolState: 'done',
            }));
            schedule(150, () => {
              patch((cur) =>
                cur.map((it) =>
                  it.kind === 'assistant' && it.streaming
                    ? { ...it, streaming: false }
                    : it,
                ),
              );
              setIsRunning(false);
              setActiveRunId(null);
            });
          });
        }
        return;
      }

      // 3. Otherwise just end.
      schedule(totalTokenTime + 200, () => {
        patch((cur) =>
          cur.map((it) =>
            it.kind === 'assistant' && it.streaming ? { ...it, streaming: false } : it,
          ),
        );
        setIsRunning(false);
        setActiveRunId(null);
      });
    },
    [appendItem, appendToLastAssistant, patch, updateByToolCallId],
  );

  // ---------------- public send ----------------
  const send = React.useCallback(
    (prompt: string) => {
      const trimmed = prompt.trim();
      if (!trimmed) return;
      if (isRunning) return;
      if (mockMode) {
        sendMock(trimmed);
      } else {
        void sendReal(trimmed);
      }
    },
    [isRunning, mockMode, sendMock, sendReal],
  );

  // ---------------- respondToPermission ----------------
  const respondToPermission = React.useCallback(
    async (toolCallId: string, decision: 'allow' | 'deny') => {
      // Update the transcript immediately for snappy UX.
      updateByToolCallId(toolCallId, (it) => ({ ...it, decision }));
      // Also update the corresponding tool card to 'running' (awaiting result).
      updateByToolCallId(toolCallId, (it) =>
        it.kind === 'permission'
          ? it
          : { ...it, toolState: 'running' },
      );

      if (mockMode) {
        // Simulate the tool result after a short delay.
        const t = setTimeout(() => {
          updateByToolCallId(toolCallId, (it) => {
            if (it.kind !== 'tool') return it;
            if (decision === 'allow') {
              return {
                ...it,
                toolState: 'done',
                toolResult: {
                  ok: true,
                  content: 'Wrote 142 chars to the file.',
                },
              };
            }
            return {
              ...it,
              toolState: 'error',
              toolResult: {
                ok: false,
                isError: true,
                content: 'User denied the write.',
              },
            };
          });
          // End the run shortly after.
          setTimeout(() => {
            patch((cur) =>
              cur.map((it2) =>
                it2.kind === 'assistant' && it2.streaming
                  ? { ...it2, streaming: false }
                  : it2,
              ),
            );
            setIsRunning(false);
            setActiveRunId(null);
          }, 200);
        }, 350);
        mockTimersRef.current.add(t);
        return;
      }

      try {
        await fetch('/api/chat/decision', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ toolCallId, decision }),
        });
      } catch (err) {
        toast.error(
          `Failed to send permission decision: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    },
    [mockMode, patch, updateByToolCallId],
  );

  // ---------------- cancel ----------------
  const cancel = React.useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    // Cancel any pending mock timers.
    for (const t of mockTimersRef.current) clearTimeout(t);
    mockTimersRef.current.clear();
    patch((cur) =>
      cur.map((it) =>
        it.streaming ? { ...it, streaming: false } : it,
      ),
    );
    setIsRunning(false);
    setActiveRunId(null);
  }, [patch]);

  // ---------------- clear ----------------
  const clear = React.useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    for (const t of mockTimersRef.current) clearTimeout(t);
    mockTimersRef.current.clear();
    setTranscript([]);
    setIsRunning(false);
    setActiveRunId(null);
  }, []);

  // Cleanup on unmount.
  React.useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
      for (const t of mockTimersRef.current) clearTimeout(t);
      mockTimersRef.current.clear();
    };
  }, []);

  return {
    status,
    mockMode,
    setMockMode,
    transcript,
    isRunning,
    activeRunId,
    isLoadingHistory,
    send,
    respondToPermission,
    cancel,
    clear,
    loadHistory,
  };
}

// ---------------- helpers ----------------

// Mock answer generator — token-by-token (preserves whitespace breaks).
function mockAnswerFor(prompt: string): string[] {
  const text = `Here's a quick take on **"${prompt.trim().slice(0, 80)}"**:

1. I'll first read the relevant file(s) to understand the current state.
2. Then propose a minimal diff that keeps the change scoped.
3. Finally run a quick check to make sure nothing else broke.

\`\`\`ts
// Example sketch
export function refine(input: string): string {
  return input.trim().toLowerCase();
}
\`\`\`

Want me to apply this? In \`ask\` mode I'll wait for your approval before writing anything.`;
  // Split into ~3-char chunks to look like token streaming.
  const tokens: string[] = [];
  for (let i = 0; i < text.length; i += 3) {
    tokens.push(text.slice(i, i + 3));
  }
  return tokens;
}
