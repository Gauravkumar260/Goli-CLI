/**
 * theme/agents.ts — Static data for the TUI surface.
 *
 * Mirrors the static blocks in docs/GoliCLI.jsx. Centralized so a
 * future real backend can drive these from a registry.
 */
import { T } from './tokens.js';

/**
 * T-MODE: The user-facing permission mode. Replaces the old T0-T3/BLK tier system.
 * Four modes that are intuitive and map to real use cases:
 *   - read-only: can only read files, no writes or exec (was T0)
 *   - plan: read-only + no edits, for planning before building (was permissionMode 'plan')
 *   - build: default, full permissions per tool tier (was T1/T2 + default mode)
 *   - god: maximum autonomy, bypass all gates (was BLK + GOD mode)
 */
export type AppMode = 'read-only' | 'plan' | 'build' | 'god';

/**
 * Legacy tier ID type — kept for backward compatibility with ToolTier in the
 * core tools layer. The user-facing UI no longer uses this.
 */
export type TierId = 'T0' | 'T1' | 'T2' | 'T3' | 'BLK';

/**
 *
 */
export interface ModeInfo {
  id: AppMode;
  c: string;     // hex color
  d: string;     // short description
}

/**
 *
 */
export const MODES: ModeInfo[] = [
  { id: 'read-only', c: T.teal,   d: 'read-only, no writes' },
  { id: 'plan',      c: T.yellow, d: 'plan mode, no edits' },
  { id: 'build',     c: T.green,  d: 'full permissions (default)' },
  { id: 'god',       c: T.red,    d: 'maximum autonomy, bypass all gates' },
];

/**
 *
 */
export interface Agent {
  id: string;
  c: string;     // hex color
  t: string;     // short capability list
  d: string;     // one-line description
}

/**
 *
 */
export const AGENTS: Agent[] = [
  { id: 'orchestrator', c: T.purple, t: 'routing, planning', d: 'Routes tasks to the right agent' },
  { id: 'coder',        c: T.green,  t: 'implementation',    d: 'Writes and edits code' },
  { id: 'reviewer',     c: T.blue,   t: 'audit, testing',    d: 'Reviews code and runs tests' },
  { id: 'searcher',     c: T.teal,   t: 'research, docs',    d: 'Searches docs and web' },
  { id: 'devops',       c: T.orange, t: 'infra, CI/CD',      d: 'Manages infrastructure' },
  { id: 'designer',     c: T.yellow, t: 'UI/UX, design',     d: 'Designs interfaces' },
  { id: 'security',     c: T.red,    t: 'audit, vuln scan',  d: 'Security analysis' },
  { id: 'data',         c: T.fg,     t: 'analysis, ETL',     d: 'Data processing' },
];

/**
 *
 */
export const SKILLS = [
  { id: 'code-gen',     c: T.green,  d: 'Generate code from spec' },
  { id: 'refactor',     c: T.blue,   d: 'Refactor for clarity/perf' },
  { id: 'test-gen',     c: T.teal,   d: 'Generate test cases' },
  { id: 'debug',        c: T.red,    d: 'Diagnose and fix bugs' },
  { id: 'review',       c: T.yellow, d: 'Code review + suggestions' },
  { id: 'docs',         c: T.purple, d: 'Generate documentation' },
];

/** ASCII art logo. */
export const ART = `
  ╔═══════════════════════════════════════╗
  ║          G O L I - C L I              ║
  ║     Multi-Agent Software Swarm        ║
  ╚═══════════════════════════════════════╝
`;

/** Spinner glyphs (braille). */
export const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/** Demo responses for --demo mode. */
export const DEMOS = [
  'I\'m your multi-agent AI coding assistant. Here\'s what I can do:\n\n' +
  '  ● Code generation, review & refactoring (any language)\n' +
  '  ● Bug diagnosis and fixing\n' +
  '  ● Test generation and test-suite running\n' +
  '  ● Documentation generation\n' +
  '  ● Infrastructure and CI/CD management\n\n' +
  'What are we building today?',

  'Routing your request through the orchestrator → it picks the best agent:\n' +
  '  → coder for implementation & file ops\n' +
  '  → reviewer for audits & testing\n' +
  '  → searcher for research & docs\n' +
  '  → devops for infra & CI/CD\n\n' +
  'What are we building today?',
];

/** Lookup helpers. */

/**
 * Get the color for a mode.
 */
export function getModeColor(id: AppMode): string {
  return MODES.find((m) => m.id === id)?.c ?? T.green;
}

/**
 * Get the description for a mode.
 */
export function getModeDesc(id: AppMode): string {
  return MODES.find((m) => m.id === id)?.d ?? '';
}

/**
 * Legacy helpers — kept for backward compatibility with code that still
 * uses TierId internally. These map old tier IDs to the new mode system.
 */
export function getTierColor(id: TierId): string {
  const mapping: Record<TierId, string> = {
    'T0': T.teal,
    'T1': T.green,
    'T2': T.yellow,
    'T3': T.orange,
    'BLK': T.red,
  };
  return mapping[id] ?? T.green;
}

/**
 *
 */
export function getTierDesc(id: TierId): string {
  const mapping: Record<TierId, string> = {
    'T0': 'read-only',
    'T1': 'read + write',
    'T2': 'read + write + exec',
    'T3': 'full network',
    'BLK': 'all permissions',
  };
  return mapping[id] ?? '';
}

/**
 * Map an AppMode to the legacy TierId for backward compatibility
 * with the core tools layer (which still uses ToolTier internally).
 */
export function modeToTierId(mode: AppMode): TierId {
  switch (mode) {
    case 'read-only': return 'T0';
    case 'plan':      return 'T0';
    case 'build':     return 'T1';
    case 'god':       return 'BLK';
  }
}

/**
 * Map an AppMode to the legacy RunMode.
 */
export function modeToRunMode(mode: AppMode): 'SAFE' | 'GOD' {
  return mode === 'god' ? 'GOD' : 'SAFE';
}

/**
 * Map an AppMode to the legacy PermissionMode.
 */
export function modeToPermissionMode(mode: AppMode): 'plan' | 'default' | 'auto' | 'bypass' {
  switch (mode) {
    case 'read-only': return 'default';
    case 'plan':      return 'plan';
    case 'build':     return 'default';
    case 'god':       return 'bypass';
  }
}

/**
 *
 */
export function getAgent(id: string): Agent | undefined {
  return AGENTS.find((a) => a.id === id);
}
