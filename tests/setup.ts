/**
 * Vitest setup file. Runs once per worker before any test.
 *
 * - Silences the logger by default (tests can re-enable per-test).
 * - Sets deterministic env vars (timezone, locale).
 * - Enables the test-only sandbox bypass so the bash tool can be
 *   exercised in integration tests without a real OS sandbox
 *   (bubblewrap/seatbelt). The bypass is checked ONLY in the sandbox
 *   executor's fail-closed path — production code never reads this var.
 */

import { configureLogger } from '../packages/core/src/utils/logger.js';

// Silence the global logger in tests. Individual tests that assert on
// log output should create a separate logger via `createLogger()`.
configureLogger({
  level: 'silent',
  format: 'json',
});

// Deterministic timezone for any Date.now() / toLocaleString() tests
process.env.TZ = 'UTC';

// Defensive: ensure GOLI_HOME doesn't leak from CI into tests
delete process.env.GOLI_HOME;

// Test-only sandbox bypass. The sandbox executor refuses to run commands
// when no OS sandbox is available (fail-closed). In CI/dev without
// bubblewrap, integration tests would all fail. This var enables raw
// execution ONLY in the fail-closed fallback path.
process.env.GOLI_TEST_NO_SANDBOX = '1';
