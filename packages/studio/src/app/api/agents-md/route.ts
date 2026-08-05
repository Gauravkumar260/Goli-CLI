/**
 * GET /api/agents-md — report whether the workspace has an AGENTS.md (or
 * CLAUDE.md / GOLI.md fallback) and return its summary + a preview.
 *
 * The full text is NOT returned (it can be large); the mini-service injects
 * the full text into the system prompt server-side. This endpoint is for
 * UI display only (e.g. a badge in Settings).
 */
import { NextResponse } from 'next/server';

import {
  loadAgentsMd,
  formatAgentsMdPreamble,
} from '@/lib/context/agents-md';
import { SANDBOX_ROOT, validateWorkspace, WorkspaceError } from '@/lib/storage/workspace';

/**
 *
 */
export const dynamic = 'force-dynamic';

/**
 *
 */
export async function GET() {
  try {
    const workspaceDir = await validateWorkspace(SANDBOX_ROOT);
    const result = await loadAgentsMd(workspaceDir);

    return NextResponse.json({
      found: result.text !== null,
      filename: result.filename,
      summary: result.summary,
      preview: result.text ? result.text.slice(0, 400) : null,
      formattedPreview: result.text ? formatAgentsMdPreamble(result).slice(0, 400) : null,
      error: result.error ?? null,
    });
  } catch (err) {
    const msg =
      err instanceof WorkspaceError ? err.message : (err as Error).message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
