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
    // Check ALL tools that can write files — not just write_file/edit_file/bash.
    // The previous implementation only checked those three, so `notebook_edit`
    // (writes .ipynb files), `save_tool` (writes to ~/.goli-cli/dynamic-tools/),
    // and dynamic tools (can write anywhere via their script) all bypassed
    // the hook entirely.
    const writeTools = ['write_file', 'edit_file', 'bash', 'notebook_edit', 'save_tool'];
    const isWriteTool = writeTools.includes(ctx.toolName) || ctx.toolName.startsWith('dyn-');
    if (!isWriteTool) {
      return { decision: 'allow' };
    }

    // God mode bypasses workspace boundary
    if (ctx.godMode) {
      return { decision: 'allow' };
    }

    // Check file_path for write_file / edit_file / notebook_edit
    if (ctx.toolName === 'write_file' || ctx.toolName === 'edit_file' || ctx.toolName === 'notebook_edit') {
      const filePath = (ctx.args['file_path'] as string) ?? (ctx.args['notebook_path'] as string) ?? '';
      if (filePath) {
        const absolutePath = resolve(ctx.workspaceRoot, filePath);
        const rel = relative(ctx.workspaceRoot, absolutePath);
        // NOTE: `rel === ''` means the path IS the workspace root —
        // that's a write INTO the workspace, NOT outside it. The
        // previous implementation treated `rel === ''` as outside
        // (blocking `cp file /home/user/project` even though it's
        // the workspace root). We now only block on `..` prefixes.
        if (rel.startsWith('..')) {
          return {
            decision: 'deny',
            reason: `Blocked by block_writes_outside_workspace: write to ${filePath} is outside the workspace (${ctx.workspaceRoot}).`,
          };
        }
      }
    }

    // save_tool is gated by tier (T3) in dynamic-tool-manager.ts —
    // its destination is fixed (~/.goli-cli/dynamic-tools/). No
    // additional path check here.
    if (ctx.toolName === 'save_tool') {
      return { decision: 'allow' };
    }

    if (ctx.toolName === 'bash' || ctx.toolName.startsWith('dyn-')) {
      const command = (ctx.args['command'] as string) ??
        (ctx.args['cell_source'] as string) ??
        (ctx.args['code'] as string) ??
        '';

      // Helper: check if a path is outside the workspace (allowing /tmp,
      // /dev/null, $TMPDIR, and the workspace's own temp dir).
      // Strips surrounding quotes so `cp file "/etc/passwd"` is caught.
      // Expands $HOME, ~, ~user to home dir so `cp file $HOME/.bashrc`
      // is caught. The previous implementation resolved quoted paths
      // verbatim, so `"/etc/passwd"` was treated as a relative path.
      const isOutsideWorkspace = (rawPath: string): boolean => {
        if (!rawPath) return false;
        // Strip surrounding quotes.
        let path = rawPath;
        if ((path.startsWith('"') && path.endsWith('"')) || (path.startsWith("'") && path.endsWith("'"))) {
          path = path.slice(1, -1);
        }
        // Expand ~ and $HOME.
        if (path === '~' || path === '$HOME' || path === '${HOME}') {
          path = process.env['HOME'] ?? '/root';
        } else if (path.startsWith('~/')) {
          path = (process.env['HOME'] ?? '/root') + path.slice(1);
        } else if (path.startsWith('$HOME/')) {
          path = (process.env['HOME'] ?? '/root') + path.slice(5);
        } else if (path.startsWith('${HOME}/')) {
          path = (process.env['HOME'] ?? '/root') + path.slice(7);
        }
        // Allow common temp locations.
        const tmpDir = process.env['TMPDIR'] ?? '/tmp';
        if (path === '/dev/null') return false;
        if (path.startsWith('/tmp/') || path === '/tmp') return false;
        // TMPDIR: use `startsWith(tmpDir + '/')` or `=== tmpDir` so
        // `TMPDIR=/etc` doesn't allow writes to `/etc`. The
        // previous implementation used `path.startsWith(tmpDir)`
        // — if an attacker set `TMPDIR=/etc` before launching goli,
        // writes to `/etc/passwd` were allowed because
        // `/etc/passwd`.startsWith('/etc') is true.
        if (path === tmpDir || path.startsWith(tmpDir + '/')) return false;
        const absolutePath = resolve(ctx.workspaceRoot, path);
        const rel = relative(ctx.workspaceRoot, absolutePath);
        // `rel === ''` means workspace root — that's INSIDE, not outside.
        return rel.startsWith('..');
      };

      // 1. Check redirects. The regex captures the redirect
      //    operator and the following path token. We now also
      //    catch `&>` (bash combined stdout+stderr), `2>` (stderr),
      //    `1>` (stdout), and `&>>` (append combined). The
      //    previous implementation only matched `>` and `>>`.
      const redirectMatches = command.matchAll(/(?:[12]?|&)?>>?\s*(\S+)/g);
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
      //    The previous implementation used `command.split(/\s+/)`
      //    which doesn't handle shell quoting. We use a smarter
      //    tokenizer that respects quotes and treats `\;` (escaped
      //    semicolon in `find -exec ... \;`) as a break token.
      const writeCommands = ['tee', 'cp', 'mv', 'install'];
      const tokens = tokenizeShell(command);
      for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i]!;
        const baseCmd = tok.split('/').pop() ?? tok;
        if (writeCommands.includes(baseCmd)) {
          let j = i + 1;
          let dest: string | undefined;
          while (j < tokens.length) {
            const t = tokens[j]!;
            // Treat `\;` (escaped semicolon in find -exec) as a break
            // token — the previous implementation didn't, so
            // `find . -exec cp {} /etc/passwd \;` ended with
            // `dest = '\\;'` and the check passed.
            if (t === ';' || t === '&&' || t === '||' || t === '|' || t === '>' || t === '\\;') break;
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
        const sedTokens = tokenizeShell(command);
        const sedIdx = sedTokens.findIndex((t) => t === 'sed' || t.endsWith('/sed'));
        if (sedIdx !== -1) {
          let dest: string | undefined;
          for (let j = sedIdx + 1; j < sedTokens.length; j++) {
            const t = sedTokens[j]!;
            if (t === ';' || t === '&&' || t === '||' || t === '|') break;
            if (t.startsWith('-')) continue;
            if (t.startsWith("'") || t.startsWith('"')) continue;
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

/**
 * Tokenize a shell command string with basic quote handling.
 * Returns tokens with quotes preserved (so callers can strip them
 * themselves). The previous implementation used `command.split(/\s+)`
 * which mishandled `cp file "/etc/passwd"` — the token was `"/etc/passwd"`
 * (with literal quotes), and `resolve(workspace, '"/etc/passwd"')` was
 * treated as a relative path inside the workspace. We now respect quotes
 * so `"/etc/passwd"` is a single token that callers can strip.
 */
function tokenizeShell(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}
