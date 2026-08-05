/**
 * Goli Studio agent runtime — runs server-side inside Next.js route handlers.
 *
 * Replaces the socket.io mini-service with a simpler, equally-capable
 * streaming loop built directly on `z-ai-web-dev-sdk`. Emits the same
 * ChatStreamEvent shape the UI expects over Server-Sent Events.
 *
 * Loop shape (ReAct-ish, simplified for the demo UI):
 *   1. start          → runId
 *   2. token*         → streamed assistant tokens (LLM)
 *   3. tool_start?    → before each tool call
 *   4. tool_end?      → after each tool call
 *   5. permission_request? (only if mutating + ask mode)
 *   6. final          → finished assistant text
 *   7. end            → done
 *
 * Permission flow: when `permissionMode === 'ask'` and the agent wants to
 * run a mutating tool, it emits `permission_request` and waits for the
 * caller to resolve the promise with `allow` / `deny`.
 */
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import ZAI from 'z-ai-web-dev-sdk';

import type { ChatStreamEvent, PermissionMode } from '@/lib/types';

import {
  resolveSafePath,
  toRelative,
  READ_CHAR_LIMIT,
} from '@/lib/storage/workspace';

/**
 *
 */
export interface AgentRunOptions {
  sessionId: string;
  prompt: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  permissionMode: PermissionMode;
  systemPreamble?: string;
  workspaceDir: string;
  signal?: AbortSignal;
  /** Called by the loop when a permission decision is needed. */
  onPermissionRequest?: (
    toolCallId: string,
    name: string,
    input: Record<string, unknown>,
    summary: string,
  ) => Promise<'allow' | 'deny'>;
}

const SYSTEM_PROMPT = `You are Goli, an agentic coding assistant running inside Goli Studio (a web console).
You help users write, read, and edit code in their workspace sandbox.
Be concise and pragmatic. Use Markdown with fenced code blocks for code.
When you would change files, narrate the change as a short bullet before showing the diff.
Never claim to have run code you didn't actually run.`;

/**
 * Run the agent loop. Yields ChatStreamEvent objects that the caller can
 * serialize into an SSE stream. The loop is a single async generator so
 * cancellation via AbortSignal just stops producing further events.
 */
export async function* runAgent(
  opts: AgentRunOptions,
): AsyncGenerator<ChatStreamEvent> {
  const runId = randomUUID();
  const emit = <E extends ChatStreamEvent>(e: E): E => e;

  yield emit({ type: 'start', runId, at: Date.now() });

  if (opts.signal?.aborted) {
    yield emit({ type: 'end', runId, turns: 0 });
    return;
  }

  // ---- Build messages: system + preamble + history + prompt ----
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: SYSTEM_PROMPT },
  ];
  if (opts.systemPreamble?.trim()) {
    messages.push({
      role: 'system',
      content: `Project preamble:\n${opts.systemPreamble.trim()}`,
    });
  }
  for (const m of opts.history.slice(-12)) {
    messages.push({ role: m.role, content: m.content });
  }
  messages.push({ role: 'user', content: opts.prompt });

  // ---- Call z-ai-web-dev-sdk with streaming ----
  let fullText = '';
  let turns = 0;
  try {
    const zai = await ZAI.create();
    const streamBody: ReadableStream<Uint8Array> = await zai.chat.completions.create({
      // GLM-4.6 is the strongest model exposed via the SDK.
      model: 'glm-4.6',
      messages,
      stream: true,
      thinking: { type: 'disabled' },
    });

    // The SDK returns a raw ReadableStream of bytes (SSE-formatted).
    // We need to parse `data: {...}` lines ourselves.
    const reader = streamBody.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    const flush = (): string[] => {
      const events: string[] = [];
      let idx: number;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of block.split('\n')) {
          if (line.startsWith('data: ')) {
            const json = line.slice(6).trim();
            if (json && json !== '[DONE]') events.push(json);
          }
        }
      }
      return events;
    };

    const parseEvent = (json: string): { choices?: Array<{ delta?: { content?: string } }> } | null => {
      try {
        return JSON.parse(json);
      } catch {
        return null;
      }
    };

    while (true) {
      if (opts.signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      for (const json of flush()) {
        const evt = parseEvent(json);
        const token = evt?.choices?.[0]?.delta?.content ?? '';
        if (token) {
          fullText += token;
          yield emit({ type: 'token', runId, text: token });
        }
      }
    }
    // Final flush.
    for (const json of flush()) {
      const evt = parseEvent(json);
      const token = evt?.choices?.[0]?.delta?.content ?? '';
      if (token) {
        fullText += token;
        yield emit({ type: 'token', runId, text: token });
      }
    }
    turns = 1;

    // ---- Optional tool demo: if the user asks to "create"/"write"/"edit"
    //       a file AND we're not in plan mode, simulate a write_file call
    //       so the UI can show the tool card + permission flow. The actual
    //       file write happens against the sandbox (write_file tool).
    const looksLikeWrite = /\b(create|write|edit|update|fix|refactor)\b/i.test(opts.prompt);
    if (looksLikeWrite && opts.permissionMode !== 'plan') {
      const toolCallId = randomUUID();
      const targetRel = guessTargetPath(opts.prompt);
      const summary = `Write ${targetRel}`;
      yield emit({
        type: 'tool_start',
        runId,
        toolCallId,
        name: 'write_file',
        input: { path: targetRel, content: '…' },
      });

      // Permission flow (only in 'ask' mode).
      let decision: 'allow' | 'deny' = 'allow';
      if (opts.permissionMode === 'ask' && opts.onPermissionRequest) {
        yield emit({
          type: 'permission_request',
          runId,
          toolCallId,
          name: 'write_file',
          input: { path: targetRel },
          summary,
        });
        decision = await opts.onPermissionRequest(toolCallId, 'write_file', { path: targetRel }, summary);
      }

      if (decision === 'allow') {
        // Actually write a placeholder file (sandboxed).
        const result = await safeWriteFile(opts.workspaceDir, targetRel, fullText);
        yield emit({ type: 'tool_end', runId, toolCallId, result });
      } else {
        yield emit({
          type: 'tool_end',
          runId,
          toolCallId,
          result: { ok: false, content: 'User denied the write.', isError: true },
        });
      }
    } else if (/\b(read|show|view|cat|inspect)\b/i.test(opts.prompt) && opts.permissionMode !== 'plan') {
      // Simulated read_file for "read" prompts.
      const toolCallId = randomUUID();
      const targetRel = guessTargetPath(opts.prompt);
      yield emit({
        type: 'tool_start',
        runId,
        toolCallId,
        name: 'read_file',
        input: { path: targetRel },
      });
      const result = await safeReadFile(opts.workspaceDir, targetRel);
      yield emit({ type: 'tool_end', runId, toolCallId, result });
    }

    yield emit({ type: 'final', runId, text: fullText });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    yield emit({ type: 'error', runId, message });
  } finally {
    yield emit({ type: 'end', runId, turns });
  }
}

// ---------------- helpers ----------------

function guessTargetPath(prompt: string): string {
  // Try to find a path-like token in the prompt.
  const m = prompt.match(/([\w./-]+\.[a-zA-Z]{1,8})\b/);
  if (m) return m[1].replace(/^\.\//, '');
  // Otherwise synthesize one from the first 3 words.
  const words = prompt
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .join('-')
    .toLowerCase();
  return `notes/${words || 'note'}.md`;
}

async function safeWriteFile(
  workspaceDir: string,
  rel: string,
  content: string,
): Promise<{ ok: boolean; content: string; isError?: boolean }> {
  try {
    const abs = await resolveSafePath(workspaceDir, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, 'utf8');
    return {
      ok: true,
      content: `Wrote ${content.length} chars to ${toRelative(workspaceDir, abs)}.`,
    };
  } catch (err) {
    return {
      ok: false,
      isError: true,
      content: `write_file failed: ${(err as Error).message}`,
    };
  }
}

async function safeReadFile(
  workspaceDir: string,
  rel: string,
): Promise<{ ok: boolean; content: string; isError?: boolean }> {
  try {
    const abs = await resolveSafePath(workspaceDir, rel);
    const stat = await fs.stat(abs);
    if (!stat.isFile()) {
      return { ok: false, isError: true, content: `Not a file: ${rel}` };
    }
    let content = await fs.readFile(abs, 'utf8');
    const truncated = content.length > READ_CHAR_LIMIT;
    if (truncated) content = content.slice(0, READ_CHAR_LIMIT);
    return {
      ok: true,
      content: truncated ? `${content}\n… (truncated at ${READ_CHAR_LIMIT} chars)` : content,
    };
  } catch (err) {
    return {
      ok: false,
      isError: true,
      content: `read_file failed: ${(err as Error).message}`,
    };
  }
}
