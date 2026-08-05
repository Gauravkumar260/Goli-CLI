/**
 * auto_format hook (Module 3, part 2).
 *
 * PostToolUse hook that runs a code formatter after write_file/edit_file.
 * Detects the formatter based on file extension:
 * - `.ts`, `.tsx`, `.js`, `.jsx`, `.json` → prettier
 * - `.py` → black
 * - `.rs` → rustfmt
 * - `.go` → gofmt
 * - `.md` → prettier (markdown)
 *
 * If no formatter is installed, the hook silently passes (non-fatal).
 *
 * @module tools/hooks/builtin/auto-format
 */

import { execFileSync } from 'node:child_process';
import { extname } from 'node:path';

import type { Hook, HookContext, PostToolUseHookResult } from '../types.js';

/**
 * Map file extensions to formatter specs.
 *
 * Each spec has:
 * - `bin`: the binary to invoke (no args).
 * - `args`: the base args (e.g. `['--write']` for prettier, `['-w']` for gofmt).
 * - `checkBin`: the binary to check for availability.
 * - `checkArgs`: args for the availability check (e.g. `['--version']`).
 * - `label`: human-readable name for feedback messages.
 *
 * We invoke formatters via `execFileSync(bin, [...args, filePath])` — NEVER
 * via a shell string — so file paths containing shell metacharacters
 * (`"`, `;`, `$()`, backticks) cannot inject commands.
 */
interface FormatterSpec {
  bin: string;
  args: string[];
  checkBin: string;
  checkArgs: string[];
  label: string;
}

const FORMATTER_MAP: Record<string, FormatterSpec> = {
  '.ts': { bin: 'npx', args: ['prettier', '--write'], checkBin: 'npx', checkArgs: ['prettier', '--version'], label: 'prettier' },
  '.tsx': { bin: 'npx', args: ['prettier', '--write'], checkBin: 'npx', checkArgs: ['prettier', '--version'], label: 'prettier' },
  '.js': { bin: 'npx', args: ['prettier', '--write'], checkBin: 'npx', checkArgs: ['prettier', '--version'], label: 'prettier' },
  '.jsx': { bin: 'npx', args: ['prettier', '--write'], checkBin: 'npx', checkArgs: ['prettier', '--version'], label: 'prettier' },
  '.json': { bin: 'npx', args: ['prettier', '--write'], checkBin: 'npx', checkArgs: ['prettier', '--version'], label: 'prettier' },
  '.md': { bin: 'npx', args: ['prettier', '--write'], checkBin: 'npx', checkArgs: ['prettier', '--version'], label: 'prettier' },
  '.css': { bin: 'npx', args: ['prettier', '--write'], checkBin: 'npx', checkArgs: ['prettier', '--version'], label: 'prettier' },
  '.html': { bin: 'npx', args: ['prettier', '--write'], checkBin: 'npx', checkArgs: ['prettier', '--version'], label: 'prettier' },
  '.py': { bin: 'black', args: [], checkBin: 'black', checkArgs: ['--version'], label: 'black' },
  '.rs': { bin: 'rustfmt', args: [], checkBin: 'rustfmt', checkArgs: ['--version'], label: 'rustfmt' },
  '.go': { bin: 'gofmt', args: ['-w'], checkBin: 'gofmt', checkArgs: ['--help'], label: 'gofmt' },
};

/**
 * Cache key for formatter availability.
 * @param spec
 */
function cacheKey(spec: FormatterSpec): string {
  return `${spec.checkBin} ${spec.checkArgs.join(' ')}`;
}

/** Cache of which formatters are available, with a 5-minute TTL. */
const formatterAvailable = new Map<string, { value: boolean; expiresAt: number }>();
const FORMATTER_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Check if a formatter is available (cached with 5-minute TTL).
 *
 * The previous implementation cached forever — if `prettier` was
 * not installed on the first `write_file`, the hook recorded
 * `false` and never re-checked. The user had to restart
 * goli-cli after installing prettier. We now re-check every 5
 * minutes so a newly-installed formatter is detected without
 * a restart.
 * @param spec
 */
function isFormatterAvailable(spec: FormatterSpec): boolean {
  const key = cacheKey(spec);
  const cached = formatterAvailable.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  try {
    execFileSync(spec.checkBin, spec.checkArgs, {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 15_000,
    });
    formatterAvailable.set(key, { value: true, expiresAt: Date.now() + FORMATTER_CACHE_TTL_MS });
    return true;
  } catch {
    formatterAvailable.set(key, { value: false, expiresAt: Date.now() + FORMATTER_CACHE_TTL_MS });
    return false;
  }
}

/** The auto_format hook. */
export const AUTO_FORMAT_HOOK: Hook = {
  name: 'auto_format',
  event: 'PostToolUse',
  toolMatch: ['write_file', 'edit_file'],
  handler: (ctx: HookContext): PostToolUseHookResult => {
    // Only format if the write succeeded
    if (!ctx.result?.ok) {
      return {};
    }

    const rawPath = ctx.args['file_path'];
    const filePath = typeof rawPath === 'string' ? rawPath : '';
    if (!filePath) {
      return {};
    }

    const ext = extname(filePath).toLowerCase();
    const formatter = FORMATTER_MAP[ext];
    if (!formatter) {
      return {}; // No formatter for this file type
    }

    // Check if the formatter is installed
    if (!isFormatterAvailable(formatter)) {
      return {}; // Formatter not available — silently pass
    }

    // Run the formatter via execFileSync with an arg array (no shell).
    // This prevents command injection via file paths containing
    // `"`, `;`, `$()`, backticks, etc.
    try {
      execFileSync(formatter.bin, [...formatter.args, filePath], {
        encoding: 'utf-8',
        cwd: ctx.workspaceRoot,
        stdio: 'pipe',
        timeout: 15_000,
      });
      return {
        feedback: `Formatted ${filePath} with ${formatter.label}`,
      };
    } catch {
      // Formatter failed (syntax error in file?) — non-fatal
      return {
        feedback: `Warning: formatter failed on ${filePath} (file may have syntax errors)`,
      };
    }
  },
  priority: 50,
  disableable: true,
};
