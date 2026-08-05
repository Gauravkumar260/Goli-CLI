/**
 * `goli cron` — Manage scheduled agent tasks.
 *
 * Hermes-Agent has a built-in cron scheduler for daily reports, nightly
 * backups, weekly audits, etc. Goli-CLI adds parity with this module.
 *
 * Cron entries persist to ~/.goli-cli/cron.json. Each entry has:
 *   - id: unique identifier (UUID)
 *   - schedule: cron expression (e.g. "0 9 * * *" = daily at 9am)
 *   - prompt: the task to run
 *   - createdAt: ISO timestamp
 *   - lastRunAt: ISO timestamp or null
 *   - enabled: boolean
 *
 * ## Usage
 *   goli cron add "0 9 * * *" "Generate a daily standup summary"
 *   goli cron list
 *   goli cron remove <id>
 *   goli cron run <id>          # run immediately (ignores schedule)
 *   goli cron enable <id>
 *   goli cron disable <id>
 *
 * ## Cron expression format
 * Standard 5-field cron: minute hour day-of-month month day-of-week
 *   asterisk         = any value
 *   asterisk/N       = every N units
 *   1,3,5            = list
 *   0-5              = range
 *
 * @module commands/cron
 */

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** A cron entry. */
export interface CronEntry {
  /** Unique identifier (UUID). */
  id: string;
  /** Cron expression (5 fields: minute hour dom month dow). */
  schedule: string;
  /** The task prompt to run. */
  prompt: string;
  /** ISO creation timestamp. */
  createdAt: string;
  /** ISO last-run timestamp, or null if never run. */
  lastRunAt: string | null;
  /** Whether the entry is enabled (active). */
  enabled: boolean;
}

/** The cron store (a JSON file). */
interface CronStore {
  entries: CronEntry[];
}

/** Default cron store path: ~/.goli-cli/cron.json */
export function defaultCronConfigPath(): string {
  const goliHome = process.env['GOLI_HOME'] ?? join(homedir(), '.goli-cli');
  return join(goliHome, 'cron.json');
}

/**
 * Load the cron store. Returns an empty store if the file doesn't exist.
 *
 * P1-20 fix: Previously a corrupt `cron.json` (e.g. from a non-atomic
 * write that was interrupted) was silently swallowed — `catch { return []; }`
 * with no logging. The user's scheduled tasks would silently stop
 * running and they'd have no idea why. We now write a warning to stderr
 * so the user at least knows the file is corrupt and can investigate
 * (or restore from backup). We still return `[]` rather than throwing
 * so the CLI doesn't crash, but the warning surfaces the problem.
 */
export function loadCronEntries(configPath: string = defaultCronConfigPath()): CronEntry[] {
  if (!existsSync(configPath)) return [];
  try {
    const data = JSON.parse(readFileSync(configPath, 'utf-8')) as CronStore;
    return data.entries ?? [];
  } catch (err) {
    // P1-20 fix: log to stderr so the user knows their cron file is corrupt.
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `Warning: cron config at ${configPath} is corrupt (${msg}). ` +
      `Scheduled tasks will not run until the file is fixed or removed.\n`,
    );
    return [];
  }
}

/**
 * Save the cron store.
 *
 * P1-20 fix: Use atomic write (temp file + rename) so a process crash
 * mid-write doesn't corrupt `cron.json`. Previously `writeFileSync` did
 * truncate-then-write — if the process was killed (SIGTERM, OOM,
 * `executeTick`'s hard interrupt firing during a `markCronRun` call)
 * between truncate and write, the file would be left empty or partial.
 * Combined with the silent `catch { return []; }` in `loadCronEntries`,
 * this was a silent scheduler outage: the user's scheduled tasks would
 * stop running with no warning.
 *
 * `renameSync` is atomic on POSIX (single syscall, same filesystem).
 * On Windows it's not strictly atomic but is still better than
 * truncate-then-write.
 */
function saveCronEntries(entries: CronEntry[], configPath: string = defaultCronConfigPath()): void {
  const dir = join(configPath, '..');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const store: CronStore = { entries };
  const tmp = configPath + '.tmp';
  writeFileSync(tmp, JSON.stringify(store, null, 2) + '\n', 'utf-8');
  // Atomic rename — readers never see a half-written file.
  renameSync(tmp, configPath);
}

/**
 * Validate a cron expression (5 fields).
 * Does NOT validate semantic correctness (e.g. "0 13 * * *" is valid
 * even though there's no hour 13 in 12-hour time — cron uses 24-hour).
 */
export function validateCronExpression(expr: string): { ok: boolean; error?: string } {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    return { ok: false, error: `Cron expression must have 5 fields (minute hour dom month dow), got ${fields.length}` };
  }
  const ranges = [
    { name: 'minute', min: 0, max: 59 },
    { name: 'hour', min: 0, max: 23 },
    { name: 'day-of-month', min: 1, max: 31 },
    { name: 'month', min: 1, max: 12 },
    { name: 'day-of-week', min: 0, max: 7 }, // 0 and 7 are both Sunday
  ];
  for (let i = 0; i < 5; i++) {
    const field = fields[i]!;
    const range = ranges[i]!;

    // Allow: *, */N, N, N-M, N,M,L, combinations
    const parts = field.split(',');
    for (const part of parts) {
      if (part === '*') continue;
      const stepMatch = part.match(/^\*\/(\d+)$/);
      if (stepMatch) {
        const step = parseInt(stepMatch[1]!, 10);
        if (step < 1 || step > range.max) {
          return { ok: false, error: `${range.name} step '${part}' out of range (1-${range.max})` };
        }
        continue;
      }
      const rangeMatch = part.match(/^(\d+)-(\d+)$/);
      if (rangeMatch) {
        const lo = parseInt(rangeMatch[1]!, 10);
        const hi = parseInt(rangeMatch[2]!, 10);
        if (lo < range.min || lo > range.max || hi < range.min || hi > range.max) {
          return { ok: false, error: `${range.name} range '${part}' out of range (${range.min}-${range.max})` };
        }
        continue;
      }
      const num = parseInt(part, 10);
      if (isNaN(num) || num < range.min || num > range.max) {
        return { ok: false, error: `${range.name} value '${part}' invalid or out of range (${range.min}-${range.max})` };
      }
    }
  }
  return { ok: true };
}

/** Add a cron entry. Returns the created entry. */
export function addCronEntry(
  schedule: string,
  prompt: string,
  configPath: string = defaultCronConfigPath(),
): { ok: boolean; entry?: CronEntry; error?: string } {
  const validation = validateCronExpression(schedule);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }
  if (!prompt.trim()) {
    return { ok: false, error: 'Prompt must not be empty' };
  }
  const entries = loadCronEntries(configPath);
  const entry: CronEntry = {
    id: randomUUID(),
    schedule: schedule.trim(),
    prompt: prompt.trim(),
    createdAt: new Date().toISOString(),
    lastRunAt: null,
    enabled: true,
  };
  entries.push(entry);
  saveCronEntries(entries, configPath);
  return { ok: true, entry };
}

/** Remove a cron entry by ID. Returns true if removed. */
export function removeCronEntry(id: string, configPath: string = defaultCronConfigPath()): boolean {
  const entries = loadCronEntries(configPath);
  const filtered = entries.filter((e) => e.id !== id);
  if (filtered.length === entries.length) return false;
  saveCronEntries(filtered, configPath);
  return true;
}

/** List all cron entries. */
export function listCronEntries(configPath: string = defaultCronConfigPath()): CronEntry[] {
  return loadCronEntries(configPath);
}

/** Enable/disable a cron entry. */
export function setCronEnabled(
  id: string,
  enabled: boolean,
  configPath: string = defaultCronConfigPath(),
): { ok: boolean; error?: string } {
  const entries = loadCronEntries(configPath);
  const entry = entries.find((e) => e.id === id);
  if (!entry) return { ok: false, error: `Cron entry '${id}' not found` };
  entry.enabled = enabled;
  saveCronEntries(entries, configPath);
  return { ok: true };
}

/** Mark a cron entry as run (updates lastRunAt). */
export function markCronRun(id: string, configPath: string = defaultCronConfigPath()): void {
  const entries = loadCronEntries(configPath);
  const entry = entries.find((e) => e.id === id);
  if (entry) {
    entry.lastRunAt = new Date().toISOString();
    saveCronEntries(entries, configPath);
  }
}

/**
 * Check if a cron expression should fire at the given time.
 * Simple field-by-field match — does NOT support L, W, # modifiers.
 */
export function shouldFire(schedule: string, date: Date): boolean {
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5) return false;

  const minute = date.getMinutes();
  const hour = date.getHours();
  const dom = date.getDate();
  const month = date.getMonth() + 1; // 0-indexed -> 1-indexed
  const dow = date.getDay(); // 0 = Sunday

  const values = [minute, hour, dom, month, dow];

  for (let i = 0; i < 5; i++) {
    const field = fields[i]!;
    const value = values[i]!;
    

    if (field === '*') continue;

    const parts = field.split(',');
    let matched = false;
    for (const part of parts) {
      // */N
      const stepMatch = part.match(/^\*\/(\d+)$/);
      if (stepMatch) {
        const step = parseInt(stepMatch[1]!, 10);
        if (value % step === 0) { matched = true; break; }
        continue;
      }
      // N-M
      const rangeMatch = part.match(/^(\d+)-(\d+)$/);
      if (rangeMatch) {
        const lo = parseInt(rangeMatch[1]!, 10);
        const hi = parseInt(rangeMatch[2]!, 10);
        // Handle dow 7 = Sunday
        const adjValue = (i === 4 && value === 0) ? 7 : value;
        const adjLo = (i === 4 && lo === 0) ? 7 : lo;
        const adjHi = (i === 4 && hi === 0) ? 7 : hi;
        if (adjValue >= adjLo && adjValue <= adjHi) { matched = true; break; }
        continue;
      }
      // N
      const num = parseInt(part, 10);
      if (i === 4) {
        // dow: 0 and 7 both mean Sunday
        if ((num === 0 || num === 7) && (value === 0)) { matched = true; break; }
      }
      if (num === value) { matched = true; break; }
    }
    if (!matched) return false;
  }
  return true;
}

/** Run the `goli cron` command. */
export async function runCron(args: string[]): Promise<number> {
  const subcommand = args[0] ?? 'list';
  const configPath = defaultCronConfigPath();

  switch (subcommand) {
    case 'list': {
      const entries = listCronEntries(configPath);
      if (entries.length === 0) {
        process.stdout.write('No cron entries. Use `goli cron add <schedule> <prompt>` to add one.\n');
        return 0;
      }
      process.stdout.write('Cron entries:\n');
      for (const e of entries) {
        const status = e.enabled ? '✓' : '✗';
        const lastRun = e.lastRunAt ?? 'never';
        process.stdout.write(`  ${status} ${e.id.slice(0, 8)}  ${e.schedule}  ${e.prompt.slice(0, 60)}  (last: ${lastRun})\n`);
      }
      return 0;
    }
    case 'add': {
      const schedule = args[1];
      const prompt = args.slice(2).join(' ');
      if (!schedule || !prompt) {
        process.stderr.write('Usage: goli cron add <schedule> <prompt>\n');
        process.stderr.write('Example: goli cron add "0 9 * * *" "Generate daily standup"\n');
        return 1;
      }
      const result = addCronEntry(schedule, prompt, configPath);
      if (!result.ok) {
        process.stderr.write(`Error: ${result.error}\n`);
        return 1;
      }
      process.stdout.write(`Added cron entry ${result.entry!.id.slice(0, 8)}: "${schedule}" -> "${prompt}"\n`);
      return 0;
    }
    case 'remove': {
      const id = args[1];
      if (!id) {
        process.stderr.write('Usage: goli cron remove <id>\n');
        return 1;
      }
      // Support short IDs (first 8 chars)
      const entries = listCronEntries(configPath);
      const match = entries.find((e) => e.id.startsWith(id));
      if (!match) {
        process.stderr.write(`Cron entry '${id}' not found\n`);
        return 1;
      }
      removeCronEntry(match.id, configPath);
      process.stdout.write(`Removed cron entry ${match.id.slice(0, 8)}\n`);
      return 0;
    }
    case 'enable':
    case 'disable': {
      const id = args[1];
      if (!id) {
        process.stderr.write(`Usage: goli cron ${subcommand} <id>\n`);
        return 1;
      }
      const entries = listCronEntries(configPath);
      const match = entries.find((e) => e.id.startsWith(id));
      if (!match) {
        process.stderr.write(`Cron entry '${id}' not found\n`);
        return 1;
      }
      setCronEnabled(match.id, subcommand === 'enable', configPath);
      process.stdout.write(`${subcommand === 'enable' ? 'Enabled' : 'Disabled'} cron entry ${match.id.slice(0, 8)}\n`);
      return 0;
    }
    default:
      process.stderr.write(`Unknown cron subcommand: ${subcommand}\n`);
      process.stderr.write('Available: list, add, remove, enable, disable\n');
      return 1;
  }
}
