/**
 * GET  /api/sessions      — list sessions (newest-first) for the sidebar.
 * POST /api/sessions      — create a session.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import type { PermissionMode } from '@/lib/types';

import { newSessionId } from '@/lib/id';
import { listSessions, upsertSession } from '@/lib/storage/session';


/**
 *
 */
export const dynamic = 'force-dynamic';

const CreateBody = z.object({
  id: z.string().min(1).optional(),
  permissionMode: z.enum(['ask', 'yolo', 'plan']).default('ask'),
  systemPreamble: z.string().optional(),
  title: z.string().optional(),
});

/**
 *
 */
export async function GET() {
  try {
    const sessions = await listSessions(50);
    return NextResponse.json({ sessions });
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to list sessions.', detail: (err as Error).message },
      { status: 500 },
    );
  }
}

/**
 *
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const parsed = CreateBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request.', detail: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const b = parsed.data;

  const id = b.id ?? newSessionId();
  const session = await upsertSession({
    id,
    permissionMode: b.permissionMode as PermissionMode,
    systemPreamble: b.systemPreamble,
    title: b.title,
  });

  return NextResponse.json({ session }, { status: 201 });
}
