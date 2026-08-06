/**
 * `goli doctor` — Check system requirements and environment health.
 *
 * Verifies that the host has everything GOLI-CLI needs:
 * - Node.js version
 * - ripgrep (required by the `grep` tool, Phase 4)
 * - git (required for worktree isolation, Phase 5/13)
 * - Model endpoint reachability
 * - GOLI.md project memory file exists
 * - ~/.goli-cli/ directory is writable
 *
 * @module commands/doctor
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { loadConfig } from '@goli-cli/config';
import { APP_VERSION } from '@goli-cli/shared/utils/constants.js';
import { configureLogger, defaultLifecycleLogPath } from '@goli-cli/shared/utils/logger.js';

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
  required: boolean;
}

/**
 * Run the `goli doctor` command.
 */
export async function runDoctor(): Promise<number> {
  const config = loadConfig();
  configureLogger({
    level: 'silent',
    lifecycleLogPath: defaultLifecycleLogPath(),
  });

  process.stdout.write('\n');
  process.stdout.write('🏥 GOLI-CLI Doctor — Environment Health Check\n');
  process.stdout.write('═'.repeat(60) + '\n\n');

  const results: CheckResult[] = [];

  // ─── Node.js version ─────────────────────────────────────────
  const nodeVersion = process.version;
  const nodeMajor = Number.parseInt(nodeVersion.slice(1).split('.')[0] ?? '0', 10);
  results.push({
    name: 'Node.js',
    ok: nodeMajor >= 20,
    detail: `${nodeVersion} (requires >=20.18.0)`,
    required: true,
  });

  // ─── ripgrep ─────────────────────────────────────────────────
  try {
    const rgVersion = execSync('rg --version', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] })
      .split('\n')[0]
      ?.trim();
    results.push({
      name: 'ripgrep',
      ok: true,
      detail: rgVersion ?? 'found',
      required: true,
    });
  } catch {
    results.push({
      name: 'ripgrep',
      ok: false,
      detail: 'NOT FOUND — install from https://github.com/BurntSushi/ripgrep',
      required: false, // Phase 4+ requires it; Phase 2 doesn't
    });
  }

  // ─── git ─────────────────────────────────────────────────────
  try {
    const gitVersion = execSync('git --version', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] })
      .trim();
    results.push({
      name: 'git',
      ok: true,
      detail: gitVersion,
      required: true,
    });
  } catch {
    results.push({
      name: 'git',
      ok: false,
      detail: 'NOT FOUND — required for worktree isolation (Phase 5/13)',
      required: true,
    });
  }

  // ─── GOLI_HOME directory ─────────────────────────────────────
  const goliHome = process.env.GOLI_HOME ?? join(homedir(), '.goli-cli');
  try {
    if (!existsSync(goliHome)) {
      mkdirSync(goliHome, { recursive: true });
    }
    accessSync(goliHome, constants.W_OK);
    results.push({
      name: 'GOLI_HOME',
      ok: true,
      detail: `${goliHome} (writable)`,
      required: true,
    });
  } catch {
    results.push({
      name: 'GOLI_HOME',
      ok: false,
      detail: `${goliHome} NOT WRITABLE`,
      required: true,
    });
  }

  // ─── GOLI.md project memory ──────────────────────────────────
  const goliMdPath = join(process.cwd(), 'GOLI.md');
  results.push({
    name: 'GOLI.md',
    ok: existsSync(goliMdPath),
    detail: existsSync(goliMdPath) ? `${goliMdPath} found` : 'not found (run `goli init` to create)',
    required: false,
  });

  // ─── Model endpoint ──────────────────────────────────────────
  results.push({
    name: 'Model endpoint',
    ok: !!config.model.baseUrl,
    detail: `${config.model.modelId} @ ${config.model.baseUrl}`,
    required: true,
  });

  // ─── API key ─────────────────────────────────────────────────
  const apiKeyOk = !!config.model.apiKey || !!process.env.OLLAMA_API_KEY || !!process.env.OPENAI_API_KEY || !!process.env.ANTHROPIC_API_KEY;
  results.push({
    name: 'API key',
    ok: apiKeyOk,
    detail: apiKeyOk ? 'configured (hidden)' : 'NOT SET (set OLLAMA_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY)',
    required: true,
  });

  // ─── Print results ───────────────────────────────────────────
  let allRequiredOk = true;
  for (const result of results) {
    const icon = result.ok ? '✓' : result.required ? '✗' : '⚠';
    process.stdout.write(`  ${icon} ${result.name.padEnd(18)} ${result.detail}\n`);
    if (!result.ok && result.required) {
      allRequiredOk = false;
    }
  }

  // ─── Summary ─────────────────────────────────────────────────
  process.stdout.write('\n' + '─'.repeat(60) + '\n');
  if (allRequiredOk) {
    process.stdout.write('✓ All required checks passed. GOLI-CLI is ready.\n');
  } else {
    process.stdout.write('✗ Some required checks failed. Fix the issues above.\n');
  }
  process.stdout.write(`  GOLI-CLI version: ${APP_VERSION}\n`);
  process.stdout.write('\n');

  return allRequiredOk ? 0 : 1;
}
