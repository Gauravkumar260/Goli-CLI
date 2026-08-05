/**
 * macOS Seatbelt sandbox profile generator (Module 4).
 *
 * Generates `sandbox-exec` profiles for each of the 3 sandbox modes.
 * The profiles use Apple's Seatbelt (TrustedBSD MAC) syntax.
 *
 * Note: `sandbox-exec` is technically deprecated since macOS Sierra
 * (2016) but has no supported replacement. Apple "containers" in
 * macOS 26 is different. We monitor Apple's direction.
 *
 * @module sandbox/seatbelt
 */

import { randomUUID } from 'node:crypto';
import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import type { SandboxMode } from './types.js';

/** Network allowlist entries (host:port). */
export interface NetworkAllowlist {
  entries: string[];
}

/**
 * Escape a path for safe interpolation into a Seatbelt profile.
 *
 * Seatbelt profile strings use Scheme-like `(subpath "...")` syntax.
 * A `"` in the path would close the string and allow injecting arbitrary
 * profile directives. We escape `"` and `\` so the path is treated as a
 * literal string by the Seatbelt parser.
 * @param p
 */
function escapeSeatbeltPath(p: string): string {
  // Reject paths that are obviously dangerous (empty, root, or containing
  // a literal newline which would break the profile line structure).
  if (!p || p === '/' || p.includes('\n')) {
    throw new Error(`Refusing to use unsafe path in Seatbelt profile: ${JSON.stringify(p)}`);
  }
  return p.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Get the home directory for use in the profile. Uses GOLI_HOME if set,
 * otherwise HOME, otherwise /tmp. The previous implementation captured
 * `process.env['HOME']` at MODULE LOAD TIME (in a `const`), which meant
 * that if HOME changed after import (rare but possible in tests), the
 * profile used the stale value. We now read it at call time.
 */
function homeDir(): string {
  return process.env['GOLI_HOME']?.trim() || process.env['HOME'] || homedir() || tmpdir();
}

/**
 * Generate a Seatbelt profile for the given sandbox mode.
 *
 * @param mode - The sandbox mode.
 * @param workspaceRoot - The workspace root path (allowed for read/write).
 * @param allowlist - Network allowlist (for workspace-write mode).
 */
export function generateSeatbeltProfile(
  mode: SandboxMode,
  workspaceRoot: string,
  allowlist?: NetworkAllowlist,
): string {
  const safeWorkspace = escapeSeatbeltPath(workspaceRoot);
  const header = [
    ';; GOLI-CLI Seatbelt sandbox profile',
    `;; Mode: ${mode}`,
    `;; Workspace: ${workspaceRoot}`,
    `;; Generated: ${new Date().toISOString()}`,
    '',
  ].join('\n');

  switch (mode) {
    case 'read-only':
      return header + generateReadOnlyProfile();
    case 'workspace-write':
      return header + generateWorkspaceWriteProfile(safeWorkspace, allowlist);
    case 'danger-full-access':
      return header + DANGER_PROFILE;
    default:
      return header + generateReadOnlyProfile();
  }
}

/** Read-only profile: allow reads from home + system, deny writes + network. */
function generateReadOnlyProfile(): string {
  const home = escapeSeatbeltPath(homeDir());
  return `
(version 1)
(deny default)

;; ─── Allow reads from home ─────────────────────────────────────
(allow file-read*
  (subpath "${home}"))

;; ─── Allow reads from system paths ─────────────────────────────
(allow file-read*
  (subpath "/usr/lib")
  (subpath "/usr/share")
  (subpath "/System/Library")
  (subpath "/Library/Frameworks")
  (subpath "/Library/Java"))

;; ─── Allow process operations ──────────────────────────────────
(allow process-info* (target self))
(allow signal (target self))
(allow sysctl-read)

;; ─── Deny all writes ───────────────────────────────────────────
(deny file-write*)

;; ─── Deny all network ──────────────────────────────────────────
(deny network*)

;; ─── Deny process execution ────────────────────────────────────
(deny process-exec)
`.trim();
}

/**
 * Generate a workspace-write profile.
 * @param safeWorkspace
 * @param allowlist
 */
function generateWorkspaceWriteProfile(safeWorkspace: string, allowlist?: NetworkAllowlist): string {
  const home = escapeSeatbeltPath(homeDir());
  const tmpDir = escapeSeatbeltPath(process.env['TMPDIR'] ?? '/tmp');

  // Parse allowlist entries. Handle IPv6 hosts (which contain colons)
  // by splitting on the LAST colon only.
  const networkRules = allowlist?.entries.length
    ? allowlist.entries
        .map((entry) => {
          const lastColon = entry.lastIndexOf(':');
          if (lastColon === -1) return '';
          const host = entry.slice(0, lastColon);
          const port = entry.slice(lastColon + 1);
          if (!host || !port || !/^\d+$/.test(port)) return '';
          // Wrap IPv6 hosts in brackets for the Seatbelt syntax.
          const safeHost = host.includes(':') ? `[${host}]` : host;
          return `(allow network-outbound (remote tcp "${safeHost}" ${port}))`;
        })
        .filter((r) => r.length > 0)
        .join('\n')
    : ';; (no network allowlist)';

  return `
(version 1)
(deny default)

;; ─── Allow reads from workspace + system ───────────────────────
(allow file-read*
  (subpath "${safeWorkspace}")
  (subpath "${home}")
  (subpath "/usr/lib")
  (subpath "/usr/share")
  (subpath "/System/Library"))

;; ─── Allow writes to workspace + /tmp ──────────────────────────
(allow file-write*
  (subpath "${safeWorkspace}")
  (subpath "${tmpDir}"))

;; ─── Deny writes to sensitive paths ────────────────────────────
(deny file-write*
  (subpath "/etc")
  (subpath "/usr")
  (subpath "/System")
  (subpath "/Library")
  (subpath "${home}/.ssh"))

;; ─── Allow process execution (for bash tool) ───────────────────
;; Restrict to read-only system paths only. The previous profile
;; also allowed /usr/local/bin and /opt/homebrew/bin — both
;; are often writable by the 'admin' group (or world-writable on
;; misconfigured systems). A sandboxed process with workspace-write
;; access could write a malicious binary there and then exec it,
;; gaining code execution outside the workspace.
(allow process-exec
  (subpath "/usr/bin")
  (subpath "/bin")
  (subpath "/System/Library/PrivateFrameworks"))

;; ─── Network: allowlist only ───────────────────────────────────
;; First allow DNS to well-known public resolvers so the allowlist
;; rules below can actually resolve hostnames to IPs. The previous
;; profile had (deny network*) then (allow network-outbound (remote
;; tcp "github.com" 443)) — but DNS (UDP 53) was denied, so
;; connect("github.com", 443) failed at the DNS step before the
;; TCP allow rule was ever consulted. The network allowlist was
;; effectively non-functional.
(allow network-outbound (remote udp "1.1.1.1" 53))
(allow network-outbound (remote udp "8.8.8.8" 53))
(allow network-outbound (remote udp "1.0.0.1" 53))
(allow network-outbound (remote udp "8.8.4.4" 53))
(deny network*)
${networkRules}

;; ─── Allow process operations ──────────────────────────────────
(allow process-info* (target self))
(allow signal (target self))
(allow sysctl-read)
(allow ipc-posix-shm*)
(allow mach-lookup)
`.trim();
}

/** Danger profile: allow everything (god mode). */
const DANGER_PROFILE = `
(version 1)
(allow default)
`.trim();

/**
 * Build and execute a sandbox-exec command for a given profile.
 *
 * Writes the profile to a temp file (avoids ARG_MAX limits for large
 * profiles with many allowlist entries) and invokes `sandbox-exec -f`.
 * Returns the temp file path so the caller can clean it up after execution.
 *
 * @param profile - The Seatbelt profile string.
 * @param command - The command to execute inside the sandbox.
 * @returns An object with the `sandboxExec` invocation args and the temp
 *   file path to clean up.
 */
export function buildSeatbeltCommandArgs(
  profile: string,
  command: string,
): { args: string[]; cleanup: () => void } {
  // Write profile to a temp file. This avoids shell-escaping issues and
  // ARG_MAX limits for large profiles.
  const profilePath = join(tmpdir(), `goli-seatbelt-${randomUUID().slice(0, 8)}.sb`);
  mkdirSync(dirname(profilePath), { recursive: true });
  writeFileSync(profilePath, profile, 'utf-8');

  // Use `bash -c` to run the command so pipes, redirects, &&, etc. work.
  // The command itself is passed as a single arg to bash -c, so no shell
  // escaping is needed (bash reads it verbatim).
  return {
    args: ['sandbox-exec', '-f', profilePath, 'bash', '-c', command],
    cleanup: () => {
      try {
        unlinkSync(profilePath);
      } catch {
        // Best-effort.
      }
    },
  };
}

/**
 * Build the sandbox-exec command for a given profile.
 *
 * @deprecated Use {@link buildSeatbeltCommandArgs} instead — this function
 *   returns a shell string which is harder to invoke safely. Kept for
 *   backward compatibility with existing callers.
 *
 * @param profile - The Seatbelt profile string.
 * @param command - The command to execute inside the sandbox.
 * @returns The full sandbox-exec command string.
 */
export function buildSeatbeltCommand(profile: string, command: string): string {
  // Write profile to a temp file, then execute
  const escapedProfile = profile.replace(/'/g, "'\\''");
  return `sandbox-exec -p '${escapedProfile}' ${command}`;
}
