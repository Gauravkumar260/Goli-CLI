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

import { execSync, execFileSync, exec, type ExecSyncOptions, type ExecOptions } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { platform } from 'node:os';

import { appendAuditLog } from './audit-log.js';
import {
  DEFAULT_RESOURCE_LIMITS,
  generateCgroupSetupScript,
  generateCgroupCleanupScript,
  isCgroupsV2Available,
} from './cgroups.js';
import { generateBubblewrapCommand, isBubblewrapAvailable } from './landlock.js';
import { NetworkEgressFilter, DEFAULT_NETWORK_ALLOWLIST } from './network.js';
import { generateSeatbeltProfile, buildSeatbeltCommand, buildSeatbeltCommandArgs } from './seatbelt.js';

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
    // Test bypass: when `GOLI_TEST_NO_SANDBOX=1` is set in the
    // *test* environment (NODE_ENV === 'test'), we allow raw
    // execution so integration tests can exercise the bash tool
    // without a real OS sandbox. The previous implementation checked
    // this env var in the PRODUCTION code path with NO NODE_ENV gate —
    // a trivial sandbox escape for any attacker who could influence
    // the environment (shell profile, CI config, parent process).
    // We now doubly-gate the bypass: env var AND test environment.
    if (
      process.env['GOLI_TEST_NO_SANDBOX'] === '1' &&
      process.env['NODE_ENV'] === 'test'
    ) {
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

  // ─── Execute with timeout + cgroups (Linux only) ────────────────
  const timeoutMs = resourceLimits.wallclockTimeoutS * 1000;
  let result: SandboxResult;

  // Apply cgroup-based resource limits on Linux. The previous
  // implementation imported DEFAULT_RESOURCE_LIMITS and computed
  // `resourceLimits` but only used `wallclockTimeoutS` — silently
  // ignoring memory, CPU, PID, and disk limits. A sandboxed process
  // could OOM the host, fork-bomb, or fill the disk.
  let cgroupSessionId: string | null = null;
  if (platform() === 'linux' && isCgroupsV2Available()) {
    cgroupSessionId = sessionId;
    try {
      const setupScript = generateCgroupSetupScript(resourceLimits, cgroupSessionId);
      execSync(setupScript, { encoding: 'utf-8', stdio: 'pipe' });
      // Wrap the sandboxed command so it writes its own PID into the
      // cgroup before exec-ing the actual payload.
      sandboxedCommand =
        `echo $$ > /sys/fs/cgroup/goli-cli/${cgroupSessionId}/cgroup.procs && exec ${sandboxedCommand}`;
    } catch (err) {
      // Fall back to no cgroups with a warning. The wallclock timeout
      // still applies via execSync's `timeout` option below.
      const msg = err instanceof Error ? err.message : String(err);
       
      console.warn(`[goli-cli] cgroup setup failed; resource limits (memory/CPU/PID/disk) NOT enforced: ${msg}`);
      cgroupSessionId = null;
    }
  }

  try {
    const execOpts: ExecSyncOptions = {
      encoding: 'utf-8',
      cwd: opts.workspaceRoot,
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    };

    // On macOS, prefer the arg-array form (buildSeatbeltCommandArgs) so
    // the user command is never re-parsed by a shell. `buildSeatbeltCommand`
    // (string form) is shell-injection-vulnerable via `execSync` which
    // invokes `/bin/sh -c <string>` — a command like `echo hi; rm -rf /tmp`
    // would split into TWO commands with the `rm` running OUTSIDE the
    // sandbox. We fall back to the string form only if the arg-array
    // builder is unavailable.
    let stdout: string;
    if (platform() === 'darwin' && typeof buildSeatbeltCommandArgs === 'function') {
      const { args, cleanup } = buildSeatbeltCommandArgs(
        generateSeatbeltProfile(opts.mode, opts.workspaceRoot, allowlist),
        command,
      );
      try {
        stdout = execFileSync(args[0]!, args.slice(1), execOpts) as string;
      } finally {
        cleanup();
      }
    } else {
      stdout = execSync(sandboxedCommand, execOpts) as string;
    }
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
  } finally {
    // Clean up the cgroup so we don't leak session dirs in /sys/fs/cgroup.
    if (cgroupSessionId !== null) {
      try {
        const cleanupScript = generateCgroupCleanupScript(cgroupSessionId);
        execSync(cleanupScript, { encoding: 'utf-8', stdio: 'pipe' });
      } catch {
        // Best-effort — the cgroup may already be empty/removed.
      }
    }
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
 * Execute a command in the sandbox ASYNCHRONOUSLY.
 *
 * The synchronous `executeInSandbox` blocks the Node.js event loop
 * for the duration of the command. For an interactive agent, this
 * means a 30-second `npm install` freezes ALL other operations
 * (including the TUI, background shells, streaming tool results).
 *
 * This async version uses `exec` (which spawns a child process and
 * returns immediately) instead of `execSync`. The Node.js event
 * loop stays responsive while the sandboxed command runs in a
 * separate process. The result shape is identical to the sync
 * version so callers can swap one for the other.
 *
 * @param command
 * @param opts
 */
export async function executeInSandboxAsync(
  command: string,
  opts: SandboxExecutorOptions,
): Promise<SandboxResult> {
  const startTime = Date.now();
  const sessionId = opts.sessionId ?? randomUUID();
  const resourceLimits = opts.resourceLimits ?? DEFAULT_RESOURCE_LIMITS;

  // God mode: no sandbox.
  if (opts.godMode || opts.mode === 'danger-full-access') {
    return executeRawAsync(command, opts, startTime, sessionId, 'danger-full-access');
  }

  // Build the sandboxed command (same logic as the sync version).
  const egressFilter = new NetworkEgressFilter(opts.networkAllowlist ?? DEFAULT_NETWORK_ALLOWLIST);
  const allowlist = { entries: egressFilter.getAllowlist() };

  let sandboxedCommand: string;
  if (platform() === 'darwin') {
    const profile = generateSeatbeltProfile(opts.mode, opts.workspaceRoot, allowlist);
    sandboxedCommand = buildSeatbeltCommand(profile, command);
  } else if (platform() === 'linux' && isBubblewrapAvailable()) {
    sandboxedCommand = generateBubblewrapCommand(opts.mode, opts.workspaceRoot, command, allowlist);
  } else {
    // Test bypass (same gate as sync version).
    if (
      process.env['GOLI_TEST_NO_SANDBOX'] === '1' &&
      process.env['NODE_ENV'] === 'test'
    ) {
      return executeRawAsync(command, opts, startTime, sessionId, opts.mode, 'Test mode: sandbox bypassed (GOLI_TEST_NO_SANDBOX=1)');
    }
    const platformName = platform();
    const reason = platformName === 'linux'
      ? 'Linux sandbox requires bubblewrap (bwrap). Install it: `apt install bubblewrap` (Debian/Ubuntu) or equivalent, then retry.'
      : platformName === 'darwin'
        ? 'macOS sandbox requires sandbox-exec (built-in). Check your PATH.'
        : `Sandboxing is not supported on ${platformName}. Use --god mode to run without a sandbox (at your own risk).`;
    return {
      ok: false,
      exitCode: 126,
      stdout: '',
      stderr: `Refusing to execute without a sandbox: ${reason}`,
      durationMs: Date.now() - startTime,
      killed: false,
      sandboxMode: opts.mode,
    };
  }

  // Cgroup setup (Linux only) — uses execSync because it's a fast
  // shell script. The actual payload uses async exec.
  const timeoutMs = resourceLimits.wallclockTimeoutS * 1000;
  let cgroupSessionId: string | null = null;
  if (platform() === 'linux' && isCgroupsV2Available()) {
    cgroupSessionId = sessionId;
    try {
      const setupScript = generateCgroupSetupScript(resourceLimits, cgroupSessionId);
      execSync(setupScript, { encoding: 'utf-8', stdio: 'pipe' });
      sandboxedCommand =
        `echo $$ > /sys/fs/cgroup/goli-cli/${cgroupSessionId}/cgroup.procs && exec ${sandboxedCommand}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
       
      console.warn(`[goli-cli] cgroup setup failed; resource limits NOT enforced: ${msg}`);
      cgroupSessionId = null;
    }
  }

  // Execute asynchronously. `exec` spawns a child process and returns
  // immediately — the event loop stays responsive.
  let result: SandboxResult;
  try {
    const execOpts: ExecOptions = {
      encoding: 'utf-8',
      cwd: opts.workspaceRoot,
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    };
    // Wrap exec in a Promise so we can await it.
    const stdout = await new Promise<string>((resolve, reject) => {
      exec(sandboxedCommand, execOpts, (err, stdout, stderr) => {
        if (err) {
          // Attach stdout/stderr to the error so the catch block can
          // extract them — Node's exec error object already has these
          // but we set them explicitly for clarity.
          (err as Error & { stdout?: string; stderr?: string }).stdout = stdout as string;
          (err as Error & { stdout?: string; stderr?: string }).stderr = stderr as string;
          reject(err);
        } else {
          resolve(stdout as string);
        }
      });
    });
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
  } finally {
    if (cgroupSessionId !== null) {
      try {
        const cleanupScript = generateCgroupCleanupScript(cgroupSessionId);
        execSync(cleanupScript, { encoding: 'utf-8', stdio: 'pipe' });
      } catch {
        // Best-effort.
      }
    }
  }

  // Audit log.
  const auditEntry: AuditLogEntry = {
    timestamp: new Date().toISOString(),
    tool: 'bash',
    action: redactSecrets(command),
    sandboxMode: opts.mode,
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
 * Async version of `executeRaw` (god mode / danger-full-access).
 * Uses `exec` instead of `execSync` to avoid blocking the event loop.
 */
async function executeRawAsync(
  command: string,
  opts: SandboxExecutorOptions,
  startTime: number,
  sessionId: string,
  mode: SandboxMode,
  warning?: string,
): Promise<SandboxResult> {
  let result: SandboxResult;
  try {
    const execOpts: ExecOptions = {
      encoding: 'utf-8',
      cwd: opts.workspaceRoot,
      timeout: (opts.resourceLimits ?? DEFAULT_RESOURCE_LIMITS).wallclockTimeoutS * 1000,
      maxBuffer: 10 * 1024 * 1024,
    };
    const stdout = await new Promise<string>((resolve, reject) => {
      exec(command, execOpts, (err, stdout) => {
        if (err) {
          (err as Error & { stdout?: string }).stdout = stdout as string;
          reject(err);
        } else {
          resolve(stdout as string);
        }
      });
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

  const auditEntry: AuditLogEntry = {
    timestamp: new Date().toISOString(),
    tool: 'bash',
    action: redactSecrets(command),
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
 * Redact common secret patterns from a command string before audit logging.
 *
 * Patterns redacted:
 * - `Authorization: Bearer XXX` and `Authorization: Basic XXX`
 * - `--token XXX`, `--api-key XXX`, `--apikey XXX`, `--secret XXX`
 * - `-H "Authorization: ..."` (curl-style header)
 * - `password=XXX`, `pwd=XXX`
 * - Environment variable assignments `SECRET=XXX`, `TOKEN=XXX`, `KEY=XXX`
 * - GitHub tokens (`ghp_`, `gho_`, `ghs_`, `ghu_`, `ghr_` prefixes)
 * - Slack tokens (`xox[bpoa]-` prefix)
 * - JWTs (`eyJ… . eyJ… . …`)
 * - PEM private key blocks
 * - URL-embedded `?token=…`, `&access_token=…`, `?api_key=…`
 * - Bare `Bearer XXX` (without `Authorization:` prefix)
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
  // ENVVAR=value prefix where ENVVAR looks secret-y (case-insensitive to catch
  // lowercase env vars and tokens like `GH_TOKEN`, `PAT`, `npm_token`, etc.).
  redacted = redacted.replace(/^([A-Za-z][A-Za-z0-9_]*(?:SECRET|TOKEN|KEY|PASSWORD|CREDENTIAL|PAT)[A-Za-z0-9_]*)\s*=\s*([^\s'"]+)/gm, '$1=[REDACTED]');
  // GitHub tokens (ghp_, gho_, ghs_, ghu_, ghr_ prefixes — 36+ chars after prefix)
  redacted = redacted.replace(/\b(gh[pousr]_[A-Za-z0-9]{36,})\b/g, '[REDACTED]');
  // Slack tokens (xox[bpoa]- prefix)
  redacted = redacted.replace(/\b(xox[bpoa]-[A-Za-z0-9-]+)\b/g, '[REDACTED]');
  // JWTs (three base64url segments separated by dots, first two start with eyJ)
  redacted = redacted.replace(/\b(eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g, '[REDACTED]');
  // PEM private key blocks
  redacted = redacted.replace(/-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g, '[REDACTED:private_key]');
  // URL-embedded tokens (?token=, ?access_token=, ?api_key=, ?secret=)
  redacted = redacted.replace(/([?&](?:token|access_token|api_key|secret)=)([^&\s'"]+)/gi, '$1[REDACTED]');
  // Bare `Bearer XXX` (no `Authorization:` prefix) — common in client code
  redacted = redacted.replace(/(Bearer\s+)([A-Za-z0-9._-]+)/gi, '$1[REDACTED]');
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

  // Audit log. Even in god mode we redact secrets — the audit log is
  // persisted to `~/.goli-cli/audit-log.jsonl` and a `danger-full-access`
  // command may still carry credentials (e.g., `curl -H 'Authorization:
  // Bearer sk-xxx'`). The previous implementation logged the raw command
  // in god mode, persisting those secrets to disk in plaintext.
  const auditEntry: AuditLogEntry = {
    timestamp: new Date().toISOString(),
    tool: 'bash',
    action: redactSecrets(command),
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
 *
 * The patterns are anchored to the FIRST token of the command (after
 * stripping leading env-var assignments) and to word boundaries. The
 * previous implementation used unanchored case-insensitive regexes over
 * the whole command string — `chromium --headless` was classified as
 * BLK because `chromium` contains the substring `rm`, and `git branch -D`
 * was misclassified because the regex matched the literal string `DELETE`.
 * @param command
 */
function classifyCommandTier(command: string): 'T0' | 'T1' | 'T2' | 'T3' | 'BLK' {
  // Strip leading `ENV=value` assignments to find the actual program.
  const stripped = command.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)+/, '').trim();
  const firstToken = stripped.split(/\s+/)[0] ?? '';
  // Denylist: `rm -rf /`, `mkfs.*`, `dd if=/dev/zero of=/dev/sda`, fork bombs.
  // Only `rm` with `-rf` AND `/` is BLK — `rm some-local-file` is T2.
  if (/^(rm)$/i.test(firstToken) && /-rf\s+\//.test(command)) return 'BLK';
  if (/^(mkfs|dd)$/i.test(firstToken) && /(\/dev\/|of=\/dev\/)/.test(command)) return 'BLK';
  if (/\b:\(\)\s*\{\s*:\|\s*&\s*\};\s*:/i.test(command)) return 'BLK'; // classic fork bomb
  // T3: network upload/remote-shell commands
  if (/^(curl|wget|scp|ssh|git\s+push|npm\s+publish)$/i.test(firstToken)) return 'T3';
  // T2: filesystem-mutating commands
  if (/^(rm|mv|mkdir|chmod|chown|git|npm|pip|make|tsc)$/i.test(firstToken)) return 'T2';
  // T1: shell redirection
  if (/(?:tee|>>|>)(?:\s|$)/.test(command)) return 'T1';
  return 'T0';
}
