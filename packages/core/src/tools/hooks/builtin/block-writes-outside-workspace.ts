/**
 * block_writes_outside_workspace hook (Module 3, part 2).
 *
 * PreToolUse hook that denies file writes outside the workspace root.
 * This is a defense-in-depth layer — the tools themselves also check
 * workspace boundaries, but this hook catches any tool that might
 * have a bug in its boundary check.
 *
 * @module tools/hooks/builtin/block-writes-outside-workspace
 */

import { resolve, relative } from 'node:path';

import type { Hook, HookContext, PreToolUseHookResult } from '../types.js';

/** The block_writes_outside_workspace hook. */
export const BLOCK_WRITES_OUTSIDE_WORKSPACE_HOOK: Hook = {
  name: 'block_writes_outside_workspace',
  event: 'PreToolUse',
  handler: (ctx: HookContext): PreToolUseHookResult => {
    // Only check write tools
    const writeTools = ['write_file', 'edit_file', 'bash'];
    if (!writeTools.includes(ctx.toolName)) {
      return { decision: 'allow' };
    }

    // God mode bypasses workspace boundary
    if (ctx.godMode) {
      return { decision: 'allow' };
    }

    // Check file_path for write_file / edit_file
    if (ctx.toolName === 'write_file' || ctx.toolName === 'edit_file') {
      const filePath = (ctx.args['file_path'] as string) ?? '';
      if (filePath) {
        const absolutePath = resolve(ctx.workspaceRoot, filePath);
        const rel = relative(ctx.workspaceRoot, absolutePath);
        if (rel.startsWith('..')) {
          return {
            decision: 'deny',
            reason: `Blocked by block_writes_outside_workspace: write to ${filePath} is outside the workspace (${ctx.workspaceRoot}).`,
          };
        }
      }
    }

    // Check bash commands that write files. The previous implementation
    // only matched single `>` (overwrite) redirects, missing `>>` (append),
    // `tee`, `cp`, `mv`, `sed -i`, `dd of=`, `install`, etc.
    if (ctx.toolName === 'bash') {
      const command = (ctx.args['command'] as string) ?? '';

      // Helper: check if a path is outside the workspace (allowing /tmp,
      // /dev/null, $TMPDIR, and the workspace's own temp dir).
      const isOutsideWorkspace = (path: string): boolean => {
        if (!path) return false;
        // Allow common temp locations.
        const tmpDir = process.env['TMPDIR'] ?? '/tmp';
        if (path === '/dev/null') return false;
        if (path.startsWith('/tmp/') || path === '/tmp') return false;
        if (path.startsWith(tmpDir) ) return false;
        const absolutePath = resolve(ctx.workspaceRoot, path);
        const rel = relative(ctx.workspaceRoot, absolutePath);
        return rel.startsWith('..') || rel === '';
      };

      // 1. Check `>` and `>>` redirects. The regex captures the redirect
      //    operator and the following path token.
      //    The previous implementation used `/>\\s*(\\S+)/g` then
      //    `redirect.replace(/^>\\s*/, '')` which mishandled `>>` (it
      //    left a leading `>` in the path).
      const redirectMatches = command.matchAll(/>{1,2}\s*(\S+)/g);
      for (const m of redirectMatches) {
        const path = m[1]!;
        if (isOutsideWorkspace(path)) {
          return {
            decision: 'deny',
            reason: `Blocked by block_writes_outside_workspace: redirect to ${path} is outside the workspace.`,
          };
        }
      }

      // 2. Check `tee`, `cp`, `mv`, `install` commands — extract the
      //    LAST argument (the destination) and check it.
      //    This is a heuristic; a full shell parser would be more robust
      //    but adds a heavy dependency. The check is defense-in-depth.
      const writeCommands = ['tee', 'cp', 'mv', 'install'];
      const tokens = command.split(/\s+/);
      for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i]!;
        // Strip leading command-prefix (sudo, env vars, etc.)
        const baseCmd = tok.split('/').pop() ?? tok;
        if (writeCommands.includes(baseCmd)) {
          // The destination is typically the last token before `;`, `&&`, `||`, `|`, or end.
          let j = i + 1;
          let dest: string | undefined;
          while (j < tokens.length) {
            const t = tokens[j]!;
            if (t === ';' || t === '&&' || t === '||' || t === '|' || t === '>') break;
            // Skip flags like -r, -f, --preserve=mode
            if (t.startsWith('-')) { j++; continue; }
            dest = t;
            j++;
          }
          if (dest && isOutsideWorkspace(dest)) {
            return {
              decision: 'deny',
              reason: `Blocked by block_writes_outside_workspace: ${baseCmd} destination ${dest} is outside the workspace.`,
            };
          }
        }
      }

      // 3. Check `sed -i` (in-place edit) — the file being edited is the
      //    last non-flag argument.
      if (/\bsed\b.*\s-i/.test(command)) {
        const sedTokens = command.split(/\s+/);
        const sedIdx = sedTokens.findIndex((t) => t === 'sed' || t.endsWith('/sed'));
        if (sedIdx !== -1) {
          let dest: string | undefined;
          for (let j = sedIdx + 1; j < sedTokens.length; j++) {
            const t = sedTokens[j]!;
            if (t === ';' || t === '&&' || t === '||' || t === '|') break;
            if (t.startsWith('-')) continue;
            if (t.startsWith("'") || t.startsWith('"')) continue; // skip the script arg
            dest = t;
          }
          if (dest && isOutsideWorkspace(dest)) {
            return {
              decision: 'deny',
              reason: `Blocked by block_writes_outside_workspace: sed -i on ${dest} is outside the workspace.`,
            };
          }
        }
      }

      // 4. Check `dd of=PATH` writes.
      const ddOfMatch = command.match(/\bdd\s+.*\bof=(\S+)/);
      if (ddOfMatch) {
        const path = ddOfMatch[1]!;
        if (isOutsideWorkspace(path)) {
          return {
            decision: 'deny',
            reason: `Blocked by block_writes_outside_workspace: dd of=${path} is outside the workspace.`,
          };
        }
      }
    }

    return { decision: 'allow' };
  },
  priority: 30,
  disableable: false,
};
