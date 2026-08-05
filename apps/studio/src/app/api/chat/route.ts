/**
 * POST /api/chat — stream an agent run over Server-Sent Events.
 *
 * Body: { sessionId, prompt, permissionMode?, systemPreamble?, workspaceDir? }
 *
 * SSE stream emits ChatStreamEvent objects, one per `data:` line.
 *
 * Permission flow: when the agent emits a `permission_request`, the loop
 * pauses until the client POSTs to /api/chat/decision with the toolCallId
 * and decision. The decision is delivered via an in-memory promise map.
 */
import { NextRequest } from 'next/server';

import type { ChatStreamEvent, PermissionMode } from '@/lib/types';

import { runAgent } from '@/lib/agent/loop';
import { permissionResolverRegistry } from '@/lib/agent/permission-registry';
import {
  appendMessage,
  getSessionWithMessages,
  loadTranscriptForAgent,
  upsertSession,
} from '@/lib/storage/session';
import { validateWorkspace, WorkspaceError } from '@/lib/storage/workspace';

/**
 *
 */
export const dynamic = 'force-dynamic';
/**
 *
 */
export const runtime = 'nodejs';

const VALID_PERMISSION_MODES: PermissionMode[] = ['ask', 'yolo', 'plan'];

/**
 *
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body.' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const b = body as {
    sessionId?: string;
    prompt?: string;
    permissionMode?: string;
    systemPreamble?: string;
    workspaceDir?: string;
  };

  if (!b.sessionId || !b.prompt || !b.prompt.trim()) {
    return new Response(
      JSON.stringify({ error: 'sessionId and prompt are required.' }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    );
  }

  const permissionMode: PermissionMode = VALID_PERMISSION_MODES.includes(
    b.permissionMode as PermissionMode,
  )
    ? (b.permissionMode as PermissionMode)
    : 'ask';

  // Validate the workspace sandbox server-side.
  let workspaceDir: string;
  try {
    workspaceDir = await validateWorkspace(b.workspaceDir);
  } catch (err) {
    const msg = err instanceof WorkspaceError ? err.message : 'Invalid workspace.';
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  // Persist the user prompt immediately (so a refresh mid-stream still shows it).
  await upsertSession({
    id: b.sessionId,
    permissionMode,
    systemPreamble: b.systemPreamble ?? null,
  });
  await appendMessage({
    sessionId: b.sessionId,
    role: 'user',
    content: b.prompt,
  });

  // Load prior transcript for the agent.
  const existing = await getSessionWithMessages(b.sessionId);
  const history = existing
    ? existing.messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(0, -1) // drop the user msg we just appended (it's in `prompt`)
        .map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }))
    : [];

  // Build the SSE stream.
  const encoder = new TextEncoder();
  const abort = new AbortController();
  let assistantText = '';

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: ChatStreamEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      };

      // Hook the agent loop into the permission registry.
      const onPermissionRequest = (
        toolCallId: string,
        _name: string,
        _input: Record<string, unknown>,
        _summary: string,
      ): Promise<'allow' | 'deny'> => {
        return permissionResolverRegistry.waitFor(toolCallId, abort.signal);
      };

      try {
        for await (const event of runAgent({
          sessionId: b.sessionId!,
          prompt: b.prompt!,
          history,
          permissionMode,
          systemPreamble: b.systemPreamble,
          workspaceDir,
          signal: abort.signal,
          onPermissionRequest,
        })) {
          send(event);
          if (event.type === 'token') assistantText += event.text;
          if (event.type === 'final') assistantText = event.text;
        }
        // Persist the assistant message.
        if (assistantText.trim()) {
          await appendMessage({
            sessionId: b.sessionId!,
            role: 'assistant',
            content: assistantText,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        send({ type: 'error', runId: 'unknown', message });
      } finally {
        controller.enqueue(encoder.encode('event: done\ndata: {}\n\n'));
        controller.close();
        permissionResolverRegistry.cleanup(b.sessionId!);
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}

// Also load transcript helper exported for symmetry.
/**
 *
 */
export { loadTranscriptForAgent };
