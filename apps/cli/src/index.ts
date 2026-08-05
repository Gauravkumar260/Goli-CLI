/**
 * @goli/cli — GOLI-CLI binary entry point.
 *
 * This is the file invoked by `apps/cli/dist/index.js` (the compiled
 * binary). It uses Commander.js to parse subcommands and dispatches to
 * the appropriate command handler.
 *
 * ## Commands (Phase 2)
 *
 * - `goli wakeup <prompt>`  — Wake up the 8-agent swarm to perform a task
 * - `goli doctor`            — Check system requirements and environment health
 * - `goli status`            — Show health dashboard and active session stats
 * - `goli audit`             — Verify safety audit log integrity
 * - `goli usage`             — Show model usage and cost breakdown
 * - `goli commit`            — Apply pending changes from a session to your host
 * - `goli init`              — Initialize GOLI.md and index
 *
 * ## Flags
 *
 * - `-p <prompt>` / `--print <prompt>` — Headless mode: run the agent, print the result to stdout, exit. For CI/CD.
 * - `--interactive` / `-i`   — Start the full Ink TUI (Phase 3)
 * - `--model <id>`           — Override the default model for this session
 * - `--god`                  — Bypass all safety gates (use with extreme caution)
 * - `--auto`                 — Auto-approve Tier 2 (Risky) actions
 * - `--sandbox <mode>`       — Override sandbox mode (read-only / workspace-write / danger-full-access)
 * - `--effort <level>`       — Override reasoning effort (low / high / max)
 * - `--debug`                — Enable debug logging
 * - `--version` / `-V`       — Print version
 * - `--help` / `-h`          — Print help
 *
 * @module @goli/cli
 */

import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from "node:url";

import { Command } from 'commander';

import { APP_NAME, APP_VERSION, APP_TAGLINE } from './constants.js';

// ─── .env loader (no external dependency) ─────────────────────────────
// Loads .env from CWD and the CLI package dir, setting process.env for
// any vars not already set (existing env vars take precedence).
(function loadEnv() {
  const candidates = [
    join(process.cwd(), '.env'),
    join(dirname(fileURLToPath(import.meta.url)), '..', '.env'),
  ];
  for (const envPath of candidates) {
    if (!existsSync(envPath)) continue;
    try {
      const content = readFileSync(envPath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx < 0) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        // Don't override existing env vars.
        if (process.env[key] === undefined) {
          process.env[key] = val;
        }
      }
    } catch {
      // Ignore .env read errors.
    }
  }
})();

// Command modules are lazy-loaded inside their action handlers so that
// `goli --version` and `goli --help` don't pull in the full @goli/core
// graph (208 source files). Cold-start target: < 200ms (A1).
// Each handler does `const { runX } = await import('./commands/X.js')`.

/**
 * Create and configure the Commander program.
 *
 * Exported for testing — tests can call `createProgram()` and invoke
 * `.parseAsync(argv)` without touching `process.exit`.
 */
export function createProgram(): Command {
  const program = new Command();

  program
    .name(APP_NAME)
    .description(`${APP_TAGLINE}\n\nA production-grade, multi-agent software engineering tool.\nModeled after Gemini CLI and Claude Code.`)
    .version(`${APP_NAME} ${APP_VERSION} — ${APP_TAGLINE}`, '-V, --version', 'Print version and exit')
    .helpOption('-h, --help', 'Print this help and exit')
    .option('-p, --print <prompt>', 'Headless mode: run the agent, print the result to stdout, exit. For CI/CD.')
    .option('--debug', 'Enable debug logging')
    .option('--model <id>', 'Override the default model for this session')
    .option('--god', 'Bypass ALL safety gates (USE WITH EXTREME CAUTION)')
    .option('--auto', 'Auto-approve Tier 2 (Risky) actions')
    .option('--sandbox <mode>', 'Override sandbox mode: read-only | workspace-write | danger-full-access')
    .option('--effort <level>', 'Override reasoning effort: low | high | max')
    .option('--output-format <fmt>', 'Headless output format: text | json | stream-json (default: text)')
    .option('--spec-mode', 'Enable spec-driven mode — edit_file/write_file require an approved spec (H13)')
    .option('--diff-review', 'Enable diff-first review in headless mode (H14)')
    .option('--resume <id>', 'Resume a previous session by ID (H16)')
    .option('--branch <id>', 'Branch a previous session by ID into a new session (H16)')
    .option('--local-llms', 'Enable local-llms mode: three-axis router across local Ollama workers + cloud tier (sensitivity / complexity / availability)')
    .option('--demo', 'Launch the TUI with a mock agent (no LLM required). For onboarding, screenshots, and UI testing. (Alias for GOLI_TUI_AGENT=mock goli wakeup -i)')
    .allowUnknownOption(true)
    .action(async () => {
      // Default action (no subcommand given).
      //
      // P0-1 fix: Previously this branch called `program.help()` (which calls
      // process.exit(0)) whenever --demo was not set, which silently killed
      // the process before main() could dispatch headless mode (`-p <prompt>`).
      //
      // We now resolve the launch mode here and dispatch directly so that
      // `goli -p "..."`, `goli --demo`, and `goli` (no args) all behave:
      //   - --demo            → runDemo()
      //   - -p / --print      → runHeadless()
      //   - (otherwise)       → show help
      // Returning instead of calling program.help() lets main() see the
      // parsed opts and apply the same dispatch for the top-level flags
      // when no subcommand is provided.
      const opts = program.opts();
      if (opts['demo']) {
        const code = await runDemo();
        process.exitCode = code;
        return;
      }
      if (opts['print'] !== undefined) {
        let prompt = opts['print'] as string;
        if (prompt === '-') {
          prompt = await readStdin();
        }
        if (!prompt) {
          process.stderr.write('Error: -p flag requires a prompt (or "-" to read from stdin)\n');
          process.exitCode = 1;
          return;
        }
        const exitCode = await runHeadless(prompt, {
          model: opts['model'],
          godMode: opts['god'],
          autoMode: opts['auto'],
          sandbox: opts['sandbox'],
          effort: opts['effort'],
          outputFormat: opts['outputFormat'],
          specMode: opts['specMode'],
          diffReview: opts['diffReview'],
          resume: opts['resume'],
          branch: opts['branch'],
          localLlms: opts['localLlms'],
        });
        process.exitCode = exitCode;
        return;
      }
      // No subcommand, no --demo, no -p: show help and exit 0.
      program.help();
    });

  // ─── wakeup ────────────────────────────────────────────────────
  program
    .command('wakeup [prompt]')
    .description('Wake up the 8-agent swarm to perform a task\n(e.g. "goli wakeup \\"refactor the auth module to use JWT\\")')
    .option('-i, --interactive', 'Start the full Ink TUI for real-time chat (Phase 3)')
    .action(async (prompt: string | undefined, opts: { interactive?: boolean }) => {
      const { runWakeup } = await import('./commands/wakeup.js');
      const code = await runWakeup({ prompt, interactive: opts.interactive });
      process.exitCode = code;
    });

  // ─── doctor ────────────────────────────────────────────────────
  program
    .command('doctor')
    .description('Check system requirements and environment health')
    .action(async () => {
      const { runDoctor } = await import('./commands/doctor.js');
      const code = await runDoctor();
      process.exitCode = code;
    });

  // ─── status ────────────────────────────────────────────────────
  program
    .command('status')
    .description('Show health dashboard and active session stats')
    .action(async () => {
      const { runStatus } = await import('./commands/status.js');
      const code = await runStatus();
      process.exitCode = code;
    });

  // ─── audit ─────────────────────────────────────────────────────
  program
    .command('audit')
    .description('Verify safety audit log integrity')
    .option('-v, --verbose', 'Show recent entries')
    .option('--json', 'Output as JSON (for CI / scripts)')
    .action(async (options) => {
      const { runAudit } = await import('./commands/audit.js');
      const code = await runAudit({
        verbose: Boolean(options['verbose']),
        json: Boolean(options['json']),
      });
      process.exitCode = code;
    });

  // ─── usage ─────────────────────────────────────────────────────
  program
    .command('usage')
    .description('Show model usage and cost breakdown')
    .action(async () => {
      const { runUsage } = await import('./commands/usage.js');
      const code = await runUsage();
      process.exitCode = code;
    });

  // ─── commit ────────────────────────────────────────────────────
  program
    .command('commit')
    .description('Apply pending changes from a session to your host')
    .action(async () => {
      const { runCommit } = await import('./commands/commit.js');
      const code = await runCommit();
      process.exitCode = code;
    });

  // ─── init ──────────────────────────────────────────────────────
  program
    .command('init')
    .description('Initialize GOLI.md project memory and build the index')
    .action(async () => {
      const { runInit } = await import('./commands/init.js');
      const code = await runInit();
      process.exitCode = code;
    });

  // ─── index (P0-4) ──────────────────────────────────────────────
  // Manually index the workspace's source files into the symbol
  // graph for code intelligence. The AgentLoop also does this
  // lazily on its first run, but this command lets the user
  // trigger a re-index without starting a session (useful after
  // bulk file changes or when debugging empty findCallers results).
  program
    .command('index')
    .description('Index workspace symbols for code intelligence (P0-4)')
    .option('-f, --force', 'Force re-index (currently a no-op — the index is always rebuilt)')
    .option('-m, --max-files <count>', 'Max files to index (default 500)', (v: string) => parseInt(v, 10))
    .action(async (opts: { force?: boolean; maxFiles?: number }) => {
      const { runIndex } = await import('./commands/index.js');
      const code = await runIndex({ force: opts.force, maxFiles: opts.maxFiles });
      process.exitCode = code;
    });

  // ─── hooks (P0-8) ──────────────────────────────────────────────
  // Manage user-defined tool hooks (block / log / modify). Hooks
  // are stored in `.goli/hooks.json` and run alongside the built-in
  // hooks (block-secrets, block-destructive, etc.).
  const hooksCmd = program
    .command('hooks')
    .description('Manage user-defined tool hooks (P0-8)');
  hooksCmd
    .command('list')
    .description('List all configured hooks')
    .action(async () => {
      const { runHooksList } = await import('./commands/hooks.js');
      process.exitCode = await runHooksList();
    });
  hooksCmd
    .command('add')
    .description('Add a new hook')
    .requiredOption('-n, --name <name>', 'Hook name')
    .requiredOption('-t, --type <type>', 'pre or post')
    .requiredOption('--tool <tool>', 'Tool name (or * for all)')
    .requiredOption('-a, --action <action>', 'block, log, or modify')
    .option('--condition-type <type>', 'always, command-match, or path-match')
    .option('--condition-pattern <pattern>', 'Regex pattern for condition')
    .option('-m, --message <message>', 'Message shown when blocking')
    .action(async (opts: {
      name: string; type: string; tool: string; action: string;
      conditionType?: string; conditionPattern?: string; message?: string;
    }) => {
      const { runHooksAdd } = await import('./commands/hooks.js');
      process.exitCode = await runHooksAdd(opts);
    });
  hooksCmd
    .command('remove <name>')
    .description('Remove a hook by name')
    .action(async (name: string) => {
      const { runHooksRemove } = await import('./commands/hooks.js');
      process.exitCode = await runHooksRemove(name);
    });
  hooksCmd
    .command('enable <name>')
    .description('Enable a disabled hook')
    .action(async (name: string) => {
      const { runHooksEnable } = await import('./commands/hooks.js');
      process.exitCode = await runHooksEnable(name);
    });
  hooksCmd
    .command('disable <name>')
    .description('Disable a hook without removing it')
    .action(async (name: string) => {
      const { runHooksDisable } = await import('./commands/hooks.js');
      process.exitCode = await runHooksDisable(name);
    });

  // ─── mcp (H20) ─────────────────────────────────────────────────
  // Built lazily inside an action stub so `goli --help` still shows
  // the subcommand without importing the full MCP module graph.
  program
    .command('mcp')
    .description('Manage MCP (Model Context Protocol) servers')
    .allowUnknownOption(true)
    .action(async () => {
      const { buildMcpCommand } = await import('./commands/mcp.js');
      // Re-parse with the full MCP subcommand tree.
      const mcp = buildMcpCommand();
      await mcp.parseAsync(process.argv.slice(2));
    });

  // ─── cron ──────────────────────────────────────────────────────
  // Hermes-parity: scheduled agent tasks. Persists to ~/.goli-cli/cron.json.
  program
    .command('cron [subcommand] [args...]')
    .description('Manage scheduled agent tasks (add, list, remove, enable, disable)')
    .allowUnknownOption(true)
    .action(async (subcommand: string | undefined, args: string[]) => {
      const { runCron } = await import('./commands/cron.js');
      const code = await runCron([subcommand ?? 'list', ...args]);
      process.exitCode = code;
    });

  return program;
}

/**
 * Main entry point. Invoked when the binary runs.
 *
 * If `-p` / `--print` is passed, runs in headless mode: the agent runs
 * non-interactively, the result is printed to stdout, and the process
 * exits. This enables CI/CD integration:
 *
 *   goli -p "Fix the lint errors in src/utils.ts"
 *   goli -p "Write a unit test for the auth module" --auto
 *   echo "Fix the bug" | goli -p -
 */
async function main(): Promise<void> {
  const program = createProgram();
  await program.parseAsync(process.argv);

  // P0-1 fix: All top-level flag dispatch (--demo, -p/--print) is now
  // handled inside the default `.action()` registered in `createProgram()`.
  // When a subcommand is given (e.g. `goli wakeup`), Commander invokes
  // that subcommand's action instead of the top-level one and `main()`
  // simply returns after `parseAsync()`. We no longer duplicate the
  // dispatch here — previously `--demo` was run twice (once in the action
  // and once below) and `-p` was unreachable because `program.help()`
  // exited the process first.
  return;
}

/**
 * Read all of stdin as a string.
 *
 * P0-1 fix: Previously leaked `data`/`end` listeners and a 30s timer.
 * Now removes listeners and clears the timeout on resolve.
 */
function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      process.stdin.removeListener('data', onData);
      process.stdin.removeListener('end', onEnd);
      // Pause stdin so the process can exit if nothing else is keeping
      // the event loop alive.
      process.stdin.pause();
      resolve(data.trim());
    };
    const onData = (chunk: Buffer | string): void => {
      data += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
    };
    const onEnd = (): void => finish();
    const timer = setTimeout(finish, 30_000);

    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', onData);
    process.stdin.on('end', onEnd);
    // Resume in case stdin was paused.
    process.stdin.resume();
  });
}

/**
 * P3-4: Create a TypeScript LSP client for the current workspace.
 *
 * Constructs a `TypeScriptLspClient` that spawns
 * `typescript-language-server --stdio` lazily on the first LSP tool
 * call. If the binary isn't installed, the first LSP tool call will
 * return a clear install instruction (`npm install -g
 * typescript-language-server typescript`).
 *
 * Returns `undefined` if `@goli/core` doesn't export
 * `TypeScriptLspClient` (e.g. older build) — the agent runs without
 * LSP tools (they'll throw "LSP client not configured" if called).
 */
function createLspClient(logger: { info: (msg: string, ctx?: Record<string, unknown>) => void; warn: (msg: string, ctx?: Record<string, unknown>) => void }): unknown {
  try {
    const core = require('@goli/core') as typeof import('@goli/core');
    if (typeof core.TypeScriptLspClient !== 'function') return undefined;
    const rootUri = `file://${process.cwd()}`;
    const client = new core.TypeScriptLspClient({
      rootUri,
      logger: logger as never,
    });
    logger.info('TypeScript LSP client ready (lazy-start on first LSP tool call)', {
      rootUri,
      note: 'Install typescript-language-server globally to enable LSP tools: npm i -g typescript-language-server typescript',
    });
    return client;
  } catch (err) {
    logger.warn('Failed to construct TypeScript LSP client — continuing without LSP', {
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}

/**
 * P2-7: Create a context engine bundle (tree-sitter indexer + symbol
 * graph + hybrid retriever) for the current workspace.
 *
 * The bundle is created via `createContextEngine()` from `@goli/core`.
 * The symbol graph starts empty — the caller (or a future `/index`
 * command) must call `bundle.indexWorkspace(filePaths)` to populate it.
 * Without indexing, the retriever returns empty results (no harm, but
 * no code-intelligence benefit either).
 *
 * Returns `undefined` if the bundle can't be constructed (e.g.
 * @goli/core isn't fully loaded) — the agent runs without retrieved
 * context.
 */
function createContextEngineBundle(logger: { info: (msg: string, ctx?: Record<string, unknown>) => void; warn: (msg: string, ctx?: Record<string, unknown>) => void }): unknown {
  try {
    const core = require('@goli/core') as typeof import('@goli/core');
    if (typeof core.createContextEngine !== 'function') return undefined;
    const bundle = core.createContextEngine({
      workspaceRoot: process.cwd(),
      logger: logger as never,
    });
    logger.info('Context engine initialized (symbol graph + hybrid retriever)', {
      workspaceRoot: process.cwd(),
    });
    return bundle;
  } catch (err) {
    logger.warn('Failed to construct context engine — continuing without code intelligence', {
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}

/**
 * P2-6: Create a MemoryCurator wired to a PersistentMemory instance.
 *
 * The curator promotes within-session learnings to MEMORY.md / USER.md /
 * PROJECT.md at the end of each agent run. The PersistentMemory reads
 * and writes those files in the workspace. If the workspace doesn't
 * have a `.goli/` dir, PersistentMemory creates it lazily on first write.
 *
 * Returns `undefined` if the curator can't be constructed (e.g.
 * @goli/core isn't fully loaded) — the agent runs without curation.
 */
function createMemoryCurator(logger: { info: (msg: string, ctx?: Record<string, unknown>) => void; warn: (msg: string, ctx?: Record<string, unknown>) => void }): unknown {
  try {
    // Lazy-load so `goli --version` doesn't pull in the memory module graph.
    const core = require('@goli/core') as typeof import('@goli/core');
    if (!core.MemoryCurator || !core.PersistentMemory) return undefined;
    const persistent = new core.PersistentMemory({
      projectRoot: process.cwd(),
    });
    return new core.MemoryCurator({
      persistentMemory: persistent,
      logger: logger as never,
    });
  } catch (err) {
    logger.warn('Failed to construct MemoryCurator — continuing without curation', {
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}

/**
 * P2-5: Load MCP server configs from `$GOLI_HOME/mcp-servers.toml`.
 *
 * This is a thin wrapper around `loadMcpServers()` from
 * `cli/src/commands/mcp-config.ts`. It's a separate function so the
 * headless runHeadless path can call it without importing the full
 * mcp-config module graph (which pulls in the MCP CLI subcommand
 * builder). Returns an empty array if the config file doesn't exist
 * or can't be parsed — the agent runs without MCP tools in that case.
 *
 * @param logger - Used to log how many servers were found.
 * @returns Array of MCP server configs (possibly empty).
 */
function loadMcpServerConfigs(logger: { info: (msg: string, ctx?: Record<string, unknown>) => void; warn: (msg: string, ctx?: Record<string, unknown>) => void }): unknown[] {
  try {
    // Lazy-load so `goli --version` doesn't pull in the MCP config module.
    const { loadMcpServers, defaultMcpConfigPath } = require('./commands/mcp-config.js');
    const configs = loadMcpServers(defaultMcpConfigPath()) as Array<{ name?: string }>;
    if (configs.length > 0) {
      logger.info('MCP servers loaded from config', { count: configs.length, names: configs.map((c) => c?.name ?? '?') });
    }
    return configs;
  } catch (err) {
    logger.warn('Failed to load MCP server configs — continuing without MCP', {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * P1-6 fix (audit Finding CC-1 / 6.16 / 6.17): verify the integrity of
 * safety-critical directories at startup. The PolicyIntegrityManager
 * SHA-256-hashes every file in the registered policy dirs (approval
 * engine, sandbox, hooks, SICA, mode config) and compares against the
 * last-known-good hash stored in `.goli/policy.hash`.
 *
 * - On MATCH: the safety layer is unchanged since the last session. OK.
 * - On NEW (first run): accept-and-persist the current hash so future
 *   runs can detect changes. This is the "trust on first use" model.
 * - On MISMATCH: abort. A tampered safety layer could let the agent
 *   bypass all gates (e.g. editing `approval/engine.ts` to always
 *   return `'allow'`). The user must investigate and re-accept the
 *   hash via `goli doctor --accept-integrity` (TODO) or by deleting
 *   `.goli/policy.hash`.
 *
 * @param PolicyIntegrityManager - The manager class (injected so this
 *   function is testable without importing @goli/core).
 * @param IntegrityStatus - The status enum (injected).
 * @param logger
 * @returns `null` on success (MATCH or NEW-accepted), or an
 *   `{ message: string }` describing why the run should abort.
 */
/**
 * P1-7 fix (verification report item #3): exported so the TUI launch
 * path (`runWakeup` in `commands/wakeup.ts` and `runDemo` in this
 * file) can call the same integrity check that `runHeadless` uses.
 * Previously this function was only called from `runHeadless`, so TUI
 * sessions had no integrity check — a tampered safety layer would go
 * undetected until the next headless run.
 */
export function verifyPolicyIntegrityAtStartup(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  PolicyIntegrityManager: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  IntegrityStatus: any,
  // Use `unknown` then narrow — we don't import the Logger type at the
  // top of this file (it's lazy-loaded inside runHeadless). The caller
  // passes the real Logger instance; we cast here to access .info/.warn.
  logger: unknown,
): { message: string } | null {
  const log = logger as { info: (msg: string, ctx?: Record<string, unknown>) => void; warn: (msg: string, ctx?: Record<string, unknown>) => void };
  // Resolve the workspace root. In headless mode this is process.cwd().
  // We hash the safety-critical source directories of the @goli/core
  // package. If the package is installed in node_modules, the path
  // resolution here will find the installed copy; if running from a
  // monorepo worktree, it'll find the source. Either way, the hash is
  // stable across runs unless the files actually change.
  const workspaceRoot = process.cwd();
  // The policy dirs are the ones the audit flagged as
  // safety-critical: approval engine, sandbox, hooks, SICA, mode
  // config. We hash the SOURCE directories so a tamper attempt
  // (editing engine.ts to bypass approval) is detectable.
  //
  // We try several candidate paths to handle both monorepo and
  // installed-package layouts.
  const candidateRoots = [
    join(workspaceRoot, 'packages/core/src'),
    join(workspaceRoot, 'node_modules/@goli/core/dist/src'),
    join(workspaceRoot, 'node_modules/@goli/core/src'),
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fs: any = require('node:fs');
  const coreSrc = candidateRoots.find((p) => {
    try { return fs.existsSync(p) && fs.statSync(p).isDirectory(); } catch { return false; }
  });
  if (!coreSrc) {
    // Can't find the core package source — don't block the run, just
    // log. The integrity check is a safety net, not a hard gate when
    // the layout is unfamiliar.
    log.warn('PolicyIntegrityManager: could not locate @goli/core source dir — skipping integrity check', {
      candidates: candidateRoots,
    });
    return null;
  }

  const policyDirs = [
    join(coreSrc, 'approval'),
    join(coreSrc, 'sandbox'),
    join(coreSrc, 'tools/hooks'),
    join(coreSrc, 'memory/sica'),
    // P2-9 fix (re-verification report item FIX-J): the skills
    // subsystem (`memory/skills/`) contains safety-relevant code —
    // `SkillWriter` writes new SKILL.md files from trajectories,
    // `SkillArchiver` mutates the `archived:` flag in frontmatter,
    // and `SkillCatalog`/`SkillLoader` feed the L1 metadata into
    // the system prompt. A tamper attempt that, e.g., flipped
    // `archived: true → false` on a quarantined skill, or injected
    // a malicious skill into the catalog, would previously go
    // undetected because `memory/skills/` was NOT in the hash list.
    // We now hash it alongside the other safety-critical dirs.
    join(coreSrc, 'memory/skills'),
    join(coreSrc, 'config'),
  ].filter((p) => {
    try { return fs.existsSync(p); } catch { return false; }
  });

  if (policyDirs.length === 0) {
    log.info('PolicyIntegrityManager: no policy dirs found to hash', { coreSrc });
    return null;
  }

  const storagePath = join(workspaceRoot, '.goli', 'policy.hash');
   
  const manager = new PolicyIntegrityManager({ storagePath });
  const scope = 'goli-core-safety';
  const identifier = workspaceRoot;

  for (const dir of policyDirs) {
    const result = manager.checkIntegrity(scope, identifier + ':' + dir, dir);
    if (result.status === IntegrityStatus.MATCH) {
      log.info('PolicyIntegrityManager: integrity OK', { dir, fileCount: result.fileCount });
    } else if (result.status === IntegrityStatus.NEW) {
      // First run — accept and persist the current hash.
      const ok = manager.acceptIntegrity(scope, identifier + ':' + dir, result.hash);
      if (!ok) {
        log.warn('PolicyIntegrityManager: failed to persist initial hash', { dir });
      } else {
        log.info('PolicyIntegrityManager: first run — accepted current hash', { dir, fileCount: result.fileCount });
      }
    } else if (result.status === IntegrityStatus.MISMATCH) {
      return {
        message:
          `Integrity check FAILED: safety-critical directory '${dir}' has changed since the last session.\n` +
          `  Files hashed: ${result.fileCount}\n` +
          `  Current hash:  ${result.hash.slice(0, 16)}…\n` +
          `  This could be a legitimate upgrade OR a tampering attempt (e.g. someone edited the approval\n` +
          `  engine to bypass safety gates). If this was an intentional change, delete\n` +
          `  '${storagePath}' and re-run to re-trust. If this was NOT intentional, investigate before\n` +
          `  continuing. Aborting. (Use --god to bypass this check.)`,
      };
    }
  }
  return null;
}

/**
 * Run the agent in headless mode.
 *
 * Loads the config, creates an AgentLoop, runs the prompt, prints the
 * result to stdout, and returns the exit code. No TUI is started.
 *
 * @param prompt - The user's prompt.
 * @param opts - Options from the CLI flags.
 * @param opts.model
 * @param opts.godMode
 * @param opts.autoMode
 * @param opts.sandbox
 * @param opts.effort
 * @param opts.outputFormat
 * @param opts.specMode
 * @param opts.diffReview
 * @param opts.resume
 * @param opts.branch
 * @returns Exit code (0 = success, 1 = error).
 */
async function runHeadless(
  prompt: string,
  opts: {
    model?: string;
    godMode?: boolean;
    autoMode?: boolean;
    sandbox?: string;
    effort?: string;
    outputFormat?: string;
    specMode?: boolean;
    diffReview?: boolean;
    resume?: string;
    branch?: string;
    localLlms?: boolean;
  },
): Promise<number> {
  try {
    const { loadConfig, createLogger, configureLogger, defaultLifecycleLogPath, AgentLoop, SkillLoader, PolicyIntegrityManager, IntegrityStatus } = await import('@goli/core');
    const { formatAsJson, formatAsText, formatUsageSummary, parseOutputFormat } = await import('./commands/headless-output.js');

    // Validate output format.
    const outputFormat = parseOutputFormat(opts.outputFormat);
    if (outputFormat === null) {
      process.stderr.write(`Error: invalid --output-format '${opts.outputFormat}'. Must be: text | json | stream-json\n`);
      return 1;
    }

    const config = loadConfig();
    configureLogger({
      level: process.env['GOLI_DEBUG'] === '1' ? 'debug' : 'warn',
      format: 'json',
      lifecycleLogPath: defaultLifecycleLogPath(),
    });
    const logger = createLogger({ level: 'warn', defaultContext: { module: 'goli.headless' } });

    // Mark headless mode for tools that need it (ask_user auto-answers).
    process.env['GOLI_HEADLESS'] = '1';

    // H16: Session resume/branch. If --resume or --branch is set,
    // load (or create a branched) session and use its messages as the
    // starting point. (The actual wiring into AgentLoopInput requires
    // extending the loop to accept resumedMessages — follow-up. For
    // now, we just log the resume/branch intent.)
    if (opts.resume) {
      logger.info('Resume requested', { sessionId: opts.resume });
      // TODO: load session via JsonlSessionStore, pass messages to loop.run()
    }
    if (opts.branch) {
      logger.info('Branch requested', { sessionId: opts.branch });
      // TODO: branch session via JsonlSessionStore, pass messages to loop.run()
    }

    // P1-6 fix (audit Finding CC-1 / 6.16 / 6.17): instantiate
    // PolicyIntegrityManager at startup and verify safety-critical
    // directories haven't been tampered with since the last session.
    // The manager SHA-256-hashes every file in the registered policy
    // dirs and compares against the last-known-good hash stored in
    // `.goli/policy.hash`. On MISMATCH, we abort — a tampered safety
    // layer (approval engine, sandbox, hooks, SICA) could let the
    // agent bypass all gates.
    //
    // On first run (NEW status), we accept-and-persist the current
    // hash so subsequent runs can detect changes. The `--god` flag
    // skips the check (god mode is explicit user consent to bypass
    // all safety).
    if (!opts.godMode) {
      const integrityAbort = verifyPolicyIntegrityAtStartup(
        PolicyIntegrityManager,
        IntegrityStatus,
        logger,
      );
      if (integrityAbort !== null) {
        process.stderr.write(integrityAbort.message + '\n');
        return 1;
      }
    }

    const loop = new AgentLoop({
      config,
      logger,
      godMode: opts.godMode,
      autoMode: opts.autoMode,
      modelOverride: opts.model,
      effortOverride: opts.effort as 'low' | 'high' | 'max' | undefined,
      appMode: opts.localLlms ? 'local-llms' : (opts.godMode ? 'god' : 'build'),
      // P2-5: load MCP server configs from $GOLI_HOME/mcp-servers.toml
      // and pass them to the AgentLoop. The loop instantiates a
      // MCPClientManager, connects to each server, and registers their
      // tools as virtual T1 tools in the registry. Previously the
      // `goli mcp add` command wrote configs but no agent ever read
      // them — MCP was config-only.
      mcpServers: loadMcpServerConfigs(logger) as never,
      // P2-6: instantiate a MemoryCurator so within-session learnings
      // (read_file / grep / web_search results) are promoted to
      // MEMORY.md / USER.md / PROJECT.md at the end of each run.
      // Previously the curator was exported but never called — the
      // 3-tier memory was actually 2 disconnected tiers.
      memoryCurator: createMemoryCurator(logger) as never,
      // P2-7: instantiate a context engine (tree-sitter indexer +
      // symbol graph + hybrid retriever). The loop queries the
      // retriever at the start of each run and injects the top-k
      // results into the system prompt as "Retrieved Context".
      // Previously createContextEngine was exported but never called
      // — the agent had no symbol graph, no caller/definition lookup,
      // no semantic search. It was just an LLM with file-read/write.
      contextEngine: createContextEngineBundle(logger) as never,
      // P3-4: instantiate a TypeScript LSP client so the 4 LSP tools
      // (lsp_hover, lsp_goto_definition, lsp_references, lsp_diagnostics)
      // are functional. Previously they always threw "LSP client not
      // configured". The client spawns `typescript-language-server
      // --stdio` lazily on the first LSP tool call — if the binary
      // isn't installed, the tool returns a clear install instruction.
      lspClient: createLspClient(logger) as never,
      // Round-2 verification item #2 (SkillLoader dead in production):
      // wire a SkillLoader so `loop.ts:1740` can call
      // `formatL1ForPrompt()` and the L1 skills fragment is non-empty
      // in real headless sessions (when `<cwd>/.goli/skills` exists).
      // Previously this was the only production call site that didn't
      // pass a skillLoader, so the L1 fragment was always empty.
      skillLoader: new SkillLoader({
        skillsDir: join(process.cwd(), '.goli', 'skills'),
      }) as never,
    });

    // P2-5: connect to MCP servers (async). This spawns child processes
    // for stdio servers and opens connections for http servers. Failures
    // are logged but don't block the run — one bad server shouldn't
    // prevent the agent from starting.
    await loop.connectMcpServers();

    const result = await loop.run({ prompt });

    // Format output based on --output-format.
    if (outputFormat === 'json') {
      const json = formatAsJson(result);
      process.stdout.write(JSON.stringify(json, null, 2));
      process.stdout.write('\n');
    } else {
      // text or stream-json (stream-json falls back to text for the final
      // output since runStream() doesn't yet yield per-iteration events).
      const text = formatAsText(result);
      if (text) {
        process.stdout.write(text);
        process.stdout.write('\n');
      }
      // Print usage to stderr (so stdout stays clean for piping).
      const usage = formatUsageSummary(result);
      if (usage) {
        process.stderr.write(`\n${usage}\n`);
      }
    }

    return result.ok ? 0 : 1;
  } catch (err) {
    process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

/**
 * Run the agent in demo mode (--demo flag).
 *
 * Runs MockAgentLoop and prints the scripted event sequence to stdout.
 * No LLM API key or endpoint required. The mock agent yields:
 *   INIT → PLAN → TOOL (read_file) → GEN → DONE
 *
 * This is for:
 *   - New-user onboarding (see the agent flow without setup)
 *   - Screenshot testing (deterministic output)
 *   - CI smoke testing (verifies the event pipeline)
 *
 * @returns Exit code (0 = success, non-zero = failure).
 */
async function runDemo(): Promise<number> {
  // P1-2 fix (verification report item #2): the --demo flag's help text
  // promises "Launch the TUI with a mock agent", but the previous
  // implementation was headless — it printed mock agent events to stdout
  // and never started the Ink TUI. Users running `goli --demo` saw a
  // stream of text instead of the interactive UI they were promised.
  //
  // We now honor the help text by setting GOLI_TUI_AGENT=mock and
  // launching the actual TUI via launchTui(['wakeup', '-i']). The mock
  // agent loop (MockAgentLoop) is selected by useAgentLoop.ts when
  // GOLI_TUI_AGENT=mock, so no LLM credentials are required.
  //
  // If launchTui() fails (e.g., no TTY available — common in CI), we
  // fall back to the original headless demo so `goli --demo` still
  // produces useful output for screenshots and smoke tests.
  try {
    if (!process.env['GOLI_TUI_AGENT']) {
      process.env['GOLI_TUI_AGENT'] = 'mock';
    }
    process.stderr.write('🎮 Goli-CLI demo mode — launching TUI with MockAgentLoop (no LLM required)\n');
    process.stderr.write('   Press Ctrl+C to exit.\n\n');

    // Prefer the interactive TUI when a TTY is available.
    if (process.stdout.isTTY) {
      const { launchTui } = await import('./tui/launcher.js');
      return await launchTui(['wakeup', '-i']);
    }

    // Headless fallback (CI, piped stdout, no TTY).
    const { MockAgentLoop } = await import('./services/MockAgentLoop.js');
    const agent = new MockAgentLoop();

    let phaseCount = 0;
    let toolCount = 0;
    let textChars = 0;

    for await (const ev of agent.run({ prompt: 'Welcome to Goli-CLI! This is a demo with mock responses.', messageId: 'demo', godMode: false })) {
      switch (ev.kind) {
        case 'phase':
          phaseCount++;
          process.stdout.write(`\n┌─ ${ev.phase} ─────────────────────────┐\n`);
          break;
        case 'text':
          process.stdout.write(ev.text);
          textChars += ev.text.length;
          break;
        case 'tool': {
          toolCount++;
          const t = ev.tool;
          const status = t.status === 'running' ? '⚡' : '✓';
          process.stdout.write(`\n  ${status} ${t.name} (${t.tier}) → ${t.arg}\n`);
          if (t.status === 'success' && t.durationMs) {
            process.stdout.write(`     completed in ${t.durationMs}ms — ${t.meta ?? ''}\n`);
          }
          break;
        }
        case 'done':
          process.stdout.write('\n\n└─ DONE ────────────────────────────┘\n');
          break;
      }
    }

    const result = agent.getLastResult();
    process.stderr.write('\n────────────────────────────────────\n');
    process.stderr.write(`Demo complete (headless fallback — no TTY detected):\n`);
    process.stderr.write(`  Phases: ${phaseCount} (INIT, PLAN, TOOL, GEN, DONE)\n`);
    process.stderr.write(`  Tool calls: ${toolCount}\n`);
    process.stderr.write(`  Text output: ${textChars} chars\n`);
    if (result) {
      process.stderr.write(`  Tokens: ${result.inputTokens} input, ${result.outputTokens} output\n`);
    }
    process.stderr.write('────────────────────────────────────\n');

    return 0;
  } catch (err) {
    process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

// Only run main() if this file is the entry point.
// Handles npm-linked global binaries where process.argv[1] may point
// to a symlink target (npm shim wrapper) instead of the real file.
if (import.meta.url) {
  const thisFile = fileURLToPath(import.meta.url);
  const entryArg = process.argv[1];
  if (entryArg) {
    try {
      const resolvedThis = realpathSync(thisFile);
      const resolvedArg = realpathSync(entryArg);
      if (resolvedThis === resolvedArg) {
        void main();
      }
    } catch {
      // realpath failed — fall back to direct compare
      if (thisFile.replace(/\\/g, '/') === entryArg.replace(/\\/g, '/')) {
        void main();
      }
    }
  }
}
