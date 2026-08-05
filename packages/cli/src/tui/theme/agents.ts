/**
 * theme/agents.ts — Static data for the TUI surface.
 *
 * Mirrors the static blocks in docs/GoliCLI.jsx. Centralized so a
 * future real backend can drive these from a registry.
 */
import { T } from './tokens.js';

/**
 * P1-16 fix: Color-name type — the keys of `T` that represent colors.
 *
 * Previously `MODES`, `AGENTS`, and `SKILLS` captured `T.teal`,
 * `T.green`, etc. AT MODULE-LOAD TIME. When `applySkinToTokens()` later
 * mutated `T` (live theme switch), these arrays still held the ORIGINAL
 * color values, so `getModeColor('read-only')` returned the OLD theme's
 * teal instead of the new skin's teal. The live theme switching only
 * worked for components that read `T.red` directly on each render —
 * not for components that went through `getModeColor()` / `getAgent()`.
 *
 * Fix: Store color NAMES (keys of `T`) in the static arrays, and look
 * up `T[name]` lazily inside the getter functions. This way the getter
 * always reads the CURRENT value of `T[name]` after a skin swap.
 */
type ColorName =
  | 'teal' | 'green' | 'yellow' | 'red' | 'purple'
  | 'blue' | 'orange' | 'fg';

/**
 * T-MODE: The user-facing permission mode. Replaces the old T0-T3/BLK tier system.
 * Five modes that are intuitive and map to real use cases:
 *   - read-only: can only read files, no writes or exec (was T0)
 *   - plan: read-only + no edits, for planning before building (was permissionMode 'plan')
 *   - build: default, full permissions per tool tier (was T1/T2 + default mode)
 *   - god: maximum autonomy, bypass all gates (was BLK + GOD mode)
 *   - local-llms: build permissions + three-axis router across local Ollama
 *     workers (qwen3.5:4b / qwen2.5-coder:7b / qwen3:4b / gemma3:4b) and a
 *     cloud tier (gpt-oss:120b-cloud), gated by sensitivity / complexity /
 *     availability.
 */
export type AppMode = 'read-only' | 'plan' | 'build' | 'god' | 'local-llms';

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
  /** P1-16 fix: color NAME (key of T), looked up lazily so live theme switches propagate. */
  c: ColorName;
  d: string;     // short description
}

/**
 *
 */
export const MODES: ModeInfo[] = [
  { id: 'read-only',  c: 'teal',   d: 'read-only, no writes' },
  { id: 'plan',       c: 'yellow', d: 'plan mode, no edits' },
  { id: 'build',      c: 'green',  d: 'full permissions (default)' },
  { id: 'god',        c: 'red',    d: 'maximum autonomy, bypass all gates' },
  { id: 'local-llms', c: 'purple', d: 'three-axis local-LLM router (sensitivity/complexity/availability)' },
];

/**
 *
 */
export interface Agent {
  id: string;
  /** P1-16 fix: color NAME (key of T), looked up lazily so live theme switches propagate. */
  c: ColorName;
  t: string;     // short capability list
  d: string;     // one-line description
}

/**
 *
 */
export const AGENTS: Agent[] = [
  { id: 'orchestrator', c: 'purple', t: 'routing, planning', d: 'Routes tasks to the right agent' },
  { id: 'coder',        c: 'green',  t: 'implementation',    d: 'Writes and edits code' },
  { id: 'reviewer',     c: 'blue',   t: 'audit, testing',    d: 'Reviews code and runs tests' },
  { id: 'searcher',     c: 'teal',   t: 'research, docs',    d: 'Searches docs and web' },
  { id: 'devops',       c: 'orange', t: 'infra, CI/CD',      d: 'Manages infrastructure' },
  { id: 'designer',     c: 'yellow', t: 'UI/UX, design',     d: 'Designs interfaces' },
  { id: 'security',     c: 'red',    t: 'audit, vuln scan',  d: 'Security analysis' },
  { id: 'data',         c: 'fg',     t: 'analysis, ETL',     d: 'Data processing' },
];

interface SkillInfo {
  id: string;
  /** P1-16 fix: color NAME (key of T), looked up lazily so live theme switches propagate. */
  c: ColorName;
  d: string;
}

/**
 *
 */
export const SKILLS: SkillInfo[] = [
  { id: 'code-gen',     c: 'green',  d: 'Generate code from spec' },
  { id: 'refactor',     c: 'blue',   d: 'Refactor for clarity/perf' },
  { id: 'test-gen',     c: 'teal',   d: 'Generate test cases' },
  { id: 'debug',        c: 'red',    d: 'Diagnose and fix bugs' },
  { id: 'review',       c: 'yellow', d: 'Code review + suggestions' },
  { id: 'docs',         c: 'purple', d: 'Generate documentation' },
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
 *
 * P1-16 fix: Looks up `T[colorName]` lazily on each call so live theme
 * switches propagate. Previously returned the captured-at-load color.
 */
export function getModeColor(id: AppMode): string {
  const m = MODES.find((m) => m.id === id);
  if (!m) return T.green;
  return T[m.c] ?? T.green;
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
 *
 * P1-16 fix: Build the mapping lazily inside the function so `T.*` is
 * read on each call (live theme switch propagation).
 */
export function getTierColor(id: TierId): string {
  const mapping: Record<TierId, ColorName> = {
    'T0': 'teal',
    'T1': 'green',
    'T2': 'yellow',
    'T3': 'orange',
    'BLK': 'red',
  };
  const name = mapping[id];
  return name ? (T[name] ?? T.green) : T.green;
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
    case 'read-only':  return 'T0';
    case 'plan':       return 'T0';
    case 'build':      return 'T1';
    case 'god':        return 'BLK';
    case 'local-llms': return 'T1';
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
    case 'read-only':  return 'default';
    case 'plan':       return 'plan';
    case 'build':      return 'default';
    case 'god':        return 'bypass';
    case 'local-llms': return 'default';
  }
}

/**
 *
 */
export function getAgent(id: string): Agent | undefined {
  return AGENTS.find((a) => a.id === id);
}

/**
 * P1-16 fix: Lazily resolve an agent's color from `T` so live theme
 * switches propagate. Use this in components that previously read
 * `agent.c` directly — `agent.c` is now a ColorName, not a hex string.
 */
export function getAgentColor(id: string): string {
  const a = AGENTS.find((a) => a.id === id);
  if (!a) return T.green;
  return T[a.c] ?? T.green;
}
