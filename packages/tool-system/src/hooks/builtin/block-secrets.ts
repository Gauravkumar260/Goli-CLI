/**
 * block_secrets hook (Module 3, part 2).
 *
 * PreToolUse hook that denies access to secret/sensitive files:
 * - `.env`, `.env.*` files
 * - SSH keys (`id_rsa`, `id_ed25519`, `authorized_keys`)
 * - `*.pem`, `*.key` files
 * - `credentials.json`, `~/.aws/credentials`
 * - `~/.gnupg/` directory
 * - `~/.ssh/` directory
 *
 * This hook is NOT disableable — it's a mandatory safety hook.
 *
 * @module tools/hooks/builtin/block-secrets
 */

import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Hook, HookContext, PreToolUseHookResult } from '../types.js';

/** Sensitive file patterns (always denied). */
const SECRET_PATTERNS: RegExp[] = [
  /\.env$/, // .env
  /\.env\./, // .env.local, .env.production, etc.
  /\.envrc$/, // direnv
  /id_rsa$/, // SSH private key
  /id_ed25519$/, // SSH private key (ed25519)
  /id_ecdsa$/, // SSH private key (ecdsa)
  /authorized_keys$/, // SSH authorized keys
  /\.pem$/, // PEM certificates / keys
  /\.key$/, // Private key files
  /\.p12$/, // PKCS#12 keystore
  /\.pfx$/, // PFX (Windows) keystore
  /\.jks$/, // Java keystore
  /\.keystore$/, // Generic keystore
  /credentials\.json$/, // Cloud credentials
  /service-account.*\.json$/, // GCP service account
  /firebase-adminsdk-.*\.json$/, // Firebase admin SDK
  /\.aws\/credentials$/, // AWS credentials
  /\.aws\/config$/, // AWS config (also contains keys)
  // Use `(?:/|$)` so the pattern matches both the directory
  // (no trailing slash) and files inside it. The previous
  // implementation required `\.ssh\/` which missed
  // `/home/user/.ssh` (the directory itself, no trailing slash).
  /\.gnupg(?:\/|$)/, // GPG directory
  /\.ssh(?:\/|$)/, // SSH directory
  /\.terraform(?:\/|$)/, // Terraform state directory
  /\.tfvars$/, // Terraform vars (often contains secrets)
  /\.vault-token$/, // Vault token file
  /\/\.netrc$/, // Netrc file
  /\/\.npmrc$/, // NPM auth token
  /\/\.git-credentials$/, // Git credential store
  /\/\.docker\/config\.json$/, // Docker Hub credentials
  /\/\.kube\/config$/, // Kubernetes credentials
  /\/\.config\/gh\/hosts\.yml$/, // GitHub CLI token
  /\/\.ansible\/vault-pass\.txt$/, // Ansible vault password
];

/** The block_secrets hook. */
export const BLOCK_SECRETS_HOOK: Hook = {
  name: 'block_secrets',
  event: 'PreToolUse',
  handler: (ctx: HookContext): PreToolUseHookResult => {
    // File-access tools whose file-path args (`file_path`, `path`,
    // `notebook_path`, `glob`) we inspect. `bash` is intentionally
    // NOT in this list — its `file_path` arg (when present in tests
    // or unused schemas) is not a real file path the tool will read.
    // For `bash` we inspect the `command` string only.
    const filePathTools = ['read_file', 'write_file', 'edit_file', 'list_directory', 'grep', 'notebook_edit'];
    const isFilePathTool = filePathTools.includes(ctx.toolName) || ctx.toolName.startsWith('dyn-');
    const isBashTool = ctx.toolName === 'bash';

    if (!isFilePathTool && !isBashTool) {
      return { decision: 'allow' };
    }

    // God mode bypasses secret blocking (user accepted the risk)
    if (ctx.godMode) {
      return { decision: 'allow' };
    }

    // Helper: check a path against SECRET_PATTERNS, also
    // following symlinks via realpathSync so
    // `workspace/link-to-env` (a symlink to `~/.env`) is caught.
    const isSecret = (rawPath: string): boolean => {
      if (!rawPath) return false;
      const absolutePath = resolve(ctx.workspaceRoot, rawPath);
      for (const pattern of SECRET_PATTERNS) {
        if (pattern.test(absolutePath) || pattern.test(rawPath)) {
          return true;
        }
      }
      // Defense in depth: follow symlinks. The previous
      // implementation only did `resolve(...)` which does NOT
      // follow symlinks — `workspace/link-to-env` (symlink to
      // `~/.env`) returned `workspace/link-to-env`, matching no
      // secret pattern, so the bash tool followed the symlink
      // and read the secret.
      try {
        const real = realpathSync(absolutePath);
        for (const pattern of SECRET_PATTERNS) {
          if (pattern.test(real)) {
            return true;
          }
        }
      } catch {
        // File doesn't exist (write_file case) or realpath failed.
        // The string-match above already covered the in-workspace
        // pattern case.
      }
      return false;
    };

    // Only file-access tools have their file-path / glob args checked.
    // Bash's `file_path` arg (if present) is intentionally NOT checked.
    if (isFilePathTool) {
      const filePath = (ctx.args['file_path'] as string) ??
        (ctx.args['path'] as string) ??
        (ctx.args['notebook_path'] as string) ??
        '';
      const globPattern = (ctx.args['glob'] as string) ?? '';

      if (isSecret(filePath)) {
        return {
          decision: 'deny',
          reason: `Blocked by block_secrets: access to sensitive file/path denied (${filePath}). This file may contain secrets (API keys, SSH keys, credentials).`,
        };
      }

      // Check `glob` patterns — a `grep` with `glob: '**/.env*'` would
      // search every `.env*` file. We block if the glob itself matches
      // any known secret pattern.
      if (globPattern) {
        for (const pattern of SECRET_PATTERNS) {
          // Strip leading `**/` and `*` from the glob for pattern
          // matching (so `**/.env*` reduces to `.env`).
          const stripped = globPattern.replace(/^\*\*\//, '').replace(/\*$/, '');
          if (stripped && pattern.test(stripped)) {
            return {
              decision: 'deny',
              reason: `Blocked by block_secrets: glob pattern '${globPattern}' matches sensitive files.`,
            };
          }
        }
      }
    }

    // Check bash commands for secret-file access. The previous
    // implementation didn't check `bash` at all — `cat ~/.ssh/id_rsa`
    // bypassed the hook.
    if (isBashTool) {
      const command = (ctx.args['command'] as string) ?? '';
      if (command) {
        // Find tokens after cat/head/tail/sed/awk/less/more and check
        // each against SECRET_PATTERNS. This is a heuristic — a full
        // shell parser would be more robust, but the check is
        // defense-in-depth.
        const secretReaders = /\b(?:cat|head|tail|sed|awk|less|more|tee|cp|mv|dd|nano|vim|vi|emacs)\b/;
        const tokens = command.split(/\s+/);
        for (let i = 0; i < tokens.length; i++) {
          const tok = tokens[i]!;
          if (secretReaders.test(tok)) {
            // Walk forward collecting non-flag tokens until a break.
            let j = i + 1;
            while (j < tokens.length) {
              const t = tokens[j]!;
              if (t === ';' || t === '&&' || t === '||' || t === '|' || t === '>') break;
              if (t.startsWith('-')) { j++; continue; }
              // Skip the script arg for sed/awk.
              if ((tok === 'sed' || tok === 'awk') && (t.startsWith("'") || t.startsWith('"'))) { j++; continue; }
              if (isSecret(t)) {
                return {
                  decision: 'deny',
                  reason: `Blocked by block_secrets: bash command accesses sensitive file '${t}'.`,
                };
              }
              j++;
            }
          }
        }
      }
    }

    return { decision: 'allow' };
  },
  priority: 20, // Run after block_destructive
  disableable: false,
};
