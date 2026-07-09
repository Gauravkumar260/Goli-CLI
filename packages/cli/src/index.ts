/**
 * @goli/cli — GOLI-CLI binary entry point.
 *
 * This is the file invoked by `packages/cli/dist/index.js` (the compiled
 * binary). It uses Commander.js to parse subcommands and dispatches to
 * the appropriate command handler.
 *
 * ## Commands (Phase 2)
 *
 * - `goli wakeup <prompt>`  — Wake up the 11-agent swarm to perform a task
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
    .option('--demo', 'Launch the TUI with a mock agent (no LLM required). For onboarding, screenshots, and UI testing.')
    .action(async () => {
      // Default action (no subcommand given). If --demo is set, run demo mode.
      // Otherwise, show help (Commander's default behavior for no subcommand).
      const opts = program.opts();
      if (opts['demo']) {
        const code = await runDemo();
        process.exitCode = code;
      } else {
        program.help();
      }
    });

  // ─── wakeup ────────────────────────────────────────────────────
  program
    .command('wakeup [prompt]')
    .description('Wake up the 11-agent swarm to perform a task\n(e.g. "goli wakeup \\"refactor the auth module to use JWT\\")')
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
  const opts = program.opts();

  // Demo mode (--demo flag) — launches the TUI with MockAgentLoop.
  // No LLM required. For onboarding, screenshots, and UI testing.
  if (opts['demo']) {
    const exitCode = await runDemo();
    process.exitCode = exitCode;
    return;
  }

  // Headless / print mode (-p flag).
  if (opts['print'] !== undefined) {
    let prompt = opts['print'] as string;

    // Support `goli -p -` to read from stdin.
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
    });
    process.exitCode = exitCode;
  }
}

/**
 * Read all of stdin as a string.
 */
function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data.trim()));
    // Timeout after 30s if no input.
    setTimeout(() => resolve(data.trim()), 30_000);
  });
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
  },
): Promise<number> {
  try {
    const { loadConfig, createLogger, configureLogger, defaultLifecycleLogPath, AgentLoop } = await import('@goli/core');
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

    const loop = new AgentLoop({
      config,
      logger,
      godMode: opts.godMode,
      autoMode: opts.autoMode,
      modelOverride: opts.model,
      effortOverride: opts.effort as 'low' | 'high' | 'max' | undefined,
    });

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
  try {
    const { MockAgentLoop } = await import('./services/MockAgentLoop.js');

    const agent = new MockAgentLoop();

    process.stderr.write('🎮 Goli-CLI demo mode — using MockAgentLoop (no LLM required)\n');
    process.stderr.write('   Press Ctrl+C to exit.\n\n');

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
    process.stderr.write(`Demo complete:\n`);
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
