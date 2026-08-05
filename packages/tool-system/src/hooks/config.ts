/**
 * User-defined hook configuration (P0-8, remediation plan Phase 8).
 *
 * Loads `.goli/hooks.json` and validates it against a Zod schema.
 * User hooks are simple declarative rules (block / log) that run
 * alongside the built-in hooks (block-secrets, block-destructive,
 * etc.). For programmatic hooks (custom handlers), users still need
 * to write TypeScript — this config covers the common case of
 * "block bash commands matching X" or "log every write to a .ts file".
 *
 * @module tools/hooks/config
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { z } from 'zod';

/**
 * P0-8: The condition under which a user hook fires.
 * - `always`: fires on every call to the matched tool.
 * - `command-match`: fires when the tool's `command` arg matches the
 *   regex `pattern` (for `bash`).
 * - `path-match`: fires when the tool's `file_path` arg matches the
 *   regex `pattern` (for `write_file` / `edit_file` / `read_file`).
 */
export const HookConditionSchema = z.object({
  type: z.enum(['always', 'command-match', 'path-match']),
  pattern: z.string().optional(),
}).optional();

/**
 * P0-8: A single user-defined hook. The `action` field determines
 * what happens when the hook fires:
 * - `block`: the tool call is denied. `message` is shown to the user.
 * - `log`: the tool call proceeds, but a log entry is written.
 * - `modify`: (future) the tool's args are rewritten. Not implemented
 *   in this phase — the schema accepts it for forward compatibility.
 */
export const UserHookSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['pre', 'post']),
  tool: z.string().or(z.literal('*')),
  action: z.enum(['block', 'log', 'modify']),
  condition: HookConditionSchema,
  message: z.string().optional(),
  disabled: z.boolean().optional(),
});

/**
 * P0-8: The top-level `.goli/hooks.json` schema.
 */
export const UserHookConfigSchema = z.object({
  hooks: z.array(UserHookSchema),
});

/**
 *
 */
export type UserHook = z.infer<typeof UserHookSchema>;
/**
 *
 */
export type UserHookConfig = z.infer<typeof UserHookConfigSchema>;

/**
 * P0-8: Load user hooks from a `.goli/hooks.json` file.
 *
 * Returns `{ hooks: [] }` when the file doesn't exist (the common
 * case — user hooks are opt-in). Throws when the file exists but
 * contains invalid JSON or fails Zod validation (the user should
 * fix their config before starting a session).
 *
 * @param configPath - Path to the hooks config file. Default: `.goli/hooks.json`.
 * @returns The parsed + validated hook config.
 */
export function loadUserHooks(configPath: string = '.goli/hooks.json'): UserHookConfig {
  if (!existsSync(configPath)) {
    return { hooks: [] };
  }
  let content: string;
  try {
    content = readFileSync(configPath, 'utf-8');
  } catch (err) {
    throw new Error(`Failed to read hook config at ${configPath}: ${err instanceof Error ? err.message : String(err)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error(`Invalid JSON in hook config at ${configPath}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const result = UserHookConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid hook config at ${configPath}:\n${issues}`);
  }
  return result.data;
}

/**
 * P0-8: Save user hooks to a `.goli/hooks.json` file. Creates the
 * parent directory if it doesn't exist.
 *
 * @param config - The hook config to save.
 * @param configPath - Path to the hooks config file. Default: `.goli/hooks.json`.
 */
export function saveUserHooks(config: UserHookConfig, configPath: string = '.goli/hooks.json'): void {
  mkdirSync(dirname(configPath), { recursive: true });
  const content = JSON.stringify(config, null, 2) + '\n';
  writeFileSync(configPath, content, 'utf-8');
}

/**
 * P0-8: Check whether a user hook matches a given tool call.
 *
 * A hook matches when:
 *   1. `hook.tool === '*'` OR `hook.tool === toolName`.
 *   2. `hook.condition` is undefined OR `always` OR the regex matches.
 *
 * @param hook - The user hook to check.
 * @param toolName - The tool being called.
 * @param args - The tool's parsed arguments.
 * @returns `true` when the hook should fire.
 */
export function hookMatches(
  hook: UserHook,
  toolName: string,
  args: Record<string, unknown>,
): boolean {
  if (hook.disabled) return false;
  if (hook.tool !== '*' && hook.tool !== toolName) return false;
  if (!hook.condition) return true;
  if (hook.condition.type === 'always') return true;
  const pattern = hook.condition.pattern;
  if (!pattern) return true; // no pattern = match all
  try {
    const regex = new RegExp(pattern);
    if (hook.condition.type === 'command-match' && typeof args['command'] === 'string') {
      return regex.test(args['command']);
    }
    if (hook.condition.type === 'path-match') {
      const filePath = args['file_path'] ?? args['notebook_path'];
      if (typeof filePath === 'string') {
        return regex.test(filePath);
      }
    }
  } catch {
    // Invalid regex — don't match (avoid crashing the tool call).
  }
  return false;
}
