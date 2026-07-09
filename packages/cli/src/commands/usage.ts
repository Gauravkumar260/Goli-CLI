/**
 * `goli usage` — Show model usage and cost breakdown.
 *
 * Reads from the trajectory store (Phase 10) and shows:
 * - Total tokens consumed (input / output / thinking)
 * - Total cost (USD)
 * - Per-model breakdown
 * - Per-session breakdown
 * - Daily/weekly/monthly aggregates
 *
 * Phase 2 status: stub. Trajectory logging lands in Phase 10.
 *
 * @module commands/usage
 */

import { loadConfig, configureLogger, defaultLifecycleLogPath, APP_VERSION } from '@goli/core';

/**
 *
 */
export async function runUsage(): Promise<number> {
  const config = loadConfig();
  configureLogger({
    level: 'silent',
    lifecycleLogPath: defaultLifecycleLogPath(),
  });

  process.stdout.write('\n');
  process.stdout.write('💰 GOLI-CLI Usage & Cost\n');
  process.stdout.write('═'.repeat(60) + '\n\n');
  process.stdout.write('  Version:              ' + APP_VERSION + '\n');
  process.stdout.write('  Model:                ' + config.model.modelId + '\n');
  process.stdout.write('  Input token cost:     $' + config.budget.costPerMillionInputTokens + ' / 1M tokens\n');
  process.stdout.write('  Output token cost:    $' + config.budget.costPerMillionOutputTokens + ' / 1M tokens\n');
  process.stdout.write('  Thinking token cost:  $' + config.budget.costPerMillionThinkingTokens + ' / 1M tokens\n');
  process.stdout.write('  Session budget cap:   $' + config.budget.maxCostUsd + '\n');
  process.stdout.write('\n');
  process.stdout.write('  ⏳ Usage tracking (trajectory store) lands in Phase 10.\n');
  process.stdout.write('  Self-hosted GLM-5.2 = $0/token (cost rates stay at 0).\n\n');

  return 0;
}
