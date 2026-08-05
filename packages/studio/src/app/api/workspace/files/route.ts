/**
 * GET /api/workspace/files        — list the workspace tree (depth-bounded).
 * GET /api/workspace/files?path=x — read a single file's contents.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { NextResponse } from 'next/server';

import {
  validateWorkspace,
  resolveSafePath,
  toRelative,
  WorkspaceError,
  READ_CHAR_LIMIT,
  SANDBOX_ROOT,
} from '@/lib/storage/workspace';

/**
 *
 */
export const dynamic = 'force-dynamic';

interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size?: number;
  children?: TreeNode[];
}

const PRUNE = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', '.cache', '.turbo', '.vercel',
]);
const MAX_DEPTH = 4;
const MAX_NODES = 1000;

/**
 *
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const readPath = url.searchParams.get('path');

  let workspaceDir: string;
  try {
    workspaceDir = await validateWorkspace(SANDBOX_ROOT);
  } catch (err) {
    const msg = err instanceof WorkspaceError ? err.message : (err as Error).message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  if (readPath) {
    let abs: string;
    try {
      abs = await resolveSafePath(workspaceDir, readPath);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof WorkspaceError ? err.message : 'Invalid path.' },
        { status: 400 },
      );
    }
    try {
      const stat = await fs.stat(abs);
      if (!stat.isFile()) {
        return NextResponse.json({ error: 'Not a file.' }, { status: 400 });
      }
      let content = await fs.readFile(abs, 'utf8');
      const truncated = content.length > READ_CHAR_LIMIT;
      if (truncated) content = content.slice(0, READ_CHAR_LIMIT);
      return NextResponse.json({
        path: toRelative(workspaceDir, abs),
        content,
        size: stat.size,
        truncated,
        limit: READ_CHAR_LIMIT,
      });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT')
        return NextResponse.json({ error: 'File not found.' }, { status: 404 });
      return NextResponse.json(
        { error: `Read failed: ${(err as Error).message}` },
        { status: 500 },
      );
    }
  }

  let nodeCount = 0;
  async function walk(dir: string, depth: number): Promise<TreeNode[]> {
    if (depth > MAX_DEPTH || nodeCount >= MAX_NODES) return [];
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
    const nodes: TreeNode[] = [];
    for (const ent of entries) {
      if (nodeCount >= MAX_NODES) break;
      if (PRUNE.has(ent.name)) continue;
      nodeCount++;
      const abs = path.join(dir, ent.name);
      const rel = toRelative(workspaceDir, abs);
      if (ent.isDirectory()) {
        nodes.push({
          name: ent.name,
          path: rel,
          type: 'dir',
          children: await walk(abs, depth + 1),
        });
      } else {
        let size: number | undefined;
        try { size = (await fs.stat(abs)).size; } catch { /* ignore */ }
        nodes.push({ name: ent.name, path: rel, type: 'file', size });
      }
    }
    return nodes;
  }

  try {
    const tree = await walk(workspaceDir, 0);
    return NextResponse.json({
      workspaceDir,
      tree,
      truncated: nodeCount >= MAX_NODES,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `List failed: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}
