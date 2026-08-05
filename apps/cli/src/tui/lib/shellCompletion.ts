/**
 * lib/shellCompletion.ts — Shell command Tab completion for ! prefix (T-092).
 *
 * Reference: gemini-cli's `useShellCompletion.ts` + `shell-completions/`
 * providers (gitProvider, npmProvider). When the user types `!git ` and
 * presses Tab, it lists git subcommands.
 *
 * This module provides:
 *   - Basic shell command completion (from PATH)
 *   - Git subcommand completion (add, commit, push, etc.)
 *   - npm subcommand completion (install, run, test, etc.)
 *
 * The PromptInput component wires it into the Tab key handler when the
 * input starts with `!`.
 *
 * @module lib/shellCompletion
 */

/** Maximum number of completions to return. */
export const MAX_SHELL_COMPLETIONS = 20;

/**
 * A shell completion candidate.
 */
export interface ShellCompletion {
  /** The completion value to insert (without the leading !). */
  value: string;
  /** The display label. */
  label: string;
  /** Whether this is a subcommand (vs a binary name). */
  isSubcommand: boolean;
}

/**
 * Git subcommands for completion.
 */
const GIT_SUBCOMMANDS: readonly string[] = [
  'add', 'branch', 'checkout', 'clone', 'commit', 'config', 'diff',
  'fetch', 'init', 'log', 'merge', 'pull', 'push', 'rebase', 'reset',
  'restore', 'rm', 'stash', 'status', 'switch', 'tag',
];

/**
 * npm subcommands for completion.
 */
const NPM_SUBCOMMANDS: readonly string[] = [
  'install', 'i', 'add', 'remove', 'rm', 'run', 'run-script', 'test',
  't', 'start', 'stop', 'restart', 'build', 'publish', 'unpublish',
  'update', 'outdated', 'audit', 'ls', 'list', 'init', 'link', 'unlink',
  'ci', 'exec', 'create',
];

/**
 * Common shell binaries for fallback completion.
 */
const COMMON_BINARIES: readonly string[] = [
  'ls', 'cd', 'pwd', 'echo', 'cat', 'grep', 'find', 'mkdir', 'rmdir',
  'rm', 'cp', 'mv', 'touch', 'chmod', 'chown', 'head', 'tail', 'wc',
  'sort', 'uniq', 'cut', 'tr', 'sed', 'awk', 'curl', 'wget', 'ssh',
  'scp', 'rsync', 'tar', 'gzip', 'gunzip', 'zip', 'unzip', 'git',
  'npm', 'node', 'npx', 'pnpm', 'yarn', 'python', 'python3', 'pip',
  'cargo', 'go', 'rustc', 'make', 'cmake', 'docker', 'kubectl',
  'helm', 'terraform', 'ansible', 'vagrant', 'sudo', 'man', 'which',
  'whereis', 'locate', 'history', 'alias', 'export', 'source',
];

/**
 * Get shell completions for a partial command typed after `!`.
 *
 * @param partial The command typed so far (without the leading `!`).
 *                e.g. "git", "git ad", "npm in".
 * @returns Array of completion candidates (max MAX_SHELL_COMPLETIONS).
 */
export function getShellCompletions(partial: string): ShellCompletion[] {
  if (partial.length === 0) {
    // List common binaries.
    return COMMON_BINARIES.slice(0, MAX_SHELL_COMPLETIONS).map((cmd) => ({
      value: cmd,
      label: cmd,
      isSubcommand: false,
    }));
  }

  const parts = partial.split(/\s+/);

  // Single word — complete binary name.
  if (parts.length === 1) {
    const prefix = parts[0]!;
    return COMMON_BINARIES
      .filter((cmd) => cmd.startsWith(prefix))
      .slice(0, MAX_SHELL_COMPLETIONS)
      .map((cmd) => ({ value: cmd, label: cmd, isSubcommand: false }));
  }

  // Two+ words — complete subcommand for known tools.
  const binary = parts[0]!;
  const subcmdPrefix = parts[1] ?? '';
  const typed_rest = parts.slice(2).join(' ');

  let subcommands: readonly string[] = [];
  if (binary === 'git') subcommands = GIT_SUBCOMMANDS;
  else if (binary === 'npm' || binary === 'pnpm' || binary === 'yarn') subcommands = NPM_SUBCOMMANDS;

  if (subcommands.length === 0) return [];

  return subcommands
    .filter((sc) => sc.startsWith(subcmdPrefix))
    .slice(0, MAX_SHELL_COMPLETIONS)
    .map((sc) => ({
      value: typed_rest.length > 0 ? `${binary} ${sc} ${typed_rest}` : `${binary} ${sc}`,
      label: sc,
      isSubcommand: true,
    }));
}
