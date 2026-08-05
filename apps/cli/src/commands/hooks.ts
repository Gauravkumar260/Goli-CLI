/**
 * `goli hooks` — Manage user-defined tool hooks (P0-8).
 *
 * Subcommands:
 *   - `goli hooks list` — list all configured hooks
 *   - `goli hooks add` — add a new hook
 *   - `goli hooks remove <name>` — remove a hook by name
 *   - `goli hooks enable <name>` — enable a disabled hook
 *   - `goli hooks disable <name>` — disable a hook without removing it
 *
 * Hooks are stored in `.goli/hooks.json` (created on first `add`).
 * The schema is documented in `docs/user/how-to/custom-hooks.md`.
 *
 * @module commands/hooks
 */

import { loadUserHooks, saveUserHooks, type UserHook } from '@goli/core';

const CONFIG_PATH = '.goli/hooks.json';

/**
 * Run the `goli hooks list` command.
 */
export async function runHooksList(): Promise<number> {
  let config;
  try {
    config = loadUserHooks(CONFIG_PATH);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
  if (config.hooks.length === 0) {
    console.log('No user hooks configured.');
    console.log('Use "goli hooks add" to create one. See docs/user/how-to/custom-hooks.md.');
    return 0;
  }
  console.log(`Hooks (${config.hooks.length}):`);
  for (const hook of config.hooks) {
    const status = hook.disabled ? ' [disabled]' : '';
    const cond = hook.condition
      ? ` when ${hook.condition.type}${hook.condition.pattern ? ` ~/${hook.condition.pattern}/` : ''}`
      : '';
    const msg = hook.message ? ` "${hook.message}"` : '';
    console.log(`  ${hook.name} [${hook.type}/${hook.tool}] → ${hook.action}${cond}${msg}${status}`);
  }
  return 0;
}

/**
 * Run the `goli hooks add` command.
 */
export async function runHooksAdd(opts: {
  name: string;
  type: string;
  tool: string;
  action: string;
  conditionType?: string;
  conditionPattern?: string;
  message?: string;
}): Promise<number> {
  let config;
  try {
    config = loadUserHooks(CONFIG_PATH);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
  // Check for duplicate name.
  if (config.hooks.some((h) => h.name === opts.name)) {
    console.error(`Hook "${opts.name}" already exists. Use a different name or remove the existing hook first.`);
    return 1;
  }
  const newHook: UserHook = {
    name: opts.name,
    type: opts.type as 'pre' | 'post',
    tool: opts.tool,
    action: opts.action as 'block' | 'log' | 'modify',
    condition: opts.conditionType
      ? {
          type: opts.conditionType as 'always' | 'command-match' | 'path-match',
          pattern: opts.conditionPattern,
        }
      : undefined,
    message: opts.message,
    disabled: false,
  };
  config.hooks.push(newHook);
  try {
    saveUserHooks(config, CONFIG_PATH);
  } catch (err) {
    console.error(`Failed to save hook config: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  console.log(`Hook "${opts.name}" added to ${CONFIG_PATH}.`);
  return 0;
}

/**
 * Run the `goli hooks remove <name>` command.
 */
export async function runHooksRemove(name: string): Promise<number> {
  let config;
  try {
    config = loadUserHooks(CONFIG_PATH);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
  const before = config.hooks.length;
  config.hooks = config.hooks.filter((h) => h.name !== name);
  if (config.hooks.length === before) {
    console.error(`Hook "${name}" not found.`);
    return 1;
  }
  try {
    saveUserHooks(config, CONFIG_PATH);
  } catch (err) {
    console.error(`Failed to save hook config: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  console.log(`Hook "${name}" removed.`);
  return 0;
}

/**
 * Run the `goli hooks enable <name>` command.
 */
export async function runHooksEnable(name: string): Promise<number> {
  return runHooksToggle(name, false);
}

/**
 * Run the `goli hooks disable <name>` command.
 */
export async function runHooksDisable(name: string): Promise<number> {
  return runHooksToggle(name, true);
}

/**
 * Toggle the `disabled` field on a hook.
 */
async function runHooksToggle(name: string, disabled: boolean): Promise<number> {
  let config;
  try {
    config = loadUserHooks(CONFIG_PATH);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
  const hook = config.hooks.find((h) => h.name === name);
  if (!hook) {
    console.error(`Hook "${name}" not found.`);
    return 1;
  }
  hook.disabled = disabled;
  try {
    saveUserHooks(config, CONFIG_PATH);
  } catch (err) {
    console.error(`Failed to save hook config: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  console.log(`Hook "${name}" ${disabled ? 'disabled' : 'enabled'}.`);
  return 0;
}
