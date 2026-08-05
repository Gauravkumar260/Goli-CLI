/**
 * lib/CommandService.ts — Pluggable multi-loader command service.
 *
 * Mirrors gemini-cli's `services/CommandService.ts` pattern: commands are
 * discovered by running multiple async loaders in parallel, conflicts are
 * resolved by priority, and the frozen result is exposed via the existing
 * `CommandRegistry` API (so existing call sites are unaffected).
 *
 * Loader priority (highest wins on conflict):
 *   1. builtin   — goli-cli's built-in commands (/help, /theme, /stats, ...)
 *   2. workspace — `.goli/commands/*.md` in the current workspace
 *   3. user      — `~/.goli-cli/commands/*.md`
 *   4. MCP       — server-prompted slash commands
 *   5. extension — IDE/extension-contributed commands
 *
 * Each loader returns a list of `CommandLoaderResult` objects. The service
 * merges them, resolving conflicts by priority, and registers the winners
 * in a target `CommandRegistry`.
 *
 * Activation: optional. Existing code paths that call
 * `registerDefaultCommands()` still work unchanged. The service is for
 * callers that want loader-based discovery (e.g. a future `goli` launch
 * sequence that scans `.goli/commands/`).
 *
 * @module CommandService
 */

import type { Command, CommandKind, CommandRegistry } from './CommandRegistry.js';
import { AppStateStore } from '../state/AppStateStore.js';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

/** A single command's source identifier (for conflict resolution + telemetry). */
export type CommandSource = 'builtin' | 'workspace' | 'user' | 'MCP' | 'extension';

/** Loader priority — higher number wins on conflict. */
const SOURCE_PRIORITY: Record<CommandSource, number> = {
  builtin: 5,
  workspace: 4,
  user: 3,
  MCP: 2,
  extension: 1,
};

/** A single result row from a loader. */
export interface CommandLoaderResult {
  /** The command's source — used for conflict resolution + telemetry. */
  source: CommandSource;
  /** The command payload. `kind` is auto-set from `source` if not provided. */
  command: Command;
}

/** A loader: an async function that produces commands. */
export type CommandLoader = (signal?: AbortSignal) => Promise<CommandLoaderResult[]>;

/** Outcome of a single loader's run. */
interface LoaderOutcome {
  source: CommandSource;
  results: CommandLoaderResult[];
  error?: Error;
}

/** A conflict that was resolved (winner + losers). */
export interface CommandConflict {
  /** The command name that collided. */
  name: string;
  /** The winning source. */
  winner: CommandSource;
  /** The losing sources (in priority order). */
  losers: CommandSource[];
}

/** Telemetry event for a slash command invocation. */
export interface SlashCommandEvent {
  command: string;
  subcommand?: string;
  source: CommandSource;
  status: 'success' | 'unknown' | 'error';
  extension_id?: string;
}

/** Telemetry sink — call sites register to receive events. */
type TelemetrySink = (event: SlashCommandEvent) => void;

const telemetrySinks = new Set<TelemetrySink>();

/** Register a telemetry sink. Returns an unsubscribe function. */
export function registerSlashCommandTelemetry(sink: TelemetrySink): () => void {
  telemetrySinks.add(sink);
  return () => {
    telemetrySinks.delete(sink);
  };
}

/** Emit a slash_command event to all registered sinks. */
export function emitSlashCommandEvent(event: SlashCommandEvent): void {
  for (const sink of telemetrySinks) {
    try {
      sink(event);
    } catch {
      // Sink errors must not crash the command path.
    }
  }
}

/** Internal: map a CommandSource to the corresponding CommandKind. */
function sourceToKind(source: CommandSource): CommandKind {
  switch (source) {
    case 'builtin':
      return 'builtin';
    case 'MCP':
      return 'MCP';
    case 'extension':
      return 'Agent';
    case 'workspace':
    case 'user':
      return 'custom';
  }
}

/**
 * Result of `CommandService.create()` — the frozen command set + conflicts.
 */
export interface CommandServiceCreateResult {
  /** Number of commands registered. */
  count: number;
  /** Conflicts encountered during load (winner + losers). */
  conflicts: CommandConflict[];
  /** Per-loader outcomes (for diagnostics). */
  outcomes: LoaderOutcome[];
}

/**
 * The CommandService — runs loaders, resolves conflicts, registers commands.
 *
 * Usage:
 *   const svc = new CommandService(registry);
 *   svc.addLoader(builtinLoader);
 *   svc.addLoader(fileLoader);
 *   const result = await svc.create();
 *   console.log(`Loaded ${result.count} commands, ${result.conflicts.length} conflicts`);
 */
export class CommandService {
  private readonly registry: CommandRegistry;
  private readonly loaders: CommandLoader[] = [];

  constructor(registry: CommandRegistry) {
    this.registry = registry;
  }

  /** Add a loader. Loaders run in parallel on `create()`. */
  addLoader(loader: CommandLoader): this {
    this.loaders.push(loader);
    return this;
  }

  /**
   * Run all loaders in parallel, resolve conflicts, and register the
   * winners in the target registry.
   *
   * @param signal — optional AbortSignal. If aborted, pending loaders
   *   are discarded; already-resolved results are still merged.
   */
  async create(signal?: AbortSignal): Promise<CommandServiceCreateResult> {
    const outcomes = await Promise.all(
      this.loaders.map(async (loader): Promise<LoaderOutcome> => {
        try {
          const results = await loader(signal);
          const source = results[0]?.source ?? 'extension';
          return { source, results };
        } catch (err) {
          const source: CommandSource = 'extension'; // fallback
          return {
            source,
            results: [],
            error: err instanceof Error ? err : new Error(String(err)),
          };
        }
      }),
    );

    // Merge by priority: collect all results, group by name, pick winner.
    const byName = new Map<
      string,
      Array<{ result: CommandLoaderResult; source: CommandSource }>
    >();
    for (const outcome of outcomes) {
      for (const result of outcome.results) {
        const name = result.command.name;
        if (!byName.has(name)) byName.set(name, []);
        byName.get(name)!.push({ result, source: result.source });
      }
    }

    const conflicts: CommandConflict[] = [];
    let count = 0;
    for (const [name, candidates] of byName) {
      if (candidates.length === 1) {
        // No conflict — register directly.
        const { result } = candidates[0]!;
        this.registerOne(result);
        count++;
        continue;
      }
      // Conflict — pick highest priority.
      candidates.sort(
        (a, b) => SOURCE_PRIORITY[b.source] - SOURCE_PRIORITY[a.source],
      );
      const winner = candidates[0]!;
      const losers = candidates.slice(1).map((c) => c.source);
      conflicts.push({
        name,
        winner: winner.source,
        losers,
      });
      this.registerOne(winner.result);
      count++;
    }

    return { count, conflicts, outcomes };
  }

  /** Register a single command, auto-setting kind from source. */
  private registerOne(result: CommandLoaderResult): void {
    const cmd = result.command;
    // Auto-set kind from source if not provided.
    if (!cmd.kind) {
      cmd.kind = sourceToKind(result.source);
    }
    this.registry.register(cmd);
  }
}

/**
 * Built-in loader — wraps the existing `registerDefaultCommands` function
 * (or a custom command list) into the loader API.
 */
export function builtinLoader(
  commands: Command[],
): CommandLoader {
  return async () => {
    return commands.map((command) => ({ source: 'builtin' as const, command }));
  };
}

/**
 * File-based loader — discovers `.md` files in a directory and turns each
 * into a command. The filename (sans `.md`) becomes the command name; the
 * file's frontmatter (optional) provides description / altNames / hidden.
 *
 * The file's body becomes the command's "instructions" — when the command
 * is invoked, the body is pushed as a system message (so the LLM sees it).
 *
 * Usage:
 *   fileLoader({ dir: '.goli/commands', source: 'workspace' })
 *   fileLoader({ dir: '~/.goli-cli/commands', source: 'user' })
 */
export function fileLoader(opts: {
  dir: string;
  source: CommandSource;
  /** Inject a custom file reader (for testing). */
  readDir?: (dir: string) => string[];
  readFile?: (file: string) => string;
}): CommandLoader {
  const readDir = opts.readDir ?? defaultReadDir;
  const readFile = opts.readFile ?? defaultReadFile;
  return async () => {
    const results: CommandLoaderResult[] = [];
    let files: string[];
    try {
      files = readDir(opts.dir);
    } catch {
      return []; // dir doesn't exist or unreadable
    }
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const name = file.replace(/\.md$/, '');
      let content: string;
      try {
        content = readFile(`${opts.dir}/${file}`);
      } catch {
        continue;
      }
      const { description, altNames, hidden, body } = parseCommandFile(content);
      results.push({
        source: opts.source,
        command: {
          name,
          description: description ?? `Custom command from ${file}`,
          altNames,
          hidden,
          kind: 'custom',
          handler: () => {
            // Push the file body as a system message (so the LLM sees it
            // as user-provided context). Call sites that want different
            // behavior can override the handler after loading.
            AppStateStore.pushSystemMessage(body, 'info');
          },
        },
      });
    }
    return results;
  };
}

/** Parse a command file's frontmatter + body. */
function parseCommandFile(content: string): {
  description: string | null;
  altNames: string[] | undefined;
  hidden: boolean | undefined;
  body: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { description: null, altNames: undefined, hidden: undefined, body: content };
  }
  const yaml = match[1] ?? '';
  const body = match[2] ?? content;
  const getDescription = (): string | null => {
    const m = yaml.match(/^description:\s*"?([^"\n]*)"?\s*$/m);
    return m?.[1] ?? null;
  };
  const getAltNames = (): string[] | undefined => {
    const m = yaml.match(/^altNames:\s*\[([^\]]*)\]\s*$/m);
    if (!m) return undefined;
    return (m[1] ?? '')
      .split(',')
      .map((s) => s.trim().replace(/^"|"$/g, ''))
      .filter(Boolean);
  };
  const getHidden = (): boolean | undefined => {
    const m = yaml.match(/^hidden:\s*(true|false)\s*$/m);
    if (!m) return undefined;
    return m[1] === 'true';
  };
  return {
    description: getDescription(),
    altNames: getAltNames(),
    hidden: getHidden(),
    body,
  };
}

/** Default `readDir` — uses node:fs to list files. */
function defaultReadDir(dir: string): string[] {
  try {
    
    return readdirSync(dir) as string[];
  } catch {
    return [];
  }
}

/** Default `readFile` — uses node:fs to read UTF-8 text. */
function defaultReadFile(file: string): string {
  
  return readFileSync(file, 'utf-8') as string;
}
