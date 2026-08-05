/**
 * GET /api/workspace — return the validated sandbox workspace root + basic info.
 */
import { promises as fs } from 'node:fs';

import { NextResponse } from 'next/server';

import { validateWorkspace, WorkspaceError, SANDBOX_ROOT } from '@/lib/storage/workspace';

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
    let entryCount = 0;
    try {
      const entries = await fs.readdir(workspaceDir);
      entryCount = entries.length;
    } catch {
      /* fresh workspace, no entries yet */
    }
    return NextResponse.json({
      workspaceDir,
      sandboxRoot: SANDBOX_ROOT,
      entryCount,
      note: 'Sandboxed. All file tool calls are confined to this directory.',
    });
  } catch (err) {
    const msg = err instanceof WorkspaceError ? err.message : (err as Error).message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
