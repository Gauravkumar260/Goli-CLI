/**
 * lib/keymap.ts — Centralized keybinding registry.
 *
 * Implements Reference Manual §2.10 (Goli-CLI Proposed Keymap) and
 * §8.1 (ship keybindings.json from day one).
 *
 * All keyboard shortcuts are defined HERE, not hardcoded in individual
 * components. Components look up their bindings by action name.
 *
 * JSON-override support (~/.goli-cli/keybindings.json) is built into
 * the KeyMap class — ship a `defaults` array, then read the user's
 * overrides from disk. Each binding has a category for the `?` help
 * panel (auto-generated, matching Bubbles' `help` component pattern
 * from Reference Manual §3.5).
 */

/**
 *
 */
export type KeyCategory = 'global' | 'navigation' | 'input' | 'session' | 'permission';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 *
 */
export interface KeyBinding {
  /** Human-readable description for the help panel. */
  description: string;
  /** Category for grouping in help output. */
  category: KeyCategory;
  /** Default key combos (e.g. ['ctrl+d'], ['ctrl+k']). */
  defaultKeys: string[];
  /**
   * User-overridden key combos (loaded from ~/.goli-cli/keybindings.json).
   * When present, these REPLACE defaultKeys entirely.
   */
  overrideKeys?: string[];
  /** When true, this binding cannot be unbound or changed. */
  protected?: boolean;
}

/**
 *
 */
export class KeyMap {
  private bindings = new Map<string, KeyBinding>();

  /**
   * Register a single binding.
   */
  register(action: string, binding: KeyBinding): void {
    this.bindings.set(action, binding);
  }

  /**
   * Get a binding by action name.
   */
  get(action: string): KeyBinding | undefined {
    return this.bindings.get(action);
  }

  /**
   * Get all bindings as [action, binding] pairs.
   */
  entries(): [string, KeyBinding][] {
    return [...this.bindings.entries()];
  }

  /**
   * Get all bindings in a category.
   */
  getByCategory(category: KeyCategory): [string, KeyBinding][] {
    return this.entries().filter(([, b]) => b.category === category);
  }

  /**
   * Get the effective keys for an action (override or default).
   */
  keysFor(action: string): string[] {
    const b = this.bindings.get(action);
    if (!b) return [];
    return b.overrideKeys ?? b.defaultKeys;
  }

  /**
   * Find the first action that matches a given key combo string.
   * Used at dispatch time.
   */
  actionForKey(combo: string): string | undefined {
    for (const [action, b] of this.bindings) {
      const keys = b.overrideKeys ?? b.defaultKeys;
      if (keys.includes(combo)) return action;
    }
    return undefined;
  }
}

// ─── Default keybindings (Reference Manual §2.10) ──────────────────────

/**
 *
 */
export const DEFAULT_BINDINGS: [string, KeyBinding][] = [
  // ── Global ─────────────────────────────────────────────────────────
  ['interrupt', {
    description: 'Interrupt agent (double-press <2s forces exit)',
    category: 'global',
    defaultKeys: ['ctrl+c'],
    protected: true,
  }],
  ['abort', {
    description: 'Cancel/abort current operation',
    category: 'global',
    defaultKeys: ['escape'],
    protected: true,
  }],
  ['exit', {
    description: 'Exit Goli-CLI',
    category: 'global',
    defaultKeys: ['ctrl+d'],
    protected: true,
  }],
  ['suspend', {
    description: 'Suspend to background',
    category: 'global',
    defaultKeys: ['ctrl+z'],
  }],
  ['toggleGodMode', {
    description: 'Toggle Safe ↔ God mode',
    category: 'global',
    defaultKeys: ['ctrl+g'],
  }],
  ['toggleDesign', {
    description: 'Toggle SplashBox ↔ compact header',
    category: 'global',
    defaultKeys: ['ctrl+\\'],
  }],

  // ── Navigation ─────────────────────────────────────────────────────
  ['commandPalette', {
    description: 'Open command palette',
    category: 'navigation',
    defaultKeys: ['ctrl+p'],
  }],
  ['historySearch', {
    description: 'Reverse prompt history search',
    category: 'navigation',
    defaultKeys: ['ctrl+r'],
  }],
  ['openEditor', {
    description: 'Open composer in $EDITOR',
    category: 'navigation',
    defaultKeys: ['ctrl+o'],
  }],
  ['cycleMode', {
    description: 'Cycle Safe → God → Plan mode',
    category: 'navigation',
    defaultKeys: ['shift+tab'],
  }],
  ['copyResponse', {
    description: 'Copy latest completed response',
    category: 'navigation',
    defaultKeys: ['ctrl+shift+c'],
  }],
  ['clearScreen', {
    description: 'Clear the terminal screen',
    category: 'navigation',
    defaultKeys: ['ctrl+l'],
  }],
  ['helpPanel', {
    description: 'Toggle shortcut help panel',
    category: 'navigation',
    defaultKeys: ['?'],
  }],

  // ── Input ──────────────────────────────────────────────────────────
  ['submit', {
    description: 'Send message',
    category: 'input',
    defaultKeys: ['return'],
    protected: true,
  }],
  ['newLine', {
    description: 'New line (multiline input)',
    category: 'input',
    defaultKeys: ['alt+return', 'ctrl+j'],
  }],

  // ── Permission ─────────────────────────────────────────────────────
  ['fastApprove', {
    description: 'Fast-approve pending permission',
    category: 'permission',
    defaultKeys: ['ctrl+shift+k'],
  }],
  ['approveOnce', {
    description: 'Approve this permission once',
    category: 'permission',
    defaultKeys: ['y'],
  }],
  ['approveAlways', {
    description: 'Approve this permission always',
    category: 'permission',
    defaultKeys: ['a'],
  }],
  ['deny', {
    description: 'Deny this permission',
    category: 'permission',
    defaultKeys: ['n'],
  }],
  ['viewDiff', {
    description: 'View full tool argument',
    category: 'permission',
    defaultKeys: ['v'],
  }],
  ['editArg', {
    description: 'Edit tool argument in $EDITOR',
    category: 'permission',
    defaultKeys: ['e'],
  }],
];

// ─── Singleton ─────────────────────────────────────────────────────────

/**
 *
 */
export const globalKeyMap = new KeyMap();

for (const [action, binding] of DEFAULT_BINDINGS) {
  globalKeyMap.register(action, binding);
}

/**
 * Load ~/.goli-cli/keybindings.json and apply overrides.
 * Returns a count of overrides applied (0 if no file / error).
 * Malformed JSON for a single entry falls back to defaults for
 * that entry only (Antigravity pattern).
 */
export function loadKeyOverrides(): number {
  try {
    // Inline require to avoid top-level FS dependency at module init.
    
    
    const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
    if (!home) return 0;
    const filePath = join(home, '.goli-cli', 'keybindings.json');
    if (!existsSync(filePath)) return 0;
    const raw = readFileSync(filePath, 'utf-8');
    const overrides: Record<string, string[]> = JSON.parse(raw);
    let count = 0;
    for (const [action, keys] of Object.entries(overrides)) {
      const binding = globalKeyMap.get(action);
      if (!binding) continue; // unknown action, skip
      if (binding.protected) continue; // protected bindings can't be overridden
      if (keys.length === 0 || (keys.length === 1 && keys[0] === 'none')) {
        // "none" = explicit unbind — store empty array
        binding.overrideKeys = [];
      } else {
        binding.overrideKeys = keys;
      }
      count++;
    }
    return count;
  } catch {
    return 0;
  }
}
