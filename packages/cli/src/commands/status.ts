/**
 * `goli status` — Show health dashboard and active session stats.
 *
 * Phase 2 status: stub. The real implementation (Phase 12) reads from
 * the Langfuse observability backend and shows:
 * - Active sessions
 * - Per-agent token/cost/latency
 * - Stuck-loop alerts
 * - Daily budget consumption
 *
 * @module commands/status
 */

import { loadConfig, configureLogger, defaultLifecycleLogPath, APP_VERSION } from '@goli/core';

/**
 *
 */
export async function runStatus(): Promise<number> {
  const config = loadConfig();
  configureLogger({
    level: 'silent',
    lifecycleLogPath: defaultLifecycleLogPath(),
  });

  process.stdout.write('\n');
  process.stdout.write('📊 GOLI-CLI Status Dashboard\n');
  process.stdout.write('═'.repeat(60) + '\n\n');
  process.stdout.write('  Version:     ' + APP_VERSION + '\n');
  process.stdout.write('  Model:       ' + config.model.modelId + '\n');
  process.stdout.write('  Endpoint:    ' + config.model.baseUrl + '\n');
  process.stdout.write('  Sandbox:     ' + config.sandbox.mode + '\n');
  process.stdout.write('  Budget:      $' + config.budget.maxCostUsd + ' / session\n');
  process.stdout.write('\n');
  process.stdout.write('  ⏳ Live session stats (Langfuse integration) lands in Phase 12.\n');
  process.stdout.write('  For now, use `goli audit` to check the audit log.\n');
  process.stdout.write('\n');

  return 0;
}
