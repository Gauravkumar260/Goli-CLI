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

import { resolve } from 'node:path';

import type { Hook, HookContext, PreToolUseHookResult } from '../types.js';

/** Sensitive file patterns (always denied). */
const SECRET_PATTERNS: RegExp[] = [
  /\.env$/, // .env
  /\.env\./, // .env.local, .env.production, etc.
  /id_rsa$/, // SSH private key
  /id_ed25519$/, // SSH private key (ed25519)
  /id_ecdsa$/, // SSH private key (ecdsa)
  /authorized_keys$/, // SSH authorized keys
  /\.pem$/, // PEM certificates / keys
  /\.key$/, // Private key files
  /credentials\.json$/, // Cloud credentials
  /\.aws\/credentials$/, // AWS credentials
  /\.gnupg\//, // GPG directory
  /\.ssh\//, // SSH directory
  /\/\.netrc$/, // Netrc file
  /\/\.npmrc$/, // NPM auth token
  /\/\.pypirc$/, // PyPI auth token
];

/** The block_secrets hook. */
export const BLOCK_SECRETS_HOOK: Hook = {
  name: 'block_secrets',
  event: 'PreToolUse',
  handler: (ctx: HookContext): PreToolUseHookResult => {
    // Only check file-access tools
    const fileTools = ['read_file', 'write_file', 'edit_file', 'list_directory', 'grep'];
    if (!fileTools.includes(ctx.toolName)) {
      return { decision: 'allow' };
    }

    // God mode bypasses secret blocking (user accepted the risk)
    if (ctx.godMode) {
      return { decision: 'allow' };
    }

    // Check the file_path argument
    const filePath = (ctx.args['file_path'] as string) ?? (ctx.args['path'] as string) ?? '';
    if (!filePath) {
      return { decision: 'allow' };
    }

    // Resolve to absolute path for checking
    const absolutePath = resolve(ctx.workspaceRoot, filePath);

    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(absolutePath) || pattern.test(filePath)) {
        return {
          decision: 'deny',
          reason: `Blocked by block_secrets: access to sensitive file/path denied (${filePath}). This file may contain secrets (API keys, SSH keys, credentials).`,
        };
      }
    }

    return { decision: 'allow' };
  },
  priority: 20, // Run after block_destructive
  disableable: false,
};
