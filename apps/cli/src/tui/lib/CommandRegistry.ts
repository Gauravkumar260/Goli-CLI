/**
 * lib/CommandRegistry.ts — Slash command registry + dispatch router.
 *
 * Implements Reference Manual §4.1 (Dual-Path Router):
 *
 *   User presses Enter
 *         │
 *         ▼
 *   Does input start with "/" ?
 *         │
 *    ┌────┴────┐
 *   YES        NO
 *    │          │
 *    ▼          ▼
 * Command    Does it start with "!" or "@" ?
 * Handler         │
 * (synchronous,   ├── "!" → Shell exec (§4.1)
 * no LLM call,    ├── "@" → File picker (§4.1)
 * instant)        └── neither → Agent loop (LLM call)
 */

import type { TierId } from '../theme/agents.js';
// P3-30 fix: consolidate version string
import { APP_VERSION } from '../../constants.js';
import { BUILTIN_SKIN_NAMES, loadSkin } from '../theme/skin-engine.js';
import { applySkinToTokens } from '../theme/tokens.js';
import { getShells as getBackgroundShells } from './backgroundShellRegistry.js';
import type { BackgroundShellEntry } from './backgroundShellRegistry.js';
import {
  getRandomTip,
  getTipsByCategory,
  getTipCount,
  type Tip,
} from './tips.js';
import { globalKeyMap } from './keymap.js';
import {
  getModeDescription,
  getAgentsForMode,
  getSkillsForMode,
  getPromptForMode,
} from './mode-config.js';
import type { AppMode } from '../theme/agents.js';
import { existsSync, statSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';

// ─── Command interface ─────────────────────────────────────────────────

/**
 * The kind of a command — used by SuggestionsDisplay to render a suffix
 * (e.g. [MCP], [Agent]) and to group commands under section headers.
 *
 * T-044 (loop run 5): added to match gemini-cli's CommandKind system.
 */
export type CommandKind = 'builtin' | 'MCP' | 'Agent' | 'custom';

/**
 *
 */
export interface Command {
  name: string;
  description: string;
  usage?: string;
  handler: (args: string[]) => void;
  /**
   * T-044: The kind of command. Defaults to 'builtin' if not specified.
   * Rendered as a suffix in SuggestionsDisplay (e.g. [MCP], [Agent]).
   */
  kind?: CommandKind;
  /**
   * T-044: Section title for grouping in SuggestionsDisplay.
   * Commands with the same sectionTitle render under a "-- Section --" header.
   * If undefined, the command is grouped under the implicit "Built-in" section.
   */
  sectionTitle?: string;
  /**
   * T-054: Alternate names (aliases) for the command.
   * Example: `/theme` could have altNames `['skin', 'colors']`.
   * Reference: gemini-cli SlashCommand.altNames.
   */
  altNames?: string[];
  /**
   * T-054: Whether the command is hidden from the suggestion list.
   * Hidden commands still dispatch but don't appear in /help or autocomplete.
   * Useful for deprecated aliases or easter eggs.
   */
  hidden?: boolean;
  /**
   * T-061: Sub-commands (e.g. `/mcp add`, `/mcp remove`, `/mcp list`).
   * When provided, the dispatcher passes only the remaining args after
   * the subcommand name to the matching subcommand's handler.
   * Reference: gemini-cli SlashCommand.subCommands.
   */
  subCommands?: Command[];
  /**
   * T-061: Async completion provider. Given a partial arg, returns candidate
   * strings for Tab-completion. Reference: gemini-cli SlashCommand.completion.
   */
  completion?: (context: { args: string[]; partialArg: string }) => Promise<string[]> | string[];
  /**
   * T-061: If true, the command auto-executes when selected from the
   * suggestion list (no Enter needed). Useful for quick toggles.
   * Reference: gemini-cli SlashCommand.autoExecute.
   */
  autoExecute?: boolean;
  /**
   * T-061: If true, the command can run concurrently with an in-flight
   * agent turn (no interrupt). Default: false.
   * Reference: gemini-cli SlashCommand.isSafeConcurrent.
   */
  isSafeConcurrent?: boolean;
}

// ─── Registry ──────────────────────────────────────────────────────────

/**
 *
 */
export class CommandRegistry {
  private commands = new Map<string, Command>();
  /** T-054: alias → canonical name map for fast lookup. */
  private aliases = new Map<string, string>();
  /**
   * T-090: Version counter — incremented on every register() call.
   * Components can read this to detect when the registry has changed
   * and re-compute derived values (e.g. the suggestion list in
   * PromptInput). Without this, useMemo(() => registry.entries(), [])
   * captures a stale empty array because registerDefaultCommands()
   * runs AFTER child components mount.
   */
  private _version = 0;

  /** Current version (bumps on every register). */
  get version(): number { return this._version; }

  register(command: Command): void {
    if (this.commands.has(command.name)) {
      console.warn(`[CommandRegistry] duplicate command: /${command.name}`);
    }
    this.commands.set(command.name, command);
    // T-054: register altNames as aliases pointing to the canonical name.
    if (command.altNames) {
      for (const alias of command.altNames) {
        if (this.aliases.has(alias)) {
          console.warn(`[CommandRegistry] duplicate alias: /${alias}`);
        }
        this.aliases.set(alias, command.name);
      }
    }
    this._version++;
  }

  /**
   * Try to dispatch a raw input string. Returns an object describing
   * what happened:
   *
   *   { handled: true }                 — command was dispatched
   *   { handled: false, reason: 'unknown' }  — unknown command
   *   { handled: false, reason: 'passthrough' } — not a command, send to LLM
   *   { handled: false, reason: 'shell' } — ! shell exec (caller handles)
   *   { handled: false, reason: 'filepicker' } — @ file picker
   */
  dispatch(input: string): { handled: boolean; reason?: string } {
    const trimmed = input.trim();

    // Slash commands
    if (trimmed.startsWith('/')) {
      const parts = trimmed.slice(1).split(/\s+/);
      const name = parts[0] ?? '';
      const args = parts.slice(1);
      const cmd = this.resolve(name);
      if (cmd) {
        // T-061: Sub-command dispatch. If the first arg matches a sub-command
        // name, route to the sub-command with the remaining args.
        if (cmd.subCommands && args.length > 0) {
          const subName = args[0] ?? '';
          const sub = cmd.subCommands.find((s) => s.name === subName);
          if (sub) {
            sub.handler(args.slice(1));
            return { handled: true };
          }
        }
        cmd.handler(args);
        return { handled: true };
      }
      return { handled: false, reason: 'unknown' };
    }

    // §4.1 Shell exec (! prefix) — caller handles the execution
    if (trimmed.startsWith('!')) {
      return { handled: false, reason: 'shell' };
    }

    // §4.1 File picker (@ prefix) — caller handles the picker
    if (trimmed.startsWith('@')) {
      return { handled: false, reason: 'filepicker' };
    }

    return { handled: false, reason: 'passthrough' };
  }

  /**
   * T-054: Resolve a name (canonical OR alias) to a Command.
   * Returns undefined if neither the name nor any alias matches.
   */
  resolve(name: string): Command | undefined {
    // Direct hit on canonical name.
    const direct = this.commands.get(name);
    if (direct) return direct;
    // Check aliases.
    const canonical = this.aliases.get(name);
    if (canonical) return this.commands.get(canonical);
    return undefined;
  }

  get(name: string): Command | undefined {
    return this.resolve(name);
  }

  entries(): Command[] {
    return [...this.commands.values()];
  }

  /**
   * T-054: List commands for display (filters out hidden commands).
   * Use this in /help and SuggestionsDisplay instead of entries().
   */
  visibleEntries(): Command[] {
    return this.entries().filter((c) => !c.hidden);
  }

  has(name: string): boolean {
    return this.resolve(name) !== undefined;
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────

/**
 *
 */
export const globalCommands = new CommandRegistry();

// ─── Register default commands ─────────────────────────────────────────

import { AppStateStore } from '../state/AppStateStore.js';

/**
 *
 */
export function registerDefaultCommands(force?: boolean): void {
  if (!force && globalCommands.entries().length > 0) return;

  globalCommands.register({
    name: 'help',
    description: 'Show this help and shortcut reference',
    usage: '/help [command]',
    isSafeConcurrent: true,
    handler: (args: string[]) => {
      if (args.length > 0) {
        const cmd = globalCommands.get(args[0]!);
        if (cmd) {
          AppStateStore.pushSystemMessage(
            `/${cmd.name} — ${cmd.description}${cmd.usage ? `\nUsage: ${cmd.usage}` : ''}`,
            'info',
          );
        } else {
          AppStateStore.pushSystemMessage(`Unknown command: /${args[0]}`, 'warning');
        }
      } else {
        // T-108: Group commands by category for better readability.
        const entries = globalCommands.entries().filter((c) => !c.hidden);
        const groups: Record<string, string[]> = {
          'Session & Mode': [],
          'UI & Display': [],
          'Information': [],
          'Tools & Permissions': [],
          'Other': [],
        };

        // Categorize commands.
        const sessionCmds = ['godmode', 'safemode', 'tier', 'plan', 'build', 'compact', 'clear', 'quit', 'inputmode'];
        const uiCmds = ['theme', 'design', 'vim', 'shortcuts', 'tips'];
        const infoCmds = ['help', 'about', 'stats', 'cost', 'context', 'memory', 'model', 'mcp', 'doctor', 'btw'];
        const toolCmds = ['expand', 'allowlist', 'queue', 'bg'];

        for (const cmd of entries) {
          const line = `  /${cmd.name.padEnd(14, ' ')}  — ${cmd.description}`;
          if (sessionCmds.includes(cmd.name)) {
            groups['Session & Mode']!.push(line);
          } else if (uiCmds.includes(cmd.name)) {
            groups['UI & Display']!.push(line);
          } else if (infoCmds.includes(cmd.name)) {
            groups['Information']!.push(line);
          } else if (toolCmds.includes(cmd.name)) {
            groups['Tools & Permissions']!.push(line);
          } else {
            groups['Other']!.push(line);
          }
        }

        // Build output.
        const lines: string[] = [
          `Available commands (${entries.length} total):`,
          'Use /help <command> for detailed info on a specific command.',
          '',
        ];
        for (const [groupName, cmds] of Object.entries(groups)) {
          if (cmds.length === 0) continue;
          lines.push(`${groupName}:`);
          lines.push(...cmds);
          lines.push('');
        }
        lines.push('Keyboard shortcuts: press ? or use /shortcuts');

        AppStateStore.pushSystemMessage(lines.join('\n'), 'info');
      }
    },
  });

  globalCommands.register({
    name: 'godmode',
    description: 'Toggle Safe ↔ God mode (maximum autonomy)',
    usage: '/godmode',
    handler: () => { AppStateStore.setAppMode('god'); },
  });

  globalCommands.register({
    name: 'safemode',
    description: 'Set mode to Safe (read-only, no writes, no exec)',
    usage: '/safemode',
    handler: () => { AppStateStore.setAppMode('read-only'); },
  });

  // T-MODE: /mode — set or inspect the permission mode.
  // Accepts 'safe' as an alias for 'read-only' (the SAFE MODE label
  // displayed by ApprovalModeIndicator is the read-only AppMode).
  globalCommands.register({
    name: 'mode',
    description: 'Set or inspect permission mode (read-only, plan, build, god, local-llms)',
    usage: '/mode [read-only|safe|plan|build|god|local-llms|info]',
    altNames: ['permission'],
    isSafeConcurrent: true,
    handler: (args: string[]) => {
      const rawArg = args[0] ?? '';
      // 'safe' / 'safe-mode' / 'readonly' are aliases for 'read-only'
      const arg = (() => {
        const lower = rawArg.toLowerCase();
        if (lower === 'safe' || lower === 'safe-mode' || lower === 'safemode' || lower === 'readonly') {
          return 'read-only';
        }
        return rawArg;
      })();
      const validModes = ['read-only', 'plan', 'build', 'god', 'local-llms'];

      // /mode info — show current mode details (agents, skills, prompt)
      if (arg === 'info' || arg === '') {
        const currentMode = AppStateStore.getAppMode();
        const desc = getModeDescription(currentMode);
        const agents = getAgentsForMode(currentMode);
        const skills = getSkillsForMode(currentMode);
        const prompt = getPromptForMode(currentMode);

        const lines = [
          `Mode: ${currentMode}${currentMode === 'read-only' ? ' (SAFE)' : ''}`,
          `Description: ${desc.long}`,
          '',
          `Active Agents (${agents.length}):`,
          ...agents.map((a: string) => `  • ${a}`),
          '',
          `Available Skills (${skills.length}):`,
          ...skills.map((s: string) => `  • ${s}`),
          '',
          `System Prompt:`,
          `  ${prompt.slice(0, 120)}${prompt.length > 120 ? '...' : ''}`,
          '',
          `Use /mode <read-only|safe|plan|build|god|local-llms> to switch modes.`,
        ];
        AppStateStore.pushSystemMessage(lines.join('\n'), 'info');
        return;
      }

      if (validModes.includes(arg)) {
        AppStateStore.setAppMode(arg as any);
        const desc = getModeDescription(arg as AppMode);
        const agents = getAgentsForMode(arg as AppMode);
        const skills = getSkillsForMode(arg as AppMode);
        const label = arg === 'read-only' ? 'read-only (SAFE)' : arg;
        AppStateStore.pushSystemMessage(
          [
            `Mode: ${label} — ${desc.short}`,
            `  Agents: ${agents.join(', ')}`,
            `  Skills: ${skills.join(', ')}`,
          ].join('\n'),
          'info',
        );
      } else {
        AppStateStore.pushSystemMessage(
          `Unknown mode: ${rawArg}. Valid modes: read-only (or safe), plan, build, god, local-llms. Use /mode info for current mode details.`,
          'warning',
        );
      }
    },
  });

  // Legacy /tier command — kept for backward compat, redirects to /mode.
  // Accepts the same aliases as /mode (safe → read-only).
  globalCommands.register({
    name: 'tier',
    description: 'Set permission mode (legacy, use /mode instead)',
    usage: '/tier <read-only|safe|plan|build|god|local-llms>',
    hidden: true,
    handler: (args: string[]) => {
      const rawArg = args[0] ?? '';
      const lower = rawArg.toLowerCase();
      const arg = (lower === 'safe' || lower === 'safe-mode' || lower === 'safemode' || lower === 'readonly')
        ? 'read-only'
        : rawArg;
      const validModes = ['read-only', 'plan', 'build', 'god', 'local-llms'];
      if (validModes.includes(arg)) {
        AppStateStore.setAppMode(arg as any);
      }
    },
  });

  globalCommands.register({
    name: 'clear',
    description: 'Clear message history',
    usage: '/clear',
    handler: () => {},
  });

  globalCommands.register({
    name: 'design',
    description: 'Toggle splash screen vs compact header',
    usage: '/design',
    handler: () => {},
  });

  // §5.4 Ephemeral side-channel question
  globalCommands.register({
    name: 'btw',
    description: 'Ask a side question without consuming main context',
    usage: '/btw <question>',
    handler: (args: string[]) => {
      const question = args.join(' ');
      if (question.length === 0) {
        AppStateStore.pushSystemMessage('/btw <question> — ask a side question', 'info');
        return;
      }
      // Show the btw question as a system message + trigger btw overlay
      AppStateStore.pushSystemMessage(`[btw] ${question}`, 'info');
      // TODO: actual /btw answer via a lightweight side-channel model call
    },
  });

  // §4.4 Busy-input mode control
  globalCommands.register({
    name: 'inputmode',
    description: 'Set busy-input mode: interrupt, queue, or steer',
    usage: '/inputmode <interrupt|queue|steer>',
    handler: (args: string[]) => {
      const mode = args[0] ?? '';
      if (['interrupt', 'queue', 'steer'].includes(mode)) {
        AppStateStore.setBusyInputMode(mode as 'interrupt' | 'queue' | 'steer');
        AppStateStore.pushSystemMessage(`Busy-input mode: ${mode}`, 'info');
      }
    },
  });

  // §5.2 Plan mode — canonical setter updates appMode + tier +
  // permissionMode + godMode together, so Shift+Tab cycle and the
  // agent loop see the correct mode.
  globalCommands.register({
    name: 'plan',
    description: 'Switch to Plan mode (read-only, no edits)',
    usage: '/plan',
    handler: () => {
      AppStateStore.setAppMode('plan');
      AppStateStore.pushSystemMessage('Plan mode: read-only, no edits will be made', 'info');
    },
  });

  // §5.2 Build mode (back to default) — use the canonical setter so
  // tier/godMode/mode are reset in lockstep.
  globalCommands.register({
    name: 'build',
    description: 'Switch to Build mode (default, full permissions per tier)',
    usage: '/build',
    handler: () => {
      AppStateStore.setAppMode('build');
      AppStateStore.pushSystemMessage('Build mode: full permissions per tier', 'info');
    },
  });

  // §6.4 Manual compact trigger
  //
  // P1-3 fix (verification report item #5): the previous implementation
  // only reset the TUI's token counter (`AppStateStore.resetTokens()`)
  // and printed "Context compacted — token counter reset" — but no
  // actual compaction happened in the agent loop. This was misleading:
  // users thought /compact freed context, but the next iteration still
  // saw the full conversation history.
  //
  // We now also call `cliLoop.requestCompaction()` (delegating to
  // `AgentLoop.requestCompaction()`) which sets the `forceCompaction`
  // flag checked at the top of the next ReAct iteration. The next
  // iteration will run `AdvancedCompression.compact()` before
  // processing the next tool call or LLM turn. If no run is in
  // progress, the flag persists and fires on the next `run()`.
  globalCommands.register({
    name: 'compact',
    description: 'Manually compact context to save tokens',
    usage: '/compact',
    altNames: ['compress'],
    handler: async () => {
      // Reset the TUI's token counter (visual feedback in TokenBar).
      AppStateStore.resetTokens();
      AppStateStore.setCompactHint(false);
      // Trigger real compaction in the agent loop on the next iteration.
      // The shared cliLoop is created lazily by useAgentLoop; we import
      // it dynamically to avoid a circular import (CommandRegistry ←
      // useAgentLoop ← CommandRegistry).
      try {
         
        const { getCliLoop } = await import('../hooks/useAgentLoop.js') as {
          getCliLoop?: () => { requestCompaction?: () => void } | null;
        };
        const loop = getCliLoop?.();
        if (loop && typeof loop.requestCompaction === 'function') {
          loop.requestCompaction();
          AppStateStore.pushSystemMessage(
            'Compaction requested — the next iteration will run AdvancedCompression to summarize and shrink the context. Token counter also reset.',
            'info',
          );
        } else {
          AppStateStore.pushSystemMessage(
            'Token counter reset. (Agent loop not yet initialized — compaction will trigger automatically when context exceeds 50% of the limit.)',
            'info',
          );
        }
      } catch {
        // If the dynamic import fails (e.g., useAgentLoop module not
        // loaded yet), fall back to the legacy behavior with an
        // honest message.
        AppStateStore.pushSystemMessage(
          'Token counter reset. (Agent loop compaction hook unavailable — compaction will trigger automatically when context exceeds 50% of the limit.)',
          'info',
        );
      }
    },
  });

  // ─── T-054: New commands (loop run 6, iter 2) ────────────────────────
  // Reference: gemini-cli ships 45+ slash commands. We add 10 high-value
  // commands that close the most-visible UX gaps vs the reference set.

  // /theme — list/switch builtin themes (skins).
  globalCommands.register({
    name: 'theme',
    description: 'List or switch builtin themes (skins)',
    usage: '/theme [name]   (no arg = list all)',
    altNames: ['skin', 'colors'],
    handler: (args: string[]) => {
      if (args.length === 0) {
        // List all builtin themes.
        const names = BUILTIN_SKIN_NAMES.map((n) => `  ${n}`).join('\n');
        AppStateStore.pushSystemMessage(
          `Builtin themes (${BUILTIN_SKIN_NAMES.length}):\n${names}\n\nUse /theme <name> to switch (applied live).`,
          'info',
        );
      } else {
        const name = args[0]!;
        try {
          const skin = loadSkin(name);
          // T-076: Apply the skin live (hot-reload) — no restart needed.
          applySkinToTokens(skin);
          AppStateStore.pushSystemMessage(
            `Theme: ${skin.name} — ${skin.description}\n(Applied live. Set GOLI_SKIN=${name} to persist across launches.)`,
            'info',
          );
        } catch {
          AppStateStore.pushSystemMessage(
            `Unknown theme: ${name}. Use /theme (no arg) to list available themes.`,
            'warning',
          );
        }
      }
    },
  });

  // /about — show version + about info.
  globalCommands.register({
    name: 'about',
    description: 'Show version and about info',
    usage: '/about',
    altNames: ['version', 'v'],
    handler: () => {
      // P3-30 fix: use APP_VERSION from constants.ts (was hardcoded)
      const pkgVersion = APP_VERSION;
      AppStateStore.pushSystemMessage(
        [
          'GOLI-CLI — production-grade multi-agent software engineering tool.',
          `Version: ${pkgVersion}`,
          'License: MIT',
          'Homepage: https://github.com/goli-cli/goli-cli',
          '',
          '8-agent swarm (Orchestrator → Data) for complex, autonomous dev tasks.',
          'Built as an npm workspaces monorepo with TypeScript + Ink.',
        ].join('\n'),
        'info',
      );
    },
  });

  // /stats — show session stats.
  globalCommands.register({
    name: 'stats',
    description: 'Show session statistics (tokens, cost, turns, elapsed)',
    usage: '/stats',
    altNames: ['statistics', 'info'],
    handler: () => {
      const snap = AppStateStore.getSnapshot();
      const elapsedMs = Date.now() - snap.startedAt;
      const elapsedSec = Math.floor(elapsedMs / 1000);
      const elapsedStr = elapsedSec < 60
        ? `${elapsedSec}s`
        : `${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s`;
      AppStateStore.pushSystemMessage(
        [
          'Session statistics:',
          `  Turns:      ${snap.turn}`,
          `  Tokens:     ${snap.tokens} / ${snap.tokenLimit}  (${Math.round((snap.tokens / snap.tokenLimit) * 100)}%)`,
          `    Input:    ${snap.totalInputTokens}`,
          `    Output:   ${snap.totalOutputTokens}`,
          `  Cost:       $${snap.totalCostUsd.toFixed(4)}`,
          `  Elapsed:    ${elapsedStr}`,
          `  Model:      ${snap.model}`,
          `  Tier:       ${snap.tier}`,
          `  Mode:       ${snap.mode}${snap.godMode ? ' (god)' : ''}`,
          `  Workspace:  ${snap.workspace}`,
          `  Branch:     ${snap.branch}`,
          `  Session:    ${snap.sessionId}`,
        ].join('\n'),
        'info',
      );
    },
  });

  // /skills — list active skills (P3-6, audit Finding 4.32).
  //
  // The skills system was re-enabled in Phase 1's bonus fix. This
  // command lists the seed skills and shows how many are active in
  // the current mode (via mode-config's MODE_SKILLS mapping).
  //
  // P2-9 fix (re-verification report item #4): added `archive`
  // subcommand. Previously `SkillArchiver.archiveStale()` was fully
  // implemented but had ZERO production callers, and the `subCommands`
  // field on the `Command` interface was declared but unused by every
  // command in the registry (dead API surface). The `archive`
  // subcommand is the first command to define `subCommands`, making
  // the feature reachable AND giving `archiveStale()` an explicit
  // on-demand caller (the session-start hook in `wakeup.ts` is the
  // automatic caller; this is the manual one).
  globalCommands.register({
    name: 'skills',
    description: 'List available skills (L1/L2/L3 disclosure system)',
    usage: '/skills [archive]',
    altNames: ['skill'],
    isSafeConcurrent: true,
    subCommands: [
      {
        name: 'archive',
        description: 'Archive skills not improved in 90 days (SkillArchiver.archiveStale)',
        usage: '/skills archive',
        isSafeConcurrent: true,
        handler: async () => {
          try {
            const { SkillArchiver, AUTO_ARCHIVE_DAYS } = await import('@goli-cli/memory-engine');
            const skillsDir = join(process.cwd(), '.goli', 'skills');
            if (!existsSync(skillsDir)) {
              AppStateStore.pushSystemMessage(
                `Skills directory not found: ${skillsDir}\nNo skills to archive.`,
                'info',
              );
              return;
            }
            const archiver = new SkillArchiver({ skillsDir });
            const archivedCount = archiver.archiveStale();
            if (archivedCount === 0) {
              AppStateStore.pushSystemMessage(
                `SkillArchiver: no stale skills found (threshold: ${AUTO_ARCHIVE_DAYS} days).\nAll skills in ${skillsDir} are active or already archived.`,
                'info',
              );
            } else {
              AppStateStore.pushSystemMessage(
                `SkillArchiver: archived ${archivedCount} stale skill(s) (threshold: ${AUTO_ARCHIVE_DAYS} days).\nArchived skills are flagged via \`archived: true\` in their SKILL.md frontmatter and excluded from the catalog list. Use \`/skills\` to verify.`,
                'info',
              );
            }
          } catch (err) {
            AppStateStore.pushSystemMessage(
              `/skills archive failed: ${err instanceof Error ? err.message : String(err)}`,
              'error',
            );
          }
        },
      },
    ],
    handler: async () => {
      try {
        const { SEED_SKILLS } = await import('@goli-cli/memory-engine');
        const appMode = AppStateStore.getAppMode();
        const activeForMode = getSkillsForMode(appMode);
        const lines: string[] = [
          'Skills (L1/L2/L3 progressive disclosure system):',
          `  Active in current mode (${appMode}): ${activeForMode.join(', ')}`,
          `  Total seed skills: ${SEED_SKILLS.length}`,
          '',
          'Seed skills:',
        ];
        for (let i = 0; i < SEED_SKILLS.length; i++) {
          const skill = SEED_SKILLS[i]!;
          const skillId = `seed-${i}`;
          const disclosure = activeForMode.includes(skillId) ? 'L2 (active)' : 'L1 (metadata only)';
          lines.push(`  ${skillId.padEnd(20)} ${disclosure}  ${skill.name}`);
          // Show first 80 chars of content as a preview.
          const preview = skill.content.replace(/\n/g, ' ').slice(0, 80);
          if (preview.length > 0) {
            lines.push(`  ${' '.repeat(22)}${preview}`);
          }
        }
        lines.push('');
        lines.push('Skills are auto-archived to L3 after 90 days of inactivity (SkillArchiver).');
        lines.push('Use the SkillWriter tool to create new skills from successful trajectories.');
        lines.push('Run `/skills archive` to manually trigger archival of stale skills.');
        AppStateStore.pushSystemMessage(lines.join('\n'), 'info');
      } catch (err) {
        AppStateStore.pushSystemMessage(
          `/skills failed: ${err instanceof Error ? err.message : String(err)}`,
          'error',
        );
      }
    },
  });


  // /audit — verify audit log integrity (P3-6, audit Finding 1.15).
  //
  // Runs `verifyAuditLog()` (now with hash-chain verification from
  // Phase 1.5) and shows the result in the TUI. Equivalent to
  // `goli audit` but without leaving the session.
  globalCommands.register({
    name: 'audit',
    description: 'Verify audit log integrity (hash-chain check)',
    usage: '/audit',
    isSafeConcurrent: true,
    handler: async () => {
      AppStateStore.pushSystemMessage('Verifying audit log integrity...', 'info');
      try {
        const { verifyAuditLog, getAuditLogPath, getAuditLogSummary } = await import('@goli-cli/sandbox');
        const logPath = getAuditLogPath();
        const result = await verifyAuditLog(logPath);
        const summary = await getAuditLogSummary(logPath, 1000);
        if (result.ok) {
          const lines: string[] = [
            'Audit log verification: PASS',
            `  Log path:       ${logPath}`,
            `  Entries:        ${summary.totalEntries}`,
            `  By tool:        ${Object.entries(summary.byTool).map(([t, c]) => `${t}=${c}`).join(', ') || '(none)'}`,
            `  By tier:        ${Object.entries(summary.byTier).map(([t, c]) => `${t}=${c}`).join(', ') || '(none)'}`,
            `  God-mode calls: ${summary.godModeEntries}`,
            `  Denied calls:   ${summary.deniedEntries}`,
          ];
          if (result.errors.length > 0) {
            lines.push(`  Warnings:       ${result.errors.length}`);
            for (const err of result.errors.slice(0, 5)) {
              lines.push(`    - ${err}`);
            }
          }
          AppStateStore.pushSystemMessage(lines.join('\n'), 'info');
        } else {
          const lines: string[] = [
            'Audit log verification: FAIL',
            `  Log path: ${logPath}`,
            `  Errors:   ${result.errors.length}`,
          ];
          for (const err of result.errors.slice(0, 10)) {
            lines.push(`    - ${err}`);
          }
          AppStateStore.pushSystemMessage(lines.join('\n'), 'error');
        }
      } catch (err) {
        AppStateStore.pushSystemMessage(
          `/audit failed: ${err instanceof Error ? err.message : String(err)}`,
          'error',
        );
      }
    },
  });

  // /sica — SICA (recursive self-improvement) status + cycle trigger.
  //
  // P2-8 fix (audit Finding 4.25 / CC-4): SicaLoop was exported but
  // never instantiated. This command wires it in:
  //   `/sica`               — show SICA status (enabled, cycles today, archive size)
  //   `/sica enable`        — enable SICA for this session (sets enabled: true)
  //   `/sica status`        — same as `/sica`
  //   `/sica run <file>`    — run a SICA cycle with a proposal loaded from <file>
  //
  // P1-5 fix (verification report item #4): the previous implementation
  // constructed a SicaLoop on every /sica invocation and immediately
  // discarded it (`void sicaLoop;`). This made the subsystem
  // "constructable but unreachable" — the loop's rate limiter and
  // archive state were never persisted across invocations. We now keep
  // a process-wide singleton so /sica enable + /sica status reflect
  // the same loop instance.
  //
  // P2-9 fix (re-verification report item #6): `SicaLoop.runCycle()` was
  // previously invoked ONLY from tests (`tests/unit/sica.test.ts`). The
  // singleton was wired but no production code path actually called
  // `runCycle()`. We now add a `/sica run <file>` subcommand that:
  //   1. Requires `/sica enable` first (runCycle rejects if disabled).
  //   2. Reads a JSON proposal file (relative to cwd) containing:
  //        { target, targetName, oldContent, newContent, rationale }
  //      where `target` is one of: system_prompt | tool_description |
  //      context_prompt | hook_config | todo_logic | skill_definition.
  //   3. Constructs a full SicaProposal via `sicaLoop.createProposal()`
  //      (auto-generates proposalId, diff, linesChanged, timestamp).
  //   4. Calls `await sicaLoop.runCycle(proposal)` — exercising the
  //      full 6-phase pipeline (rate limit → human-review check →
  //      archive → evaluate → guard → adopt/revert).
  //   5. Displays the cycle result (adopted/rejected + reason).
  //
  // NOTE: without a real benchmark harness (an `evaluate` callback),
  // the loop's safe-default evaluator returns zero improvement, so
  // proposals are rejected with "no resolution improvement". This is
  // the correct safe behavior — SICA must NEVER adopt a change it
  // can't verify is an improvement. The subcommand exists so the API
  // is reachable from production and the safety pipeline executes
  // end-to-end; real adoption requires wiring a benchmark evaluator
  // (future work, tracked in the H-onwards roadmap).
  let sicaLoopSingleton: import('@goli-cli/memory-engine').SicaLoop | null = null;
  let sicaEnabled = false;
  globalCommands.register({
    name: 'sica',
    description: 'SICA (recursive self-improvement) status, enable, and run',
    usage: '/sica [enable|status|run <proposalFile>]',
    altNames: ['self-improve'],
    isSafeConcurrent: true,
    handler: async (args: string[]) => {
      const subcommand = args[0] ?? 'status';
      try {
        // Lazy-load so `goli --help` doesn't pull in the SICA module graph.
        const { SicaLoop, SicaRateLimiter, SicaArchive } = await import('@goli-cli/memory-engine');
        if (subcommand === 'enable') {
          sicaEnabled = true;
        }
        // Round-2 verification item #2 (SICA singleton reconstruction):
        // previously, when `sicaEnabled === true` and the singleton
        // already existed, the code RE-CONSTRUCTED the singleton via
        // `new SicaLoop({...})` on every invocation. This defeated
        // state persistence across invocations — the rate-limiter
        // counter reset, the archive lost its history, and the
        // immutable-safety registry was re-loaded from disk.
        //
        // We now use the new `setEnabled(bool)` method on SicaLoop
        // to toggle the flag on the existing instance. The singleton
        // is constructed exactly once (lazily on first `/sica`
        // invocation); subsequent invocations reuse it.
        if (!sicaLoopSingleton) {
          sicaLoopSingleton = new SicaLoop({
            enabled: sicaEnabled,
            workspaceRoot: process.cwd(),
          });
        } else {
          sicaLoopSingleton.setEnabled(sicaEnabled);
        }

        // P2-9 fix: `/sica run <proposalFile>` — invoke runCycle().
        if (subcommand === 'run') {
          const proposalFile = args[1];
          if (!proposalFile) {
            AppStateStore.pushSystemMessage(
              [
                '/sica run requires a proposal file path.',
                'Usage: /sica run <path-to-proposal.json>',
                '',
                'The JSON file must contain:',
                '  {',
                '    "target":       "system_prompt" | "tool_description" | "context_prompt" | "hook_config" | "todo_logic" | "skill_definition",',
                '    "targetName":   "<name of the fragment/tool/hook/skill being changed>",',
                '    "oldContent":   "<current content>",',
                '    "newContent":   "<proposed new content>",',
                '    "rationale":    "<why this change improves the agent>"',
                '  }',
                '',
                'The cycle will be REJECTED unless a benchmark evaluator is wired',
                '(the safe-default evaluator returns zero improvement). This is',
                'intentional — SICA never adopts a change it cannot verify.',
              ].join('\n'),
              'info',
            );
            return;
          }
          if (!sicaEnabled) {
            AppStateStore.pushSystemMessage(
              '/sica run rejected: SICA is disabled. Run `/sica enable` first.',
              'error',
            );
            return;
          }
          const proposalPath = resolve(process.cwd(), proposalFile);
          if (!existsSync(proposalPath)) {
            AppStateStore.pushSystemMessage(
              `/sica run failed: proposal file not found: ${proposalPath}`,
              'error',
            );
            return;
          }
          // Parse + validate the proposal JSON. We narrow each field
          // defensively — a malformed proposal must produce a clear
          // error, not a crash.
          let raw: unknown;
          try {
            raw = JSON.parse(readFileSync(proposalPath, 'utf-8'));
          } catch (parseErr) {
            AppStateStore.pushSystemMessage(
              `/sica run failed: could not parse JSON: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
              'error',
            );
            return;
          }
          const VALID_TARGETS = new Set([
            'system_prompt', 'tool_description', 'context_prompt',
            'hook_config', 'todo_logic', 'skill_definition',
          ]);
          const r = (raw ?? {}) as Record<string, unknown>;
          const target = typeof r['target'] === 'string' ? r['target'] : '';
          const targetName = typeof r['targetName'] === 'string' ? r['targetName'] : '';
          const oldContent = typeof r['oldContent'] === 'string' ? r['oldContent'] : '';
          const newContent = typeof r['newContent'] === 'string' ? r['newContent'] : '';
          const rationale = typeof r['rationale'] === 'string' ? r['rationale'] : '';
          if (!VALID_TARGETS.has(target) || !targetName || !rationale) {
            AppStateStore.pushSystemMessage(
              [
                '/sica run failed: proposal JSON is missing required fields or has invalid target.',
                `  target (must be one of ${[...VALID_TARGETS].join(' | ')}): ${target || '(missing)'}`,
                `  targetName: ${targetName || '(missing)'}`,
                `  rationale:  ${rationale || '(missing)'}`,
                '  oldContent: ' + (oldContent ? `(present, ${oldContent.length} chars)` : '(missing)'),
                '  newContent: ' + (newContent ? `(present, ${newContent.length} chars)` : '(missing)'),
              ].join('\n'),
              'error',
            );
            return;
          }

          AppStateStore.pushSystemMessage(
            `SICA: running cycle for proposal (${target}/${targetName}, ${oldContent.length}→${newContent.length} chars)...`,
            'info',
          );
          // Construct the full proposal (auto-generates proposalId,
          // diff, linesChanged, timestamp) and invoke runCycle.
          const proposal = sicaLoopSingleton.createProposal({
            target: target as import('@goli-cli/memory-engine').SicaTarget,
            targetName,
            oldContent,
            newContent,
            rationale,
          });
          const result = await sicaLoopSingleton.runCycle(proposal);
          const outcome = result.adopted ? 'adopted' : 'rejected';
          const lines: string[] = [
            `SICA cycle complete: ${outcome.toUpperCase()}`,
            `  Proposal ID:    ${proposal.proposalId}`,
            `  Target:         ${proposal.target}/${proposal.targetName}`,
            `  Lines changed:  ${proposal.linesChanged}`,
            `  Reason:         ${result.reason}`,
          ];
          if (result.beforeEvaluation && result.afterEvaluation) {
            lines.push(
              `  Before:         ${(result.beforeEvaluation.resolutionRate * 100).toFixed(1)}% resolution (${result.beforeEvaluation.resolvedCount}/${result.beforeEvaluation.instanceCount})`,
              `  After:          ${(result.afterEvaluation.resolutionRate * 100).toFixed(1)}% resolution (${result.afterEvaluation.resolvedCount}/${result.afterEvaluation.instanceCount})`,
              `  Delta:          ${(result.resolutionDelta * 100).toFixed(1)}%`,
            );
          }
          if (result.overseerVerdict && !result.overseerVerdict.approved) {
            lines.push(
              `  Overseer:       VETOED`,
              `  Concerns:       ${result.overseerVerdict.concerns.map((c) => c.description).join('; ') || '(none)'}`,
            );
          }
          if (result.holdoutDegraded) {
            lines.push('  Holdout:        DEGRADED (overfitting detected)');
          }
          lines.push(
            '',
            result.adopted
              ? 'The proposal was adopted — the new content is now live. The previous version is archived for rollback.'
              : 'The proposal was rejected. No changes were applied. See the reason above.',
          );
          AppStateStore.pushSystemMessage(lines.join('\n'), result.adopted ? 'info' : 'error');
          return;
        }

        // Default: status.
        const rateLimiter = new SicaRateLimiter({});
        const archive = new SicaArchive({});
        // Query real APIs: canRunCycle() checks the daily quota; getAll()
        // returns the archive entries.
        const canRun = rateLimiter.canRunCycle();
        const archiveEntries = archive.getAll();
        const lines: string[] = [
          'SICA (Self-Improving Code Agent) status:',
          `  Enabled:          ${sicaEnabled ? 'yes (this session)' : 'no (use /sica enable)'}`,
          `  Can run cycle:    ${canRun ? 'yes (within daily quota)' : 'no (quota exhausted — wait until tomorrow)'}`,
          `  Archive entries:  ${archiveEntries.length}`,
          '',
          'SICA runs a 6-phase loop: Evaluate → Archive → Self-Edit → Guard → Re-evaluate → Adopt/Revert.',
          'Each cycle proposes a code change, evaluates it against holdout tests, and adopts only',
          'if resolution improves without holdout degradation. The SafetyOverseer vetoes unsafe',
          'changes; the ImmutableSafetyRegistry protects sandbox/approval/hooks/SICA source files.',
          '',
          'Commands:',
          '  /sica enable          — enable SICA for this session',
          '  /sica status          — show this status (default)',
          '  /sica run <file.json> — run a cycle with a proposal from a JSON file',
          '',
          'NOTE: without a benchmark evaluator wired, /sica run will reject proposals with',
          '"no resolution improvement". This is intentional — SICA never adopts unverifiable changes.',
        ];
        AppStateStore.pushSystemMessage(lines.join('\n'), 'info');
      } catch (err) {
        AppStateStore.pushSystemMessage(
          `/sica failed: ${err instanceof Error ? err.message : String(err)}`,
          'error',
        );
      }
    },
  });

  // /vim — toggle vim mode (info-only; actual toggle happens in keymap.ts).
  globalCommands.register({
    name: 'vim',
    description: 'Toggle vim keybinding mode for the input editor',
    usage: '/vim',
    handler: () => {
      AppStateStore.pushSystemMessage(
        'Vim mode: use the `\\vim` keybinding toggle (default: no key, set in ~/.goli-cli/keybindings.json) or pass --vim on launch.',
        'info',
      );
    },
  });

  // /quit — exit the app.
  globalCommands.register({
    name: 'quit',
    description: 'Exit Goli-CLI',
    usage: '/quit',
    altNames: ['exit', 'q'],
    handler: () => {
      AppStateStore.pushSystemMessage('Goodbye! (exit)', 'info');
      // Defer exit so the message has time to render.
      if (!process.env['VITEST']) {
        setTimeout(() => process.exit(0), 50);
      }
    },
  });

  // /copy — copy last agent message to clipboard (info-only fallback).
  globalCommands.register({
    name: 'copy',
    description: 'Copy last agent message to clipboard',
    usage: '/copy',
    altNames: ['yank', 'yb'],
    handler: () => {
      AppStateStore.pushSystemMessage(
        '/copy: clipboard integration requires a TTY. Use terminal clipboard (e.g. pbcopy/xclip) or select-to-copy in your terminal.',
        'info',
      );
    },
  });

  // /shortcuts — show keyboard shortcuts reference (dynamic from keymap).
  globalCommands.register({
    name: 'shortcuts',
    description: 'Show keyboard shortcuts reference',
    usage: '/shortcuts',
    altNames: ['keys', 'hotkeys'],
    isSafeConcurrent: true,
    handler: () => {
      // T-106: Generate the shortcuts list dynamically from the keymap.
      const entries = globalKeyMap.entries();

      // Group by category.
      const categories: Record<string, Array<{ action: string; description: string; keys: string[] }>> = {};
      for (const [action, binding] of entries) {
        const cat = binding.category;
        if (!categories[cat]) categories[cat] = [];
        categories[cat].push({ action, description: binding.description, keys: binding.defaultKeys });
      }

      const lines: string[] = [
        'Keyboard shortcuts (default — customize in ~/.goli-cli/keybindings.json):',
        '',
      ];

      const categoryOrder = ['global', 'navigation', 'input', 'session', 'permission'];
      const categoryLabels: Record<string, string> = {
        global: 'Global',
        navigation: 'Navigation & Editing',
        input: 'Input',
        session: 'Session',
        permission: 'Permission',
      };

      for (const cat of categoryOrder) {
        const items = categories[cat];
        if (!items || items.length === 0) continue;
        lines.push(`  ${categoryLabels[cat] ?? cat}:`);
        for (const item of items) {
          const keysStr = item.keys.map((k: string) => k).join(' / ');
          const padAction = item.action.padEnd(18, ' ');
          lines.push(`    ${padAction} ${keysStr}  — ${item.description}`);
        }
        lines.push('');
      }

      // Add non-keymap shortcuts (not in the registry but available).
      lines.push('  Other:');
      lines.push('    ?                — toggle help panel');
      lines.push('    Tab              — autocomplete / queue when busy');
      lines.push('    Up/Down          — history navigation');
      lines.push('    Double-Esc       — clear prompt input');
      lines.push('    Ctrl+C twice     — exit (once interrupts agent)');
      lines.push('    Shift+Tab        — cycle build → read-only → plan → god modes');

      AppStateStore.pushSystemMessage(lines.join('\n'), 'info');
    },
  });

  // /memory — show memory file info (AGENTS.md / project context).
  globalCommands.register({
    name: 'memory',
    description: 'Show memory file info (AGENTS.md, .goli/ context)',
    usage: '/memory',
    altNames: ['mem'],
    handler: () => {
      const cwd = process.cwd();
      const candidates = [
        'AGENTS.md',
        '.goli/AGENTS.md',
        'GOLI.md',
        '.goli/GOLI.md',
        'CLAUDE.md',
        '.cursor/rules',
      ];
      const found: string[] = [];
      for (const c of candidates) {
        const p = join(cwd, c);
        if (existsSync(p)) {
          const stat = statSync(p);
          found.push(`  ${c}  (${stat.size} bytes)`);
        }
      }
      if (found.length === 0) {
        AppStateStore.pushSystemMessage(
          'No memory files found. Create AGENTS.md or .goli/AGENTS.md to give the agent persistent context.',
          'info',
        );
      } else {
        AppStateStore.pushSystemMessage(
          `Memory files in ${cwd}:\n${found.join('\n')}`,
          'info',
        );
      }
    },
  });

  // /model — show current model info.
  globalCommands.register({
    name: 'model',
    description: 'Show current model info',
    usage: '/model',
    handler: () => {
      const snap = AppStateStore.getSnapshot();
      AppStateStore.pushSystemMessage(
        `Current model: ${snap.model}\n(Use --model <name> at launch to switch, or set GOLI_MODEL env var.)`,
        'info',
      );
    },
  });

  // /mcp — show MCP server info.
  globalCommands.register({
    name: 'mcp',
    description: 'Show MCP (Model Context Protocol) server info',
    usage: '/mcp',
    altNames: ['servers'],
    handler: () => {
      AppStateStore.pushSystemMessage(
        'MCP servers: configured via ~/.goli-cli/mcp.json or .goli/mcp.json. Server-prompted slash commands appear with [MCP] suffix in autocomplete.',
        'info',
      );
    },
  });

  // /echo — debug command (hidden from /help).
  globalCommands.register({
    name: 'echo',
    description: 'Echo args back (debug)',
    usage: '/echo <text>',
    hidden: true,
    handler: (args: string[]) => {
      AppStateStore.pushSystemMessage(`echo: ${args.join(' ')}`, 'info');
    },
  });

  // T-091: /expand — toggle expansion of the most recent tool call.
  globalCommands.register({
    name: 'expand',
    description: 'Toggle expansion of the most recent tool call output',
    usage: '/expand',
    altNames: ['exp'],
    isSafeConcurrent: true,
    handler: () => {
      if (expandToggleCallback) {
        const result = expandToggleCallback();
        if (result) {
          AppStateStore.pushSystemMessage(`Toggled expansion of tool: ${result}`, 'info');
        } else {
          AppStateStore.pushSystemMessage('No tool calls to expand.', 'info');
        }
      } else {
        AppStateStore.pushSystemMessage('Expand not available (no message history).', 'warning');
      }
    },
  });

  // T-094: /allowlist — view or clear the session permission allowlist.
  globalCommands.register({
    name: 'allowlist',
    description: 'View or clear session permission allowlist (tools approved with "always")',
    usage: '/allowlist [clear]',
    altNames: ['al', 'allow'],
    isSafeConcurrent: true,
    handler: (args: string[]) => {
      if (args.length > 0 && args[0] === 'clear') {
        const count = AppStateStore.getAllowlist().length;
        AppStateStore.clearAllowlist();
        AppStateStore.pushSystemMessage(
          `Cleared ${count} entr${count === 1 ? 'y' : 'ies'} from the session allowlist.`,
          'info',
        );
        return;
      }
      // List entries.
      const entries = AppStateStore.getAllowlist();
      if (entries.length === 0) {
        AppStateStore.pushSystemMessage(
          'Session allowlist is empty. Approve a tool with "always" (a) to add entries.',
          'info',
        );
        return;
      }
      const lines = entries.map((e, i) => {
        const age = Math.round((Date.now() - e.addedAt) / 1000);
        const ageStr = age < 60 ? `${age}s ago` : `${Math.round(age / 60)}m ago`;
        return `  ${i + 1}. ${e.tool} — "${e.argPrefix}" (${ageStr})`;
      });
      AppStateStore.pushSystemMessage(
        `Session allowlist (${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}):\n${lines.join('\n')}\n\nUse /allowlist clear to remove all entries.`,
        'info',
      );
    },
  });

  // T-095: /queue — view or clear the queued messages.
  globalCommands.register({
    name: 'queue',
    description: 'View or clear queued follow-up messages (Tab to queue)',
    usage: '/queue [clear]',
    altNames: ['queued'],
    isSafeConcurrent: true,
    handler: (args: string[]) => {
      if (args.length > 0 && args[0] === 'clear') {
        const count = AppStateStore.getSnapshot().queuedMessages.length;
        AppStateStore.clearQueue();
        AppStateStore.pushSystemMessage(
          `Cleared ${count} queued message${count === 1 ? '' : 's'}.`,
          'info',
        );
        return;
      }
      // List queued messages.
      const queued = AppStateStore.getSnapshot().queuedMessages;
      if (queued.length === 0) {
        AppStateStore.pushSystemMessage(
          'Queue is empty. Press Tab while the agent is busy to queue a follow-up message.',
          'info',
        );
        return;
      }
      const lines = queued.map((msg, i) => {
        const age = Math.round((Date.now() - msg.timestamp) / 1000);
        const ageStr = age < 60 ? `${age}s ago` : `${Math.round(age / 60)}m ago`;
        const text = msg.text.length > 60 ? msg.text.slice(0, 59) + '…' : msg.text;
        return `  ${i + 1}. "${text}" (${ageStr})`;
      });
      AppStateStore.pushSystemMessage(
        `Queued messages (${queued.length}):\n${lines.join('\n')}\n\nUse /queue clear to remove all.`,
        'info',
      );
    },
  });

  // T-096: /cost — show token/cost breakdown.
  globalCommands.register({
    name: 'cost',
    description: 'Show token and cost breakdown for this session',
    usage: '/cost',
    altNames: ['usage', 'tokens'],
    isSafeConcurrent: true,
    handler: () => {
      const snap = AppStateStore.getSnapshot();
      const totalTokens = snap.totalInputTokens + snap.totalOutputTokens;
      const avgCost = snap.turn > 0 ? snap.totalCostUsd / snap.turn : 0;
      const rate = totalTokens > 0 ? (snap.totalCostUsd / totalTokens) * 1000 : 0;

      const fmtTokens = (n: number): string => {
        if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
        if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
        return n.toString();
      };
      const fmtCost = (usd: number): string => {
        if (usd < 0.01) return `$${usd.toFixed(4)}`;
        if (usd < 1) return `$${usd.toFixed(3)}`;
        return `$${usd.toFixed(2)}`;
      };

      AppStateStore.pushSystemMessage(
        [
          'Cost Breakdown:',
          `  Tokens:    ${fmtTokens(totalTokens)} (in: ${fmtTokens(snap.totalInputTokens)} · out: ${fmtTokens(snap.totalOutputTokens)})`,
          `  Cost:      ${fmtCost(snap.totalCostUsd)}`,
          `  Turns:     ${snap.turn} · avg ${fmtCost(avgCost)}/turn`,
          `  Rate:      ${fmtCost(rate)}/1K tokens`,
          `  Model:     ${snap.model}`,
        ].join('\n'),
        'info',
      );
    },
  });

  // T-098: /bg — list background shells.
  globalCommands.register({
    name: 'bg',
    description: 'List background shell processes',
    usage: '/bg',
    altNames: ['background', 'shells'],
    isSafeConcurrent: true,
    handler: () => {
      const shells = getBackgroundShells();
      if (shells.length === 0) {
        AppStateStore.pushSystemMessage(
          'No background shells running. The agent can start one with run_in_background: true.',
          'info',
        );
        return;
      }
      const lines = shells.map((s: BackgroundShellEntry, i: number) => {
        const age = Math.round((Date.now() - s.startedAt) / 1000);
        const ageStr = age < 60 ? `${age}s` : `${Math.round(age / 60)}m`;
        const status = s.running ? '● running' : `✗ exited (code ${s.exitCode ?? '?'})`;
        const cmd = s.command.length > 50 ? s.command.slice(0, 49) + '…' : s.command;
        return `  ${i + 1}. [${s.id}] ${status} · ${ageStr}\n     $ ${cmd}`;
      });
      const running = shells.filter((s: BackgroundShellEntry) => s.running).length;
      AppStateStore.pushSystemMessage(
        `Background Shells (${shells.length}, ${running} running):\n${lines.join('\n')}`,
        'info',
      );
    },
  });

  // T-107: /doctor — health check for the Goli-CLI environment.
  globalCommands.register({
    name: 'doctor',
    description: 'Run a health check on your Goli-CLI environment',
    usage: '/doctor',
    isSafeConcurrent: true,
    handler: () => {
      
      
      
      const checks: string[] = ['Health Check:', ''];

      // ─── Node.js version ──────────────────────────────────────────
      const nodeVersion = process.version;
      const major = parseInt(nodeVersion.slice(1), 10);
      const nodeOk = major >= 20;
      checks.push(`  Node.js:     ${nodeVersion} ${nodeOk ? '✓' : '✗ (requires >= 20)'}`);

      // ─── Platform ─────────────────────────────────────────────────
      checks.push(`  Platform:    ${process.platform}`);

      // ─── API keys (without revealing values) ──────────────────────
      const apiKeys = ['GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OLLAMA_API_KEY'];
      const setKeys = apiKeys.filter((k) => process.env[k] && process.env[k]!.length > 0);
      checks.push(`  API keys:    ${setKeys.length > 0 ? `${setKeys.length} set (${setKeys.join(', ')})` : 'none set'} ${setKeys.length > 0 ? '✓' : '⚠'}`);

      // ─── Default model ────────────────────────────────────────────
      const defaultModel = process.env['GOLI_DEFAULT_MODEL'] ?? 'not set';
      checks.push(`  Model:       ${defaultModel}`);

      // ─── Sandbox mode ─────────────────────────────────────────────
      const sandbox = process.env['GOLI_SANDBOX'] ?? 'local';
      checks.push(`  Sandbox:     ${sandbox}`);

      // ─── Terminal capabilities ────────────────────────────────────
      const term = process.env['TERM'] ?? 'unknown';
      const termProgram = process.env['TERM_PROGRAM'] ?? 'unknown';
      const truecolor = process.env['COLORTERM'] === 'truecolor';
      checks.push(`  Terminal:    ${termProgram} (${term})`);
      checks.push(`  Truecolor:   ${truecolor ? '✓' : '✗'}`);

      // ─── Config files ─────────────────────────────────────────────
      const cwd = process.cwd();
      const configFiles = ['.goli/config.toml', '.goli/config.json', 'config/default.toml'];
      const foundConfigs = configFiles.filter((c: string) => existsSync(join(cwd, c)));
      checks.push(`  Config:      ${foundConfigs.length > 0 ? `${foundConfigs.length} found` : 'none found'}`);

      // ─── Memory files ─────────────────────────────────────────────
      const memoryFiles = ['AGENTS.md', 'GOLI.md', 'CLAUDE.md'];
      const foundMemory = memoryFiles.filter((c: string) => existsSync(join(cwd, c)));
      checks.push(`  Memory:      ${foundMemory.length > 0 ? `${foundMemory.length} files (${foundMemory.join(', ')})` : 'none found — create AGENTS.md for persistent context'}`);

      // ─── MCP config ───────────────────────────────────────────────
      const mcpCandidates = ['.goli/mcp.json', '.goli-cli/mcp.json'];
      const foundMcp = mcpCandidates.filter((c: string) => existsSync(join(cwd, c)));
      checks.push(`  MCP:         ${foundMcp.length > 0 ? `${foundMcp.length} config(s) found` : 'none configured'}`);

      // ─── Disk space (cwd) ─────────────────────────────────────────
      try {
        const stats = statSync(cwd);
        checks.push(`  Workspace:   ${cwd} ${stats.isDirectory() ? '✓' : '✗ (not a directory)'}`);
      } catch {
        checks.push(`  Workspace:   ${cwd} ✗ (not accessible)`);
      }

      // ─── Summary ──────────────────────────────────────────────────
      const warnings = checks.filter((c) => c.includes('⚠') || c.includes('✗'));
      checks.push('');
      if (warnings.length === 0) {
        checks.push('  Result: ✓ All checks passed');
      } else {
        checks.push(`  Result: ⚠ ${warnings.length} warning(s) — see above`);
      }

      AppStateStore.pushSystemMessage(checks.join('\n'), 'info');
    },
  });

  // T-101: /tips — show a random tip or list all tips.
  globalCommands.register({
    name: 'tips',
    description: 'Show a tip or list all tips',
    usage: '/tips [list|shortcut|command|feature|productivity]',
    altNames: ['tip'],
    isSafeConcurrent: true,
    handler: (args: string[]) => {
      if (args.length === 0) {
        // Show a random tip.
        const tip = getRandomTip();
        AppStateStore.pushSystemMessage(
          `💡 Tip [${tip.category}]: ${tip.text}\n\nUse /tips list to see all ${getTipCount()} tips.`,
          'info',
        );
        return;
      }
      const subcmd = args[0]!;
      if (subcmd === 'list') {
        // List all tips grouped by category.
        const categories: Tip['category'][] = ['shortcut', 'command', 'feature', 'productivity'];
        const sections: string[] = [`All Tips (${getTipCount()}):`];
        for (const cat of categories) {
          const tips = getTipsByCategory(cat);
          if (tips.length > 0) {
            sections.push(`\n  ${cat} (${tips.length}):`);
            for (const tip of tips) {
              sections.push(`    • ${tip.text}`);
            }
          }
        }
        AppStateStore.pushSystemMessage(sections.join('\n'), 'info');
        return;
      }
      // Filter by category.
      const validCategories: Tip['category'][] = ['shortcut', 'command', 'feature', 'productivity'];
      if (validCategories.includes(subcmd as Tip['category'])) {
        const tips = getTipsByCategory(subcmd as Tip['category']);
        const lines = tips.map((t: Tip, i: number) => `  ${i + 1}. ${t.text}`);
        AppStateStore.pushSystemMessage(
          `Tips [${subcmd}] (${tips.length}):\n${lines.join('\n')}`,
          'info',
        );
        return;
      }
      AppStateStore.pushSystemMessage(
        `Unknown subcommand: ${subcmd}. Use /tips, /tips list, or /tips <category>.`,
        'warning',
      );
    },
  });

  // T-097: /context — context-source inspector.
  // Shows all context sources the agent has access to: memory files,
  // MCP servers, skills, and workspace config.
  globalCommands.register({
    name: 'context',
    description: 'Show all context sources (memory files, MCP, skills, config)',
    usage: '/context',
    altNames: ['ctx'],
    isSafeConcurrent: true,
    handler: () => {
      const sections: string[] = ['Context Sources:'];

      // ─── Memory files ─────────────────────────────────────────────
      
      
      const cwd = process.cwd();
      const memoryCandidates = [
        'AGENTS.md', '.goli/AGENTS.md',
        'GOLI.md', '.goli/GOLI.md',
        'CLAUDE.md', '.cursor/rules',
      ];
      const memoryFound: string[] = [];
      for (const c of memoryCandidates) {
        const p = join(cwd, c);
        if (existsSync(p)) {
          try {
            const stat = statSync(p);
            memoryFound.push(`  ${c} (${stat.size} bytes)`);
          } catch {
            memoryFound.push(`  ${c} (size unknown)`);
          }
        }
      }
      if (memoryFound.length > 0) {
        sections.push(`\nMemory Files (${memoryFound.length}):`);
        sections.push(...memoryFound);
      } else {
        sections.push('\nMemory Files: none found');
      }

      // ─── MCP config ───────────────────────────────────────────────
      const mcpCandidates = [
        '.goli/mcp.json',
        '.goli-cli/mcp.json',
        join(homedir(), '.goli', 'mcp.json'),
        join(homedir(), '.goli-cli', 'mcp.json'),
      ];
      const mcpFound: string[] = [];
      for (const c of mcpCandidates) {
        const p = c.startsWith('/') ? c : join(cwd, c);
        if (existsSync(p)) {
          try {
            const content = JSON.parse(readFileSync(p, 'utf-8'));
            const serverCount = Object.keys(content.mcpServers ?? content.servers ?? {}).length;
            mcpFound.push(`  ${c} (${serverCount} servers)`);
          } catch {
            mcpFound.push(`  ${c} (parse error)`);
          }
        }
      }
      if (mcpFound.length > 0) {
        sections.push(`\nMCP Config (${mcpFound.length}):`);
        sections.push(...mcpFound);
      } else {
        sections.push('\nMCP Config: none found');
      }

      // ─── Skills ───────────────────────────────────────────────────
      const skillsDir = join(cwd, '.goli', 'skills');
      let skillsCount = 0;
      if (existsSync(skillsDir)) {
        try {
          const entries = readdirSync(skillsDir, { withFileTypes: true });
          skillsCount = entries.filter((e: any) => e.isFile() && e.name.endsWith('.md')).length;
        } catch {
          // Ignore read errors.
        }
      }
      sections.push(`\nSkills: ${skillsCount > 0 ? `${skillsCount} in .goli/skills/` : 'none found'}`);

      // ─── Workspace config ─────────────────────────────────────────
      const configCandidates = ['.goli/config.toml', '.goli/config.json', 'config/default.toml'];
      const configFound: string[] = [];
      for (const c of configCandidates) {
        const p = join(cwd, c);
        if (existsSync(p)) {
          configFound.push(`  ${c}`);
        }
      }
      if (configFound.length > 0) {
        sections.push(`\nWorkspace Config (${configFound.length}):`);
        sections.push(...configFound);
      } else {
        sections.push('\nWorkspace Config: none found');
      }

      // ─── Summary ──────────────────────────────────────────────────
      const totalCount = memoryFound.length + mcpFound.length + skillsCount + configFound.length;
      sections.push(`\nTotal: ${totalCount} context source${totalCount === 1 ? '' : 's'}`);

      AppStateStore.pushSystemMessage(sections.join('\n'), 'info');
    },
  });
}

// T-091: Module-level callback for /expand command.
// App.tsx registers this on mount so /expand can access the message history.
let expandToggleCallback: (() => string | null) | null = null;

/**
 * T-091: Register a callback for the /expand command.
 * App.tsx calls this on mount with a function that toggles the most
 * recent tool call's expansion and returns its ID (or null if none).
 */
export function setExpandToggleCallback(cb: (() => string | null) | null): void {
  expandToggleCallback = cb;
}

// T-090: Register built-in commands at MODULE SCOPE so they're available
// before any React component mounts. Previously this was called inside
// App.tsx's useEffect, which runs AFTER child components (like PromptInput)
// have already memoized globalCommands.entries() with an empty deps array —
// capturing a permanently empty array. Moving to module scope ensures the
// registry is populated before the first render.
registerDefaultCommands();
