/**
 * POST /api/chat/decision — resolve a pending permission request.
 *
 * Body: { toolCallId, decision: 'allow' | 'deny' }
 *
 * Returns 200 if resolved, 404 if no pending request exists for that id.
 */
import { NextResponse } from 'next/server';

import { permissionResolverRegistry } from '@/lib/agent/permission-registry';

/**
 *
 */
export const dynamic = 'force-dynamic';
/**
 *
 */
export const runtime = 'nodejs';

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

  const { toolCallId, decision } = body as {
    toolCallId?: string;
    decision?: 'allow' | 'deny';
  };

  if (!toolCallId || (decision !== 'allow' && decision !== 'deny')) {
    return NextResponse.json(
      { error: 'toolCallId and decision (allow|deny) required.' },
      { status: 400 },
    );
  }

  const ok = permissionResolverRegistry.resolve(toolCallId, decision);
  if (!ok) {
    return NextResponse.json(
      { error: 'No pending permission request for that toolCallId.' },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true });
}
