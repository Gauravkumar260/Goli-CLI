/**
 * Workspace sandbox helpers.
 *
 * The sandbox root is /home/z/my-project/workspace. All file tool calls
 * resolve paths relative to this root and reject any escape attempts.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 *
 */
export const SANDBOX_ROOT = '/home/z/my-project/workspace';
/**
 *
 */
export const READ_CHAR_LIMIT = 64_000;

/**
 *
 */
export class WorkspaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceError';
  }
}

/** Ensure the sandbox exists, then return its absolute path. */
export async function validateWorkspace(dir: string = SANDBOX_ROOT): Promise<string> {
  // Only allow paths under SANDBOX_ROOT.
  const root = path.resolve(SANDBOX_ROOT);
  const target = path.resolve(dir);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new WorkspaceError(
      `Workspace "${target}" is outside the sandbox root "${root}".`,
    );
  }
  try {
    await fs.mkdir(root, { recursive: true });
    await fs.access(root, fs.constants.R_OK | fs.constants.W_OK);
  } catch (err) {
    throw new WorkspaceError(
      `Sandbox workspace "${root}" is not accessible: ${(err as Error).message}`,
    );
  }
  return root;
}

/** Resolve a workspace-relative path and reject escapes. */
export async function resolveSafePath(
  workspaceDir: string,
  rel: string,
): Promise<string> {
  const root = path.resolve(workspaceDir);
  const cleaned = rel.replace(/^[/\\]+/, '');
  const abs = path.resolve(root, cleaned);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new WorkspaceError(`Path "${rel}" escapes the workspace sandbox.`);
  }
  return abs;
}

/** Convert an absolute path inside the workspace to a workspace-relative path. */
export function toRelative(workspaceDir: string, abs: string): string {
  const root = path.resolve(workspaceDir);
  const rel = path.relative(root, abs);
  return rel.split(path.sep).join('/');
}
