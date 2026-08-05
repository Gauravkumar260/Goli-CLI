/**
 * cgroups v2 resource limits (Module 4).
 *
 * Generates cgroup v2 configuration for resource limits:
 * - memory.max (hard OOM kill)
 * - memory.high (soft throttle)
 * - cpu.max (CPU quota)
 * - pids.max (fork bomb defense)
 * - io.max (P1-19: IO throttling — read/write bytes per second)
 *
 * Phase 5 generates the config; the actual cgroup creation is done by
 * the sandbox executor (which runs as a parent process that creates
 * the cgroup, then spawns the sandboxed command inside it).
 *
 * On macOS, cgroups don't exist — we use Seatbelt's `resource-limit`
 * directives instead (added in the profile generator).
 *
 * @module sandbox/cgroups
 */

import { createRequire } from 'node:module';

import type { ResourceLimits } from './types.js';

/** Default resource limits (from config). */
export const DEFAULT_RESOURCE_LIMITS: ResourceLimits = {
  memoryMaxMb: 4096,
  memoryHighMb: 3072,
  cpuQuotaPercent: 200,
  pidMax: 512,
  diskMaxMb: 10240,
  wallclockTimeoutS: 1800,
};

/**
 * Generate cgroup v2 configuration for the given resource limits.
 *
 * @param limits - The resource limits.
 * @param cgroupPath - The cgroup path (e.g. `/sys/fs/cgroup/goli-cli/session-xxx`).
 * @returns An object mapping control file paths to their values.
 */
export function generateCgroupConfig(
  limits: ResourceLimits,
  cgroupPath: string,
): Record<string, string> {
  const config: Record<string, string> = {};

  // Memory limits
  config[`${cgroupPath}/memory.max`] = String(limits.memoryMaxMb * 1024 * 1024);
  config[`${cgroupPath}/memory.high`] = String(limits.memoryHighMb * 1024 * 1024);
  config[`${cgroupPath}/memory.oom.group`] = '1'; // Atomic OOM kill of entire cgroup

  // CPU limit (quota period = 100000µs = 100ms)
  // cpu.max = "quota period" — e.g. "200000 100000" = 2 cores
  const cpuQuota = Math.floor((limits.cpuQuotaPercent / 100) * 100000);
  config[`${cgroupPath}/cpu.max`] = `${cpuQuota} 100000`;

  // PID limit (fork bomb defense)
  config[`${cgroupPath}/pids.max`] = String(limits.pidMax);

  // Kill all processes in the cgroup on cleanup. NOTE: cgroup.kill is
  // WRITE-ONLY — writing '0' has no effect and does not store state.
  // The previous implementation wrote '0' here with a comment saying
  // "0 = don't kill yet (set to 1 on cleanup)" — that was a no-op that
  // confused maintainers. We omit the write entirely; the cleanup
  // script writes '1' to cgroup.kill when the sandbox session ends.

  return config;
}

/**
 * Generate the shell commands to create + configure a cgroup.
 *
 * This returns a script that:
 * 1. Verifies it is running as root (writing to /sys/fs/cgroup requires it).
 * 2. Creates the cgroup directory.
 * 3. Writes the resource limit files.
 * 4. Prints the cgroup path (for the executor to use).
 *
 * @param limits - The resource limits.
 * @param sessionId - A unique session ID (used in the cgroup path). MUST
 *   be alphanumeric/UUID — it is interpolated into a shell script, so we
 *   reject anything that could enable shell injection.
 */
export function generateCgroupSetupScript(
  limits: ResourceLimits,
  sessionId: string,
): string {
  // Defense in depth: sessionId is interpolated into a bash script
  // as part of a path. Although the executor passes randomUUID()
  // (safe), other callers could pass user-controlled strings.
  if (!/^[a-zA-Z0-9-]{1,128}$/.test(sessionId)) {
    throw new Error(
      `Invalid sessionId for cgroup setup: ${JSON.stringify(sessionId)} (must be alphanumeric/dash, 1-128 chars)`,
    );
  }
  const cgroupPath = `/sys/fs/cgroup/goli-cli/${sessionId}`;
  const config = generateCgroupConfig(limits, cgroupPath);

  const lines = [
    '#!/bin/bash',
    `set -e`,
    // Writing to /sys/fs/cgroup/... requires root (or delegated
    // cgroup permissions). Fail fast with a clear message if not
    // root — the previous script silently failed with EPERM on
    // `mkdir -p`.
    'if [ "$(id -u)" -ne 0 ]; then echo "cgroup setup requires root (or delegated cgroup permissions)" >&2; exit 1; fi',
    `CGROUP_PATH="${cgroupPath}"`,
    `mkdir -p "$CGROUP_PATH"`,
  ];

  for (const [file, value] of Object.entries(config)) {
    lines.push(`echo "${value}" > "${file}"`);
  }

  lines.push(`echo "$CGROUP_PATH"`);

  return lines.join('\n');
}

/**
 * Generate the cleanup script (kill all processes + remove cgroup).
 *
 * After writing `1` to `cgroup.kill`, waits (up to ~1s) for the
 * cgroup to actually become empty before calling `rmdir`. The
 * previous implementation called `rmdir` immediately, which could
 * fail with EBUSY while processes were still dying — leaving empty
 * cgroup directories in `/sys/fs/cgroup/goli-cli/`.
 * @param sessionId
 */
export function generateCgroupCleanupScript(sessionId: string): string {
  if (!/^[a-zA-Z0-9-]{1,128}$/.test(sessionId)) {
    throw new Error(
      `Invalid sessionId for cgroup cleanup: ${JSON.stringify(sessionId)}`,
    );
  }
  const cgroupPath = `/sys/fs/cgroup/goli-cli/${sessionId}`;
  return [
    '#!/bin/bash',
    `CGROUP_PATH="${cgroupPath}"`,
    `if [ -d "$CGROUP_PATH" ]; then`,
    `  echo 1 > "$CGROUP_PATH/cgroup.kill" 2>/dev/null || true`,
    // Wait for the cgroup to drain before rmdir so we don't leak.
    `  for i in $(seq 1 10); do`,
    `    if [ -z "$(cat "$CGROUP_PATH/cgroup.procs" 2>/dev/null)" ]; then`,
    `      rmdir "$CGROUP_PATH" 2>/dev/null && break`,
    `    fi`,
    `    sleep 0.1`,
    `  done`,
    `fi`,
  ].join('\n');
}

/**
 * Check if cgroups v2 are available on this system.
 *
 * All three controllers required by `generateCgroupConfig` must be
 * present: `memory`, `cpu`, AND `pids`. The previous check
 * omitted `pids`, so on a system where `pids` was not delegated
 * the `pids.max` write would silently fail (or the script would
 * abort under `set -e`), giving the user a confusing error.
 */
export function isCgroupsV2Available(): boolean {
  if (process.platform !== 'linux') return false;
  try {
     
    const { existsSync, readFileSync } = createRequire(import.meta.url)('node:fs');
    if (!existsSync('/sys/fs/cgroup/cgroup.controllers')) return false;
    const controllers = readFileSync('/sys/fs/cgroup/cgroup.controllers', 'utf-8');
    return (
      controllers.includes('memory') &&
      controllers.includes('cpu') &&
      controllers.includes('pids')
    );
  } catch {
    return false;
  }
}

// ─── P1-19: IO controller support ──────────────────────────────────────

/**
 * P1-19 fix (remediation plan Phase 19): check whether the `io`
 * controller is available in the cgroup v2 hierarchy.
 *
 * The `io` controller is optional in cgroups v2 — it's only present
 * when the kernel was compiled with `CONFIG_BLK_CGROUP` and the
 * block device supports IO accounting. Callers should check this
 * before calling `setIoLimit()`; if the controller is unavailable,
 * IO limits are silently skipped (the sandbox still enforces memory,
 * CPU, and PID limits).
 */
export function isIoControllerAvailable(): boolean {
  if (process.platform !== 'linux') return false;
  try {
     
    const { existsSync, readFileSync } = createRequire(import.meta.url)('node:fs');
    if (!existsSync('/sys/fs/cgroup/cgroup.controllers')) return false;
    const controllers = readFileSync('/sys/fs/cgroup/cgroup.controllers', 'utf-8');
    return controllers.includes('io');
  } catch {
    return false;
  }
}

/**
 * P1-19: format an `io.max` value for the cgroup v2 IO controller.
 *
 * The `io.max` file format is:
 *   `<device> rbps=<read-bytes-per-sec|'max'> wbps=<write-bytes-per-sec|'max'>`
 *
 * Multiple devices can be listed (one per line). When `device` is
 * `'default'`, the limit applies to all devices not explicitly listed.
 *
 * @param device - The block device (e.g. `'8:0'` for `/dev/sda`, or
 *   `'default'` for all devices).
 * @param limits - IO limits. `rbps` = read bytes per second;
 *   `wbps` = write bytes per second. `'max'` (the default) means no
 *   limit on that direction.
 * @returns The formatted `io.max` line (without trailing newline).
 */
export function formatIoMaxEntry(
  device: string,
  limits: { rbps?: number; wbps?: number } = {},
): string {
  const rbps = limits.rbps !== undefined ? String(limits.rbps) : 'max';
  const wbps = limits.wbps !== undefined ? String(limits.wbps) : 'max';
  return `${device} rbps=${rbps} wbps=${wbps}`;
}

/**
 * P1-19: generate the `io.max` file content for a cgroup.
 *
 * Writes a "default" entry that applies to all block devices, plus
 * optional per-device overrides. The result is a multi-line string
 * suitable for writing to `<cgroupPath>/io.max`.
 *
 * @param cgroupPath - The cgroup path.
 * @param defaultLimits - Default IO limits applied to all devices.
 * @param perDevice - Optional per-device overrides (keyed by device
 *   major:minor, e.g. `'8:0'`).
 * @returns An object with the `io.max` file path and its content.
 */
export function generateIoMaxConfig(
  cgroupPath: string,
  defaultLimits: { rbps?: number; wbps?: number } = {},
  perDevice: Record<string, { rbps?: number; wbps?: number }> = {},
): { file: string; content: string } {
  const lines: string[] = [formatIoMaxEntry('default', defaultLimits)];
  for (const [device, limits] of Object.entries(perDevice)) {
    lines.push(formatIoMaxEntry(device, limits));
  }
  return {
    file: `${cgroupPath}/io.max`,
    content: lines.join('\n') + '\n',
  };
}
