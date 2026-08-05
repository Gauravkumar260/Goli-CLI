/**
 * GET    /api/sessions/[id] — return a session + its full ordered transcript.
 * DELETE /api/sessions/[id] — delete a session and all its messages.
 * PATCH  /api/sessions/[id] — rename a session (body: { title: string }).
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  getSessionWithMessages,
  deleteSession,
  renameSession,
} from '@/lib/storage/session';

/**
 *
 */
export const dynamic = 'force-dynamic';

/**
 *
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'Missing id.' }, { status: 400 });

  try {
    const result = await getSessionWithMessages(id);
    if (!result) {
      return NextResponse.json({ error: 'Session not found.' }, { status: 404 });
    }
    const messages = result.messages.map((m) => ({
      id: m.id,
      sequence: m.sequence,
      role: m.role,
      content: m.content,
      toolName: m.toolName,
      toolCallId: m.toolCallId,
      isError: m.isError,
      createdAt: m.createdAt.toISOString(),
    }));
    return NextResponse.json({
      session: {
        id: result.session.id,
        title: result.session.title,
        permissionMode: result.session.permissionMode,
        createdAt: result.session.createdAt.toISOString(),
        updatedAt: result.session.updatedAt.toISOString(),
      },
      messages,
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to load session.', detail: (err as Error).message },
      { status: 500 },
    );
  }
}

/**
 *
 */
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'Missing id.' }, { status: 400 });

  try {
    await deleteSession(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to delete session.', detail: (err as Error).message },
      { status: 500 },
    );
  }
}

const RenameBody = z.object({ title: z.string().min(1).max(120) });

/**
 *
 */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'Missing id.' }, { status: 400 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const parsed = RenameBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request.', detail: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const updated = await renameSession(id, parsed.data.title);
  if (!updated) {
    return NextResponse.json({ error: 'Session not found.' }, { status: 404 });
  }
  return NextResponse.json({
    session: {
      id: updated.id,
      title: updated.title,
      updatedAt: updated.updatedAt.toISOString(),
    },
  });
}
