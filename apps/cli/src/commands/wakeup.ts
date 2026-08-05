/**
 * `goli wakeup [prompt]` — Wake up the 8-agent swarm.
 *
 * This is the primary command. It kicks off the Scout-Plan-Execute-Verify
 * lifecycle. The TUI surfaces 8 agent display roles (orchestrator, coder,
 * reviewer, searcher, devops, designer, security, data); the underlying
 * `AgentRole` enum in `@goli/core` has 11 values (scout, researcher,
 * architect, planner, implementer, debugger, qa-tester, security-auditor,
 * reviewer, orchestrator, documenter) used by the orchestration pipeline.
 *
 * Phase 2 status: runs the **core agent loop** (Module 1: ReAct loop with
 * LLM). The full multi-agent pipeline lands in Phase 13
 * (Module 7: Multi-Agent Orchestration).
 *
 * Usage:
 *   goli wakeup "refactor the auth module to use JWT"
 *   goli wakeup --interactive
 *   goli wakeup --model ollama/gpt-oss:120b "fix the bug in parser.ts"
 *   goli wakeup --god "delete everything"   # bypasses safety (DANGER)
 *
 * @module commands/wakeup
 */

import { join } from 'node:path';

import { loadConfig, createLogger, configureLogger, defaultLifecycleLogPath, APP_VERSION } from '@goli/core';
import { AgentLoop, SkillLoader } from '@goli/core';

import { extractGlobalOptions, buildCommandContext, type CommandContext } from './types.js';

/** Options for the wakeup command. */
export interface WakeupOptions {
  /** The task prompt. If omitted, starts interactive mode (Phase 3). */
  prompt?: string;
  /** Whether to start the full Ink TUI (Phase 3). */
  interactive?: boolean;
}

/**
 * Run the `woli wakeup` command.
 *
 * @param opts
 * @returns Process exit code (0 = success, non-zero = failure).
 */
export async function runWakeup(opts: WakeupOptions): Promise<number> {
  // Extract global options from the Commander program
  // (Commander stores them on program.opts(); we access via process.argv parse)
  const globalOptions = extractGlobalOptions(parseGlobalOptsFromArgv());

  // Load config
  const config = loadConfig();

  // Configure logger
  const logging = config.logging ?? {};
  configureLogger({
    level: globalOptions.debug ? 'debug' : logging.level,
    format: logging.format,
    lifecycleLogPath: logging.lifecycleLogPath ?? defaultLifecycleLogPath(),
    defaultContext: { module: 'goli.wakeup', version: APP_VERSION },
  });

  const ctx: CommandContext = buildCommandContext(globalOptions, config);
  const log = createLogger({ level: 'info', defaultContext: { module: 'goli.wakeup' } });

  // P1-7 fix (verification report item #3): wire PolicyIntegrityManager
  // into the TUI launch path. Previously this check only ran in
  // headless mode (`runHeadless` in index.ts), so TUI sessions had no
  // integrity check — a tampered safety layer would go undetected.
  // We now run the same check before launching the TUI. The check is
  // skipped in god mode (explicit user consent to bypass all safety)
  // and is best-effort (if @goli/core source can't be located, the
  // check is skipped with a warning rather than blocking the launch).
  if (!ctx.godMode) {
    try {
      const { PolicyIntegrityManager, IntegrityStatus } = await import('@goli/core');
      const { verifyPolicyIntegrityAtStartup } = await import('../index.js');
      const integrityAbort = verifyPolicyIntegrityAtStartup(
        PolicyIntegrityManager,
        IntegrityStatus,
        log,
      );
      if (integrityAbort !== null) {
        process.stderr.write(integrityAbort.message + '\n');
        return 1;
      }
    } catch (err) {
      // Best-effort: if the integrity check fails to load or run, log
      // and continue. The TUI launch must not be blocked by an
      // integrity-check infrastructure failure.
      log.warn('PolicyIntegrityManager: integrity check skipped (load failure)', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // P2-9 fix (re-verification report item #4): run SkillArchiver
  // .archiveStale() at session start. Previously `archiveStale()` was
  // fully implemented and unit-tested (`tests/unit/skills.test.ts`)
  // but had ZERO production callers — skills were never auto-archived
  // even after years of inactivity, contradicting ADR-0026's
  // "auto-archive after 90 days" spec.
  //
  // We run it best-effort at session start (not on a daily timer)
  // because CLI sessions are short-lived; a daily timer would require
  // a long-running daemon, which is overkill for a CLI tool. The
  // 90-day threshold means this runs at most once per 90 days per
  // skill, so the per-session overhead is negligible (a directory
  // scan + frontmatter parse for each skill file).
  //
  // Failures are logged but never block the session — skill archival
  // is a maintenance task, not a safety gate.
  try {
    const { SkillArchiver } = await import('@goli/core');
    const { existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    const skillsDir = join(process.cwd(), '.goli', 'skills');
    if (existsSync(skillsDir)) {
      const archiver = new SkillArchiver({ skillsDir });
      const archivedCount = archiver.archiveStale();
      if (archivedCount > 0) {
        log.info('SkillArchiver: auto-archived stale skills', {
          archivedCount,
          skillsDir,
          thresholdDays: 90,
        });
      }
    }
  } catch (err) {
    log.warn('SkillArchiver: archiveStale() skipped (load failure)', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // No prompt? Launch the TUI (equivalent to --interactive).
  if (!opts.prompt) {
    const { launchTui } = await import('../tui/launcher.js');
    return await launchTui(['wakeup']);
  }

  // Print banner
  printBanner(ctx, opts);

  // Phase 2: run the core agent loop (single-agent ReAct loop).
  // Phase 13 will replace this with the full multi-agent swarm pipeline.
  if (opts.interactive) {
    log.info('Interactive mode — launching TUI');
    // Launch the TUI (Phase 3)
    const { launchTui } = await import('../tui/launcher.js');
    const code = await launchTui(opts.prompt ? ['wakeup', opts.prompt] : ['wakeup']);
    return code;
  }

  // Run the agent loop
  try {
    log.info('Starting agent run', {
      prompt: (opts.prompt ?? '').slice(0, 100),
      model: config.model.modelId,
      effort: globalOptions.effort ?? config.model.defaultEffort,
      godMode: ctx.godMode,
      autoMode: ctx.autoMode,
    });

    const loop = new AgentLoop({
      config,
      logger: log,
      godMode: ctx.godMode,
      autoMode: ctx.autoMode,
      effortOverride: globalOptions.effort,
      modelOverride: globalOptions.model,
      // Round-2 verification item #2 (SkillLoader dead in production):
      // wire a SkillLoader so the L1 skills fragment is non-empty in
      // real headless sessions (when `<cwd>/.goli/skills` exists).
      skillLoader: new SkillLoader({
        skillsDir: join(process.cwd(), '.goli', 'skills'),
      }),
    });

    const result = await loop.run({ prompt: opts.prompt ?? '' });

    // Print result
    if (result.content) {
      process.stdout.write('\n' + result.content + '\n');
    }

    // Print summary
    process.stdout.write('\n');
    process.stdout.write('─'.repeat(60) + '\n');
    process.stdout.write(`Status:      ${result.ok ? '✓ completed' : '✗ failed'}\n`);
    process.stdout.write(`Stop reason: ${result.stopReason ?? 'unknown'}\n`);
    process.stdout.write(`Iterations:  ${result.iterations}\n`);
    process.stdout.write(`Tokens:      ${result.totalTokens.toLocaleString()}\n`);
    if (result.totalCostUsd > 0) {
      process.stdout.write(`Cost:        $${result.totalCostUsd.toFixed(4)}\n`);
    }
    process.stdout.write(`Duration:    ${(result.durationMs / 1000).toFixed(1)}s\n`);
    process.stdout.write('─'.repeat(60) + '\n');

    return result.ok ? 0 : 1;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('Agent run failed', { error: message });
    process.stderr.write(`\n✗ Agent run failed: ${message}\n`);
    return 1;
  }
}

/**
 * Print the wakeup banner showing mode and configuration.
 * @param ctx
 * @param opts
 */
function printBanner(ctx: CommandContext, opts: WakeupOptions): void {
  const mode = ctx.godMode ? '⚠ GOD MODE (safety bypassed)' : ctx.autoMode ? 'AUTO (Tier 2 auto-approved)' : 'SAFE';
  process.stdout.write('\n');
  process.stdout.write('╔' + '═'.repeat(58) + '╗\n');
  process.stdout.write('║' + `  🐝 GOLI-CLI v${APP_VERSION}`.padEnd(58) + '║\n');
  process.stdout.write('║' + '  11-Agent Swarm — Scout → Documenter Pipeline'.padEnd(58) + '║\n');
  process.stdout.write('╠' + '═'.repeat(58) + '╣\n');
  process.stdout.write('║' + `  Mode:   ${mode}`.padEnd(58) + '║\n');
  process.stdout.write('║' + `  Model:  ${ctx.config.model.modelId}`.padEnd(58) + '║\n');
  process.stdout.write('║' + `  Sandbox: ${ctx.config.sandbox.mode}`.padEnd(58) + '║\n');
  if (opts.prompt) {
    const truncatedPrompt = opts.prompt.length > 50 ? opts.prompt.slice(0, 47) + '...' : opts.prompt;
    process.stdout.write('║' + `  Task:   ${truncatedPrompt}`.padEnd(58) + '║\n');
  }
  process.stdout.write('╚' + '═'.repeat(58) + '╝\n');
}

/**
 * Parse global options from process.argv.
 *
 * P1-23 fix: The previous hand-rolled parser had multiple bugs:
 *   - Didn't handle `--flag=value` syntax (only matched exact `--flag`).
 *   - Didn't handle `--model --god` (treated `--god` as the model value).
 *   - Didn't handle `--local-llms` at all (silently dropped, even though
 *     `GlobalOptions` declares it).
 *   - Didn't error on unknown flags.
 *
 * We now:
 *   1. Split `--flag=value` into `[flag, value]` on the first `=`.
 *   2. For value-taking flags, reject values that start with `--` (they
 *      look like another flag, not a value) and fall through to treat
 *      the flag as boolean (matching Commander's behaviour for flags
 *      declared with `.option('--model <id>')` when no value follows).
 *   3. Add `--local-llms` and `--spec-mode` and `--diff-review` and
 *      `--resume` / `--branch` (all advertised in `goli --help`).
 *   4. Silently skip unknown flags (they may be subcommand-specific).
 *
 * Note: the cleanest fix would be to pass Commander's parsed
 * `program.opts()` through from `index.ts`, but that requires changing
 * the `runWakeup` signature and the `wakeup` action handler in
 * `index.ts`. This is left as a follow-up; for now the parser is at
 * least correct for the documented flag set.
 */
function parseGlobalOptsFromArgv(): Record<string, unknown> {
  const opts: Record<string, unknown> = {};
  const argv = process.argv.slice(2);
  // Boolean flags (no value).
  const BOOL_FLAGS = new Set([
    '--debug', '--god', '--auto', '--local-llms', '--spec-mode', '--diff-review',
    '--demo', '--interactive', '-i',
  ]);
  // Value-taking flags → key they populate.
  const VALUE_FLAGS: Record<string, string> = {
    '--model': 'model',
    '--sandbox': 'sandbox',
    '--effort': 'effort',
    '--output-format': 'outputFormat',
    '--resume': 'resume',
    '--branch': 'branch',
  };

  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    if (!arg) continue;
    if (arg === 'wakeup') continue; // skip the subcommand name itself

    // Handle `--flag=value` form.
    let inlineValue: string | undefined;
    const eqIdx = arg.indexOf('=');
    if (eqIdx > 0 && arg.startsWith('--')) {
      inlineValue = arg.slice(eqIdx + 1);
      arg = arg.slice(0, eqIdx);
    }

    if (BOOL_FLAGS.has(arg)) {
      // Map to the camelCase key used by extractGlobalOptions.
      const keyMap: Record<string, string> = {
        '--debug': 'debug',
        '--god': 'god',
        '--auto': 'auto',
        '--local-llms': 'localLlms',
        '--spec-mode': 'specMode',
        '--diff-review': 'diffReview',
        '--demo': 'demo',
        '--interactive': 'interactive',
        '-i': 'interactive',
      };
      opts[keyMap[arg]!] = true;
      continue;
    }
    if (arg in VALUE_FLAGS) {
      const key = VALUE_FLAGS[arg]!;
      let value: string | undefined = inlineValue;
      if (value === undefined) {
        // Take the next argv element, unless it looks like another flag.
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('-')) {
          value = next;
          i++; // consume the value
        } else {
          // No value provided — skip (Commander would error, but we're
          // being lenient here for the sake of the hand-rolled parser).
          continue;
        }
      }
      opts[key] = value;
      continue;
    }
    // Unknown flag — skip silently. It may be a subcommand-specific
    // option (e.g. `--verbose` for `audit`) that we don't handle here.
  }
  return opts;
}
