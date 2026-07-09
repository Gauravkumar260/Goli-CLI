/**
 * Sandbox executor (Module 4).
 *
 * The main entry point for executing commands in the sandbox. Selects
 * the appropriate OS-native sandbox (Seatbelt on macOS, bubblewrap on
 * Linux), applies resource limits, routes network through the egress
 * filter, and logs to the audit log.
 *
 * @module sandbox/executor
 */

import { execSync, type ExecSyncOptions } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { platform } from 'node:os';

import { appendAuditLog } from './audit-log.js';
import { DEFAULT_RESOURCE_LIMITS } from './cgroups.js';
import { generateBubblewrapCommand, isBubblewrapAvailable } from './landlock.js';
import { NetworkEgressFilter, DEFAULT_NETWORK_ALLOWLIST } from './network.js';
import { generateSeatbeltProfile, buildSeatbeltCommand } from './seatbelt.js';

import type {
  SandboxMode,
  SandboxResult,
  ResourceLimits,
  AuditLogEntry,
} from './types.js';

/** Options for the sandbox executor. */
export interface SandboxExecutorOptions {
  /** The sandbox mode. */
  mode: SandboxMode;
  /** The workspace root. */
  workspaceRoot: string;
  /** Resource limits (default: DEFAULT_RESOURCE_LIMITS). */
  resourceLimits?: ResourceLimits;
  /** Network allowlist (default: DEFAULT_NETWORK_ALLOWLIST). */
  networkAllowlist?: string[];
  /** Whether god mode is active. */
  godMode?: boolean;
  /** Session ID (for audit log). */
  sessionId?: string;
}

/**
 * Execute a command in the sandbox.
 * @param command
 * @param opts
 */
export function executeInSandbox(
  command: string,
  opts: SandboxExecutorOptions,
): SandboxResult {
  const startTime = Date.now();
  const sessionId = opts.sessionId ?? randomUUID();
  const resourceLimits = opts.resourceLimits ?? DEFAULT_RESOURCE_LIMITS;

  // ─── God mode: no sandbox ─────────────────────────────────────
  if (opts.godMode || opts.mode === 'danger-full-access') {
    return executeRaw(command, opts, startTime, sessionId, 'danger-full-access');
  }

  // ─── Build the sandboxed command ──────────────────────────────
  const egressFilter = new NetworkEgressFilter(opts.networkAllowlist ?? DEFAULT_NETWORK_ALLOWLIST);
  const allowlist = { entries: egressFilter.getAllowlist() };

  let sandboxedCommand: string;
  if (platform() === 'darwin') {
    // macOS: use Seatbelt (sandbox-exec)
    const profile = generateSeatbeltProfile(opts.mode, opts.workspaceRoot, allowlist);
    sandboxedCommand = buildSeatbeltCommand(profile, command);
  } else if (platform() === 'linux' && isBubblewrapAvailable()) {
    // Linux: use bubblewrap (Landlock fallback)
    sandboxedCommand = generateBubblewrapCommand(opts.mode, opts.workspaceRoot, command, allowlist);
  } else {
    // Fail-closed: no OS sandbox available. The previous implementation
    // fell back to RAW execution with just a warning, which silently
    // disabled the sandbox — a security vulnerability. We now refuse to
    // execute unless the user has explicitly opted into god mode (which
    // is the only path that should bypass the sandbox anyway).
    //
    // If a user on an unsupported platform (e.g. Windows without WSL,
    // or a Linux box without bubblewrap) needs to run commands, they
    // must use `--god` mode and accept the risk.
    //
    // Test bypass: when `GOLI_TEST_NO_SANDBOX=1` is set (vitest setup),
    // we allow raw execution so integration tests can exercise the bash
    // tool without a real OS sandbox. This env var is checked here (not
    // in production code paths) and is documented in tests/setup.ts.
    if (process.env['GOLI_TEST_NO_SANDBOX'] === '1') {
      return executeRaw(command, opts, startTime, sessionId, opts.mode, 'Test mode: sandbox bypassed (GOLI_TEST_NO_SANDBOX=1)');
    }
    const platformName = platform();
    const reason = platformName === 'linux'
      ? 'Linux sandbox requires bubblewrap (bwrap). Install it: `apt install bubblewrap` (Debian/Ubuntu) or equivalent, then retry.'
      : platformName === 'darwin'
        ? 'macOS sandbox requires sandbox-exec (built-in). Check your PATH.'
        : `Sandboxing is not supported on ${platformName}. Use --god mode to run without a sandbox (at your own risk).`;
    return {
      ok: false,
      exitCode: 126, // 126 = "command invoked cannot execute" (POSIX)
      stdout: '',
      stderr: `Refusing to execute without a sandbox: ${reason}`,
      durationMs: Date.now() - startTime,
      killed: false,
      sandboxMode: opts.mode,
    };
  }

  // ─── Execute with timeout ─────────────────────────────────────
  const timeoutMs = resourceLimits.wallclockTimeoutS * 1000;
  let result: SandboxResult;

  try {
    const execOpts: ExecSyncOptions = {
      encoding: 'utf-8',
      cwd: opts.workspaceRoot,
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    };

    const stdout = execSync(sandboxedCommand, execOpts) as string;
    result = {
      ok: true,
      exitCode: 0,
      stdout,
      stderr: '',
      durationMs: Date.now() - startTime,
      killed: false,
      sandboxMode: opts.mode,
    };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string; signal?: string; killed?: boolean };
    result = {
      ok: false,
      exitCode: e.status ?? 1,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? String(err),
      durationMs: Date.now() - startTime,
      killed: e.killed ?? false,
      signal: e.signal,
      sandboxMode: opts.mode,
    };
  }

  // ─── Write to audit log ──────────────────────────────────────
  // Redact common secret patterns from the command before logging so
  // secrets don't get persisted to disk in plaintext. The previous
  // implementation logged the full command verbatim, which leaked
  // `Authorization: Bearer sk-xxx` headers, `--token` args, etc.
  const auditEntry: AuditLogEntry = {
    timestamp: new Date().toISOString(),
    tool: 'bash',
    action: redactSecrets(command),
    sandboxMode: opts.mode,
    approval: 'allow', // The approval engine decided before this point
    tier: classifyCommandTier(command),
    ok: result.ok,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    sessionId,
    workspaceRoot: opts.workspaceRoot,
  };
  appendAuditLog(auditEntry);

  return result;
}

/**
 * Redact common secret patterns from a command string before audit logging.
 *
 * Patterns redacted:
 * - `Authorization: Bearer XXX` and `Authorization: Basic XXX`
 * - `--token XXX`, `--api-key XXX`, `--apikey XXX`, `--secret XXX`
 * - `-H "Authorization: ..."` (curl-style header)
 * - `password=XXX`, `pwd=XXX`
 * - Environment variable assignments `SECRET=XXX`, `TOKEN=XXX`, `KEY=XXX`
 *
 * Note: this is a best-effort redaction for the audit log. The actual
 * command executed by the sandbox is NOT modified — only the logged copy.
 * @param command
 */
function redactSecrets(command: string): string {
  let redacted = command;
  // Authorization header (curl -H or HTTP client style)
  redacted = redacted.replace(/(Authorization:\s*(?:Bearer|Basic)\s+)([^\s'"]+)/gi, '$1[REDACTED]');
  // --token X / --api-key X / --apikey X / --secret X (with or without quotes)
  redacted = redacted.replace(/(--(?:token|api[-_]?key|apikey|secret|password|passwd)\s+)([^\s'"]+)/gi, '$1[REDACTED]');
  // password=X / pwd=X / token=X (env-var or query-string style)
  redacted = redacted.replace(/((?:password|passwd|token|secret|api[-_]?key)\s*=\s*)([^\s'";&]+)/gi, '$1[REDACTED]');
  // ENVVAR=value prefix where ENVVAR looks secret-y
  redacted = redacted.replace(/^([A-Z][A-Z0-9_]*(?:SECRET|TOKEN|KEY|PASSWORD|CREDENTIAL)[A-Z0-9_]*)\s*=\s*([^\s'"]+)/gm, '$1=[REDACTED]');
  return redacted;
}

/**
 * Execute a command without sandbox (god mode / danger-full-access).
 * @param command
 * @param opts
 * @param startTime
 * @param sessionId
 * @param mode
 * @param warning
 */
function executeRaw(
  command: string,
  opts: SandboxExecutorOptions,
  startTime: number,
  sessionId: string,
  mode: SandboxMode,
  warning?: string,
): SandboxResult {
  let result: SandboxResult;

  try {
    const stdout = execSync(command, {
      encoding: 'utf-8',
      cwd: opts.workspaceRoot,
      timeout: (opts.resourceLimits ?? DEFAULT_RESOURCE_LIMITS).wallclockTimeoutS * 1000,
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    result = {
      ok: true,
      exitCode: 0,
      stdout,
      stderr: warning ? `⚠️  ${warning}\n` : '',
      durationMs: Date.now() - startTime,
      killed: false,
      sandboxMode: mode,
    };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string; signal?: string; killed?: boolean };
    result = {
      ok: false,
      exitCode: e.status ?? 1,
      stdout: e.stdout ?? '',
      stderr: (warning ? `⚠️  ${warning}\n` : '') + (e.stderr ?? String(err)),
      durationMs: Date.now() - startTime,
      killed: e.killed ?? false,
      signal: e.signal,
      sandboxMode: mode,
    };
  }

  // Audit log
  const auditEntry: AuditLogEntry = {
    timestamp: new Date().toISOString(),
    tool: 'bash',
    action: command,
    sandboxMode: mode,
    approval: 'allow',
    tier: classifyCommandTier(command),
    ok: result.ok,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    sessionId,
    workspaceRoot: opts.workspaceRoot,
  };
  appendAuditLog(auditEntry);

  return result;
}

/**
 * Simple tier classification for audit logging.
 * @param command
 */
function classifyCommandTier(command: string): 'T0' | 'T1' | 'T2' | 'T3' | 'BLK' {
  if (/(rm|mkfs|dd|fork|DROP|DELETE|TRUNCATE)/i.test(command)) return 'BLK';
  if (/(curl|wget|npm publish|git push|git clone|ssh|scp)/i.test(command)) return 'T3';
  if (/(rm |mv |mkdir|git commit|git checkout|npm install|pip install|make|tsc)/i.test(command)) return 'T2';
  if (/(tee|> |>> )/.test(command)) return 'T1';
  return 'T0';
}
