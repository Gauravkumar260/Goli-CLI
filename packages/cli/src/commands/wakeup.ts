/**
 * `goli wakeup [prompt]` — Wake up the 11-agent swarm.
 *
 * This is the primary command. It kicks off the Scout-Plan-Execute-Verify
 * lifecycle:
 *   Scout → Researcher → Architect → Planner → Implementer →
 *   Debugger → QA/Tester → Security Auditor → Reviewer →
 *   Orchestrator → Documenter
 *
 * Phase 2 status: runs the **core agent loop** (Module 1: ReAct loop with
 * GLM-5.2). The full 11-agent swarm pipeline lands in Phase 13
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

import { loadConfig, createLogger, configureLogger, defaultLifecycleLogPath, APP_VERSION } from '@goli/core';
import { AgentLoop } from '@goli/core';

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
  configureLogger({
    level: globalOptions.debug ? 'debug' : config.logging.level,
    format: config.logging.format,
    lifecycleLogPath: config.logging.lifecycleLogPath ?? defaultLifecycleLogPath(),
    defaultContext: { module: 'goli.wakeup', version: APP_VERSION },
  });

  const ctx: CommandContext = buildCommandContext(globalOptions, config);
  const log = createLogger({ level: 'info', defaultContext: { module: 'goli.wakeup' } });

  // No prompt? Launch the TUI (equivalent to --interactive).
  if (!opts.prompt) {
    const { launchTui } = await import('../tui/launcher.js');
    return await launchTui(['wakeup']);
  }

  // Print banner
  printBanner(ctx, opts);

  // Phase 2: run the core agent loop (single-agent ReAct loop).
  // Phase 13 will replace this with the full 11-agent swarm pipeline.
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
 * This is a helper because Commander attaches global options to the
 * program, not to subcommands. We read them via the program.opts()
 * in the real entry point; for the command handler we re-parse argv.
 */
function parseGlobalOptsFromArgv(): Record<string, unknown> {
  const opts: Record<string, unknown> = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;
    switch (arg) {
      case '--debug': opts.debug = true; break;
      case '--god': opts.god = true; break;
      case '--auto': opts.auto = true; break;
      case '--model': opts.model = argv[++i]; break;
      case '--sandbox': opts.sandbox = argv[++i]; break;
      case '--effort': opts.effort = argv[++i]; break;
    }
  }
  return opts;
}
