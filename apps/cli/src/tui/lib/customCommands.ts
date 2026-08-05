/**
 * Custom slash command loader (H17 — Custom Slash Commands).
 *
 * Loads user-defined slash commands from `.goli/commands/*.md` (project-level)
 * and `~/.goli-cli/commands/*.md` (user-level). Each markdown file defines
 * one command via YAML frontmatter + a prompt template body.
 *
 * ## File format
 *
 * ```markdown
 * ---
 * name: refactor
 * description: Refactor selected code
 * argument_hint: <file-path>
 * ---
 * Refactor the following code to improve readability and maintainability:
 *
 * $ARGUMENTS
 *
 * Apply these principles:
 * - Single Responsibility
 * - DRY (Don't Repeat Yourself)
 * - KISS (Keep It Simple, Stupid)
 * ```
 *
 * ## Variable substitution
 *
 * The body supports these substitutions:
 * - `$ARGUMENTS` — replaced with the args passed to the command
 * - `$WORKSPACE` — replaced with the current workspace root
 * - `$DATE` — replaced with the current ISO date
 *
 * ## Discovery order
 *
 * Project-level commands (`.goli/commands/`) take precedence over
 * user-level commands (`~/.goli-cli/commands/`). Built-in commands
 * (registered via `registerDefaultCommands`) take precedence over both.
 *
 * @module cli/tui/lib/customCommands
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, basename } from 'node:path';

import { AppStateStore } from '../state/AppStateStore.js';

import { globalCommands } from './CommandRegistry.js';

/** Parsed frontmatter for a custom command. */
interface CommandFrontmatter {
  name: string;
  description: string;
  argument_hint?: string;
}

/** Result of loading custom commands. */
export interface LoadCustomCommandsResult {
  /** Number of commands loaded. */
  count: number;
  /** Names of the loaded commands. */
  loaded: string[];
  /** Errors encountered (file path + message). */
  errors: Array<{ file: string; error: string }>;
}

/**
 * Parse YAML frontmatter from a markdown string.
 *
 * Returns `{ frontmatter, body }` or `null` if no frontmatter is found.
 * The parser is intentionally minimal — it only handles `key: value`
 * pairs (no nested objects, no arrays). For full YAML, use a proper
 * parser; but for command frontmatter, this is sufficient.
 *
 * @param content - The markdown content.
 * @param filename - The filename (for error messages).
 */
function parseFrontmatter(content: string, filename: string): { frontmatter: CommandFrontmatter; body: string } | { error: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    return { error: `${filename}: missing YAML frontmatter (expected ---\\n<yaml>\\n---\\n<body>)` };
  }
  const yamlBlock = match[1]!;
  const body = match[2]!.trim();

  const frontmatter: Partial<CommandFrontmatter> = {};
  for (const line of yamlBlock.split('\n')) {
    const m = line.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1]!;
    const value = m[2]!.replace(/^["']|["']$/g, '').trim();
    if (key === 'name') frontmatter.name = value;
    else if (key === 'description') frontmatter.description = value;
    else if (key === 'argument_hint' || key === 'argument-hint') frontmatter.argument_hint = value;
  }

  if (!frontmatter.name) {
    // Fall back to the filename (without extension).
    frontmatter.name = basename(filename).replace(/\.md$/, '');
  }
  if (!frontmatter.description) {
    frontmatter.description = `Custom command: ${frontmatter.name}`;
  }

  return { frontmatter: frontmatter as CommandFrontmatter, body };
}

/**
 * Substitute template variables in the command body.
 *
 * - `$ARGUMENTS` → the args joined with spaces
 * - `$WORKSPACE` → the current workspace root
 * - `$DATE` → the current ISO date
 *
 * @param body - The template body.
 * @param args - The args passed to the command.
 * @param workspaceRoot - The current workspace root.
 */
function substituteTemplate(body: string, args: string[], workspaceRoot: string): string {
  const argsStr = args.join(' ');
  const dateStr = new Date().toISOString().split('T')[0] ?? '';
  return body
    .replace(/\$ARGUMENTS\b/g, argsStr)
    .replace(/\$WORKSPACE\b/g, workspaceRoot)
    .replace(/\$DATE\b/g, dateStr);
}

/**
 * Load custom commands from disk and register them with the global
 * command registry.
 *
 * Searches (in order):
 *   1. `<workspaceRoot>/.goli/commands/*.md` (project-level)
 *   2. `~/.goli-cli/commands/*.md` (user-level)
 *
 * Project-level commands take precedence over user-level commands.
 * Built-in commands (registered via `registerDefaultCommands`) take
 * precedence over both — custom commands cannot override built-ins.
 *
 * @param workspaceRoot - The current workspace root (for `.goli/commands/`).
 * @returns The load result.
 */
export function loadCustomCommands(workspaceRoot: string = process.cwd()): LoadCustomCommandsResult {
  const searchDirs = [
    join(workspaceRoot, '.goli', 'commands'),
    join(process.env['GOLI_HOME'] ?? join(homedir(), '.goli-cli'), 'commands'),
  ];

  const loaded: string[] = [];
  const errors: Array<{ file: string; error: string }> = [];
  const seen = new Set<string>(); // dedupe by command name

  for (const dir of searchDirs) {
    if (!existsSync(dir)) continue;
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.md'));
    } catch {
      continue;
    }
    for (const file of files) {
      const fullPath = resolve(dir, file);
      let content: string;
      try {
        content = readFileSync(fullPath, 'utf-8');
      } catch (err) {
        errors.push({ file: fullPath, error: `Failed to read: ${err instanceof Error ? err.message : String(err)}` });
        continue;
      }
      const parsed = parseFrontmatter(content, file);
      if ('error' in parsed) {
        errors.push({ file: fullPath, error: parsed.error });
        continue;
      }
      const { frontmatter, body } = parsed;

      // Don't override built-in commands.
      if (globalCommands.has(frontmatter.name)) {
        errors.push({
          file: fullPath,
          error: `Command name '${frontmatter.name}' conflicts with a built-in command; skipping.`,
        });
        continue;
      }
      // Don't load duplicates (project-level takes precedence).
      if (seen.has(frontmatter.name)) {
        continue;
      }
      seen.add(frontmatter.name);

      // Capture the body in a closure for the handler.
      const templateBody = body;
      globalCommands.register({
        name: frontmatter.name,
        description: frontmatter.description,
        usage: `/${frontmatter.name}${frontmatter.argument_hint ? ` ${frontmatter.argument_hint}` : ''}`,
        handler: (args: string[]) => {
          const prompt = substituteTemplate(templateBody, args, workspaceRoot);
          // Show a system message indicating the custom command was triggered,
          // then submit the prompt to the agent loop.
          AppStateStore.pushSystemMessage(`[custom command: /${frontmatter.name}]`, 'info');
          // Submit the prompt to the agent loop via the queue.
          // The agent loop pickup is handled by AppStateStore.queueMessage.
          AppStateStore.queueMessage(prompt);
        },
      });
      loaded.push(frontmatter.name);
    }
  }

  return { count: loaded.length, loaded, errors };
}

/**
 * Get the list of directories that would be searched for custom commands.
 *
 * Useful for `/commands` slash command output.
 * @param workspaceRoot
 */
export function getCustomCommandSearchDirs(workspaceRoot: string = process.cwd()): string[] {
  return [
    join(workspaceRoot, '.goli', 'commands'),
    join(process.env['GOLI_HOME'] ?? join(homedir(), '.goli-cli'), 'commands'),
  ];
}
