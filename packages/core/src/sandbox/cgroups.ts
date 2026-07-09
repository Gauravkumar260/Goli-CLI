/**
 * cgroups v2 resource limits (Module 4).
 *
 * Generates cgroup v2 configuration for resource limits:
 * - memory.max (hard OOM kill)
 * - memory.high (soft throttle)
 * - cpu.max (CPU quota)
 * - pids.max (fork bomb defense)
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

  // Kill all processes in the cgroup on cleanup
  config[`${cgroupPath}/cgroup.kill`] = '0'; // 0 = don't kill yet (set to 1 on cleanup)

  return config;
}

/**
 * Generate the shell commands to create + configure a cgroup.
 *
 * This returns a script that:
 * 1. Creates the cgroup directory
 * 2. Writes the resource limit files
 * 3. Prints the cgroup path (for the executor to use)
 *
 * @param limits - The resource limits.
 * @param sessionId - A unique session ID (used in the cgroup path).
 */
export function generateCgroupSetupScript(
  limits: ResourceLimits,
  sessionId: string,
): string {
  const cgroupPath = `/sys/fs/cgroup/goli-cli/${sessionId}`;
  const config = generateCgroupConfig(limits, cgroupPath);

  const lines = [
    '#!/bin/bash',
    `set -e`,
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
 * @param sessionId
 */
export function generateCgroupCleanupScript(sessionId: string): string {
  const cgroupPath = `/sys/fs/cgroup/goli-cli/${sessionId}`;
  return [
    '#!/bin/bash',
    `CGROUP_PATH="${cgroupPath}"`,
    `if [ -d "$CGROUP_PATH" ]; then`,
    `  echo 1 > "$CGROUP_PATH/cgroup.kill" 2>/dev/null || true`,
    `  rmdir "$CGROUP_PATH" 2>/dev/null || true`,
    `fi`,
  ].join('\n');
}

/**
 * Check if cgroups v2 are available on this system.
 */
export function isCgroupsV2Available(): boolean {
  if (process.platform !== 'linux') return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- synchronous probe at module-load
    const { existsSync, readFileSync } = createRequire(import.meta.url)('node:fs');
    if (!existsSync('/sys/fs/cgroup/cgroup.controllers')) return false;
    const controllers = readFileSync('/sys/fs/cgroup/cgroup.controllers', 'utf-8');
    return controllers.includes('memory') && controllers.includes('cpu');
  } catch {
    return false;
  }
}
