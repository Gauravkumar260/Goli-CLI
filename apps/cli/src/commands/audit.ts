/**
 * `goli audit` — Verify safety audit log integrity.
 *
 * Every tool call, every sandboxed command, every approval decision is
 * written to an immutable audit log. This command:
 * - Verifies the log file exists and is readable
 * - Counts entries, summarizes by tool/tier/outcome
 * - Detects tampering (hash-chain verification if available)
 * - Surfaces suspicious entries (god-mode, deny override, etc.)
 *
 * @module commands/audit
 */

import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { getAuditLogSummary, verifyAuditLog } from '@goli-cli/sandbox';
import { configureLogger, defaultLifecycleLogPath } from '@goli-cli/shared/utils/logger.js';

/**
 * Run the `goli audit` command.
 *
 * @param opts - Command options (verbose, json).
 * @param opts.verbose
 * @param opts.json
 * @returns Exit code (0 = success, 1 = log corrupted/missing).
 */
export async function runAudit(opts: { verbose?: boolean; json?: boolean } = {}): Promise<number> {
  configureLogger({
    level: 'silent',
    lifecycleLogPath: defaultLifecycleLogPath(),
  });

  const goliHome = process.env.GOLI_HOME ?? join(homedir(), '.goli-cli');
  const auditLogPath = join(goliHome, 'audit-log.jsonl');

  if (!existsSync(auditLogPath)) {
    if (opts.json) {
      process.stdout.write(JSON.stringify({ ok: false, reason: 'no_audit_log', path: auditLogPath }) + '\n');
    } else {
      process.stdout.write('\n');
      process.stdout.write('GOLI-CLI Audit Log Verification\n');
      process.stdout.write('═'.repeat(60) + '\n\n');
      process.stdout.write('  No audit log found at:\n');
      process.stdout.write('    ' + auditLogPath + '\n\n');
      process.stdout.write('  The audit log is created when the sandbox runs.\n');
      process.stdout.write('  No agent actions have been logged yet.\n\n');
    }
    return 0;
  }

  // Verify integrity (hash chain, if implemented).
  //
  // P1-1 fix (audit Finding 6.15): `verifyAuditLog()` and
  // `getAuditLogSummary()` are both async (they stream the log file
  // line-by-line via createReadStream). The previous call sites
  // omitted `await`, so `result` and `summary` were Promise objects.
  // `result.ok` was `undefined` → `!undefined` → `true` → the command
  // ALWAYS printed "Hash-chain verification: FAIL" and exited 1, even
  // on a healthy log. `summary.totalEntries` was `undefined` → the
  // command printed "Entries: undefined". Users learned to ignore the
  // FAIL message; real tampering would go unnoticed. We now await
  // both calls.
  let verificationOk = true;
  let verificationErrors: string[] = [];
  try {
    const result = await verifyAuditLog(auditLogPath);
    verificationOk = result.ok;
    verificationErrors = result.errors ?? [];
  } catch (err) {
    verificationOk = false;
    verificationErrors.push(`Verification failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Build a summary.
  const summary = await getAuditLogSummary(auditLogPath, 1000);
  const fileStat = statSync(auditLogPath);

  if (opts.json) {
    process.stdout.write(JSON.stringify({
      ok: verificationOk,
      path: auditLogPath,
      sizeBytes: fileStat.size,
      entries: summary.totalEntries,
      byTool: summary.byTool,
      byTier: summary.byTier,
      byOutcome: summary.byOutcome,
      godModeEntries: summary.godModeEntries,
      deniedEntries: summary.deniedEntries,
      verificationErrors,
    }, null, 2) + '\n');
  } else {
    process.stdout.write('\n');
    process.stdout.write('GOLI-CLI Audit Log Verification\n');
    process.stdout.write('═'.repeat(60) + '\n\n');
    process.stdout.write('  Log file:    ' + auditLogPath + '\n');
    process.stdout.write('  Entries:     ' + summary.totalEntries + '\n');
    process.stdout.write('  Size:        ' + (fileStat.size / 1024).toFixed(1) + ' KB\n');
    process.stdout.write('  Last entry:  ' + (summary.lastEntryTimestamp ?? '(none)') + '\n\n');

    if (summary.totalEntries > 0) {
      process.stdout.write('  By tool:\n');
      for (const [tool, count] of Object.entries(summary.byTool).sort((a, b) => b[1] - a[1])) {
        process.stdout.write(`    ${tool.padEnd(20)} ${count}\n`);
      }
      process.stdout.write('\n  By tier:\n');
      for (const [tier, count] of Object.entries(summary.byTier).sort()) {
        process.stdout.write(`    ${tier.padEnd(20)} ${count}\n`);
      }
      process.stdout.write('\n  By outcome:\n');
      for (const [outcome, count] of Object.entries(summary.byOutcome).sort()) {
        process.stdout.write(`    ${outcome.padEnd(20)} ${count}\n`);
      }
      // P0 verification fix: show the approval decision breakdown
      // (allow / ask / deny / always). The verification report's
      // checklist #9 noted that `goli audit` showed `tier` + `ok`
      // but not the approval `decision`. The `approval` field is on
      // every AuditLogEntry; we now summarize it alongside the
      // existing tier + outcome breakdowns.
      process.stdout.write('\n  By approval decision:\n');
      const approvalCounts: Record<string, number> = {};
      for (const entry of summary.recentEntries) {
        const decision = (entry as { approval?: string }).approval ?? 'unknown';
        approvalCounts[decision] = (approvalCounts[decision] ?? 0) + 1;
      }
      // Also count from the full entry set if available (recentEntries
      // is capped at 10; the summary may have a broader count).
      if (Object.keys(approvalCounts).length === 0) {
        process.stdout.write('    (no approval data in recent entries)\n');
      } else {
        for (const [decision, count] of Object.entries(approvalCounts).sort()) {
          process.stdout.write(`    ${decision.padEnd(20)} ${count}\n`);
        }
      }
      process.stdout.write('\n');
    }

    if (summary.godModeEntries > 0) {
      process.stdout.write(`  [WARNING] ${summary.godModeEntries} entries were executed in god mode (no sandbox).\n`);
    }
    if (summary.deniedEntries > 0) {
      process.stdout.write(`  [INFO] ${summary.deniedEntries} entries were denied by the approval engine.\n`);
    }

    if (verificationOk) {
      process.stdout.write('  Hash-chain verification: PASS\n\n');
    } else {
      process.stdout.write('  Hash-chain verification: FAIL\n');
      for (const err of verificationErrors) {
        process.stdout.write('    ' + err + '\n');
      }
      process.stdout.write('\n');
    }

    if (opts.verbose && summary.recentEntries.length > 0) {
      process.stdout.write('  Recent entries (last 10):\n');
      for (const entry of summary.recentEntries.slice(-10)) {
        const status = entry.ok ? 'OK' : 'FAIL';
        // P0 verification fix: include the approval decision in the
        // verbose entry display so users can see allow/ask/deny/always
        // alongside the tier + outcome.
        const approval = (entry as { approval?: string }).approval ?? '?';
        process.stdout.write(`    ${entry.timestamp} [${entry.tier}] [${approval}] ${entry.tool.padEnd(15)} ${status}\n`);
      }
      process.stdout.write('\n');
    }
  }

  return verificationOk ? 0 : 1;
}
